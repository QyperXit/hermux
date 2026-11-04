import { expect, test } from "bun:test";
import { EVENTS_PATH, createLiveStream, freshnessText } from "../web/live.js";
import { CLOSED, CONNECTING, FakeSource } from "./support/event-source";

function setup(reopenMs = 20) {
  const sources: FakeSource[] = [];
  const health: boolean[] = [];
  const events: [string, unknown][] = [];
  const names: (string | null)[] = [];
  const stream = createLiveStream({
    open: (path) => {
      const source = new FakeSource(path);
      sources.push(source);
      return source;
    },
    onHealth: (healthy) => health.push(healthy),
    onEvent: (type, data) => events.push([type, data]),
    onStream: (id) => names.push(id),
    reopenMs,
  });
  return { stream, sources, health, events, names, last: () => sources[sources.length - 1] };
}

test("the stream is healthy only once the server says herdr's events reach it; until then the page polls", () => {
  const { stream, sources, health } = setup();
  stream.start();
  expect(sources.map((source) => source.path)).toEqual([EVENTS_PATH]);
  expect(stream.isHealthy()).toBe(false);
  sources[0].fire("live", { live: true });
  expect(stream.isHealthy()).toBe(true);
  sources[0].fire("live", { live: false });
  sources[0].fire("live", { live: true });
  expect(health).toEqual([true, false, true]);
  stream.start();
  expect(sources).toHaveLength(1);
});

test("changes and output activity are handed to the page", () => {
  const { stream, last, events } = setup();
  stream.start();
  last().fire("live", { live: true });
  last().fire("change", { changed: [{ pane_id: "w1:p1", agent_status: "blocked" }], refetch: true });
  last().fire("output", { pane_id: "w1:p1" });
  last().fire("change", { refetch: true });
  expect(events).toEqual([
    ["change", { changed: [{ pane_id: "w1:p1", agent_status: "blocked" }], refetch: true }],
    ["output", { pane_id: "w1:p1" }],
    ["change", { refetch: true }],
  ]);
});

test("live output: the stream's name is handed over, and taken back when it errors or closes; output and watch events reach the page", () => {
  const { stream, last, events, names } = setup();
  stream.start();
  last().fire("stream", { id: "first" });
  last().fire("watch", { pane_id: "w1:p1", streaming: true });
  last().fire("output", { pane_id: "w1:p1", text: "screen" });
  expect(events).toEqual([
    ["watch", { pane_id: "w1:p1", streaming: true }],
    ["output", { pane_id: "w1:p1", text: "screen" }],
  ]);
  last().fail(CONNECTING);
  last().fire("stream", { id: "second" });
  last().fire("stream", { id: 7 });
  stream.stop();
  expect(names).toEqual(["first", null, "second", null]);
  stream.stop();
  expect(names).toHaveLength(4);
});

test("a stream error falls back to polling at once; the browser's own reconnect brings the stream back", () => {
  const { stream, sources, health } = setup();
  stream.start();
  sources[0].fire("live", { live: true });
  sources[0].fail(CONNECTING);
  expect(stream.isHealthy()).toBe(false);
  expect(sources).toHaveLength(1);
  sources[0].fire("live", { live: true });
  expect(health).toEqual([true, false, true]);
});

test("a stream the browser gave up on is opened again after a pause, and streams again when it answers", async () => {
  const { stream, sources, health } = setup(20);
  stream.start();
  sources[0].fire("live", { live: true });
  sources[0].fail(CLOSED);
  expect(health).toEqual([true, false]);
  expect(sources).toHaveLength(1);
  await Bun.sleep(60);
  expect(sources).toHaveLength(2);
  sources[1].fail(CLOSED);
  await Bun.sleep(60);
  expect(sources).toHaveLength(3);
  sources[2].fire("live", { live: true });
  expect(health).toEqual([true, false, true]);
  sources[0].fire("live", { live: false });
  expect(stream.isHealthy()).toBe(true);
  expect(health).toEqual([true, false, true]);
});

test("a hidden page closes the stream (and polls nothing while hidden); shown again it opens a new one", async () => {
  const { stream, sources, health } = setup(20);
  stream.start();
  sources[0].fire("live", { live: true });
  stream.stop();
  expect(sources[0].closed).toBe(true);
  expect(health).toEqual([true, false]);
  stream.start();
  expect(sources).toHaveLength(2);
  sources[1].fire("live", { live: true });
  expect(health).toEqual([true, false, true]);
  sources[1].fail(CLOSED);
  stream.stop();
  await Bun.sleep(60);
  expect(sources).toHaveLength(2);
});

test("the freshness line says Live while streaming, and the source and time while polling", () => {
  expect(freshnessText({ streaming: true, sample: false, time: "14:05" })).toBe("Live");
  expect(freshnessText({ streaming: false, sample: false, time: "14:05" })).toBe("Live · 14:05");
  expect(freshnessText({ streaming: false, sample: true, time: "14:05" })).toBe("Sample data · 14:05");
});
