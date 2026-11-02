// Live output streaming (D30), the server side: herdr's observe stream (a fake
// herdr binary), the headless emulator's screen, and the watcher that keeps a
// stream only for the panes a page views and pushes their output.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";
import { HerdrError, createHerdr, type Herdr, type ObserveHandlers } from "../server/herdr";
import { OBSERVE_COLS, createWatcher, screenText, type WatchEvent, type Watcher } from "../server/watch";
import { makeFakeHerdr } from "./fake-herdr";
import { decoded, fullFrame, partialFrame } from "./support/frames";
import { until } from "./support/fake-events";
import { auditCalls } from "./support/http";

const ESC = "\x1b";
const fakes: ReturnType<typeof makeFakeHerdr>[] = [];
const watchers: Watcher[] = [];
afterEach(() => watchers.splice(0).forEach((watcher) => watcher.stop()));
afterAll(() => fakes.forEach((fake) => fake.dispose()));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("herdr's observe stream through the emulator", () => {
  test("scripted full and partial frames give the screen, styles and all; stop ends the stream's own process", async () => {
    const fake = makeFakeHerdr({
      shells: [{ pane_id: "w1:p1" }],
      observe: {
        "w1:p1": {
          frames: [
            fullFrame(["$ make", `${ESC}[0;1;39;49mbuilding${ESC}[0;39;49m 3 files`, `${ESC}[0;38;5;208;49mwarning${ESC}[0;39;49m: old`]),
            // A line that isn't a frame is skipped.
            { type: "something.else" },
            partialFrame([[3, 1, `${ESC}[0;38;2;0;200;0;49mok${ESC}[0;39;49m${ESC}[K`], [4, 1, "$ "]]),
            partialFrame([[2, 10, `${ESC}[0;3;4;39;49m4${ESC}[0;39;49m`]], { seq: 3 }),
          ],
        },
      },
    });
    fakes.push(fake);
    const herdr = createHerdr(fake.bin);
    const term = new Terminal({ cols: 30, rows: 4, scrollback: 0, allowProposedApi: true });
    const seqs: number[] = [];
    const ends: HerdrError[] = [];
    const observation = herdr.observe("w1:p1", { cols: 30, rows: 4 }, { frame: (frame) => (seqs.push(frame.seq), term.write(frame.bytes)), end: (error) => ends.push(error) });
    await until(() => seqs.length === 3 && fake.observers().length === 1, 3_000, "three frames");
    await new Promise<void>((done) => term.write("", done));
    expect(screenText(term)).toBe(
      [
        `${ESC}[0m$ make${ESC}[0m`,
        `${ESC}[0m${ESC}[1mbuilding${ESC}[0m ${ESC}[0m${ESC}[3;4m4${ESC}[0m files${ESC}[0m`,
        `${ESC}[0m${ESC}[38;2;0;200;0mok${ESC}[0m`,
        `${ESC}[0m$${ESC}[0m`,
      ].join("\n"),
    );
    const [pid] = fake.observers();
    expect(alive(pid)).toBe(true);
    observation.stop();
    await until(() => !alive(pid), 3_000, "the observe process to end");
    await Bun.sleep(30);
    // Stopped on purpose: no end is reported.
    expect(ends).toEqual([]);
    expect(fake.calls()).toEqual([["terminal", "session", "observe", "w1:p1", "--cols", "30", "--rows", "4"]]);
    auditCalls(fake.calls());
  });

  test("a stream that ends by itself, or a pane that has gone, is reported with herdr's error", async () => {
    const fake = makeFakeHerdr({ shells: [{ pane_id: "w1:p1" }], observe: { "w1:p1": { frames: [fullFrame(["x"])], exit: 1, stderr: JSON.stringify({ error: { code: "server_unreachable", message: "down" } }) } } });
    fakes.push(fake);
    const herdr = createHerdr(fake.bin);
    for (const [paneId, code] of [["w1:p1", "server_unreachable"], ["w1:p9", "pane_not_found"]]) {
      const ends: string[] = [];
      herdr.observe(paneId, { cols: 30, rows: 4 }, { frame: () => {}, end: (error) => ends.push(error.code) });
      await until(() => ends.length === 1, 3_000, "the end");
      expect(ends).toEqual([code]);
    }
    // Anything but a pane ID is refused before herdr runs.
    expect(() => herdr.observe("--help", { cols: 30, rows: 4 }, { frame: () => {}, end: () => {} })).toThrow("Not a herdr pane ID");
    auditCalls(fake.calls());
  });
});

// The watcher on an in-memory herdr: the test pushes frames, ends streams and
// says what each read returns.
function setup({ graceMs = 60, debounceMs = 10, retryMs = { first: 20, max: 80 } } = {}) {
  const observations: { paneId: string; size: { cols: number; rows: number }; handlers: ObserveHandlers; stopped: boolean; at: number }[] = [];
  const reads: string[] = [];
  const texts = new Map<string, string>();
  let readFailure: HerdrError | null = null;
  let paneFailure: HerdrError | null = null;
  const herdr: Pick<Herdr, "pane" | "observe" | "readStyled"> = {
    pane: async (paneId) => {
      if (paneFailure) throw paneFailure;
      return { pane_id: paneId, scroll: { viewport_rows: 4 } };
    },
    observe: (paneId, size, handlers) => {
      const observation = { paneId, size, handlers, stopped: false, at: Date.now() };
      observations.push(observation);
      return { stop: () => void (observation.stopped = true) };
    },
    readStyled: async (paneId) => {
      reads.push(paneId);
      if (readFailure) throw readFailure;
      return texts.get(paneId) ?? `text of ${paneId}`;
    },
  };
  const watcher = createWatcher({ herdr, cols: 30, graceMs, debounceMs, retryMs });
  watchers.push(watcher);
  const viewer = () => {
    const heard: WatchEvent[] = [];
    return Object.assign((event: WatchEvent) => heard.push(event), { heard });
  };
  const current = (paneId: string) => observations.filter((observation) => observation.paneId === paneId && !observation.stopped);
  return {
    watcher,
    observations,
    reads,
    texts,
    viewer,
    current,
    failReads: (error: HerdrError | null) => (readFailure = error),
    failPane: (error: HerdrError | null) => (paneFailure = error),
    // Sends a frame on the pane's open stream.
    frame(paneId: string, frame: ReturnType<typeof fullFrame>) {
      const [observation] = current(paneId);
      if (!observation) throw new Error(`No open stream of ${paneId}`);
      observation.handlers.frame(decoded(frame));
    },
    // Waits past the debounce and the read it may start.
    settle: () => Bun.sleep(debounceMs * 4),
  };
}

const SCREEN = ["$ make", "building", "", ""];

describe("the watcher", () => {
  test("a stream starts with the first viewer, at the wide canvas and the pane's rows; a second viewer shares it", async () => {
    const world = setup();
    const first = world.viewer();
    const second = world.viewer();
    world.watcher.watch(first, "w1:p1");
    await until(() => world.observations.length === 1);
    expect(world.observations[0].size).toEqual({ cols: 30, rows: 4 });
    world.watcher.watch(second, "w1:p1");
    await Bun.sleep(20);
    expect(world.observations).toHaveLength(1);
    expect(world.watcher.watched()).toEqual(["w1:p1"]);
    // Its first frame: one read, and both viewers hear it is streamed, with the text.
    world.frame("w1:p1", fullFrame(SCREEN));
    await world.settle();
    expect(world.reads).toEqual(["w1:p1"]);
    for (const viewer of [first, second]) {
      expect(viewer.heard).toEqual([
        { type: "watch", pane_id: "w1:p1", streaming: true },
        { type: "output", pane_id: "w1:p1", text: "text of w1:p1" },
      ]);
    }
    // A viewer that comes once it streams hears so at once, with the latest text.
    const third = world.viewer();
    world.watcher.watch(third, "w1:p1");
    expect(third.heard).toEqual(first.heard);
    expect(world.reads).toEqual(["w1:p1"]);
  });

  test("the real default canvas is the wide one", () => {
    expect(OBSERVE_COLS).toBe(400);
  });

  test("a change gives one read and one push; frames that change nothing read nothing; a burst reads once; the same text pushes nothing", async () => {
    const world = setup();
    const viewer = world.viewer();
    world.watcher.watch(viewer, "w1:p1");
    await until(() => world.observations.length === 1);
    world.frame("w1:p1", fullFrame(SCREEN));
    await world.settle();
    world.reads.length = 0;
    viewer.heard.length = 0;

    // One change.
    world.texts.set("w1:p1", "text two");
    world.frame("w1:p1", partialFrame([[3, 1, "done"]]));
    await world.settle();
    expect(world.reads).toEqual(["w1:p1"]);
    expect(viewer.heard).toEqual([{ type: "output", pane_id: "w1:p1", text: "text two" }]);

    // Frames that change nothing: the full screen again, the same text written again, a cursor move.
    world.frame("w1:p1", fullFrame(["$ make", "building", "done", ""]));
    world.frame("w1:p1", partialFrame([[1, 1, "$ make"]]));
    world.frame("w1:p1", partialFrame([[4, 3, ""]]));
    await world.settle();
    expect(world.reads).toEqual(["w1:p1"]);

    // A burst within the debounce: one read, one push.
    world.texts.set("w1:p1", "text three");
    for (const [index, word] of ["a", "ab", "abc", "abcd"].entries()) world.frame("w1:p1", partialFrame([[4, 1, word]], { seq: 3 + index }));
    await world.settle();
    expect(world.reads).toEqual(["w1:p1", "w1:p1"]);
    expect(viewer.heard).toEqual([
      { type: "output", pane_id: "w1:p1", text: "text two" },
      { type: "output", pane_id: "w1:p1", text: "text three" },
    ]);

    // The screen changed but the read didn't (e.g. only the clock moved off the read's lines): no push.
    world.frame("w1:p1", partialFrame([[4, 1, "abcde"]]));
    await world.settle();
    expect(world.reads).toHaveLength(3);
    expect(viewer.heard).toHaveLength(2);
  });

  test("a frame of another size resizes the emulator, so a change beyond the old edge is seen", async () => {
    const world = setup();
    const viewer = world.viewer();
    world.watcher.watch(viewer, "w1:p1");
    await until(() => world.observations.length === 1);
    world.frame("w1:p1", fullFrame(["", "", "", `${" ".repeat(29)}x`]));
    await world.settle();
    world.reads.length = 0;
    // Wider: an x at column 35. Without the resize it would land on column 30, already an x.
    world.frame("w1:p1", partialFrame([[4, 35, "x"]], { width: 40 }));
    await world.settle();
    expect(world.reads).toEqual(["w1:p1"]);
  });

  test("the last viewer leaving stops the stream only after the grace period; a viewer back within it keeps the same stream", async () => {
    const world = setup({ graceMs: 80 });
    const first = world.viewer();
    const second = world.viewer();
    world.watcher.watch(first, "w1:p1");
    world.watcher.watch(second, "w1:p1");
    await until(() => world.observations.length === 1);
    world.watcher.unwatch(first);
    world.watcher.unwatch(second);
    // Within the grace period it still runs, and a viewer coming back keeps it.
    await Bun.sleep(40);
    expect(world.observations[0].stopped).toBe(false);
    world.watcher.watch(first, "w1:p1");
    await Bun.sleep(120);
    expect(world.observations).toHaveLength(1);
    expect(world.observations[0].stopped).toBe(false);
    // Unwatching a pane it doesn't view changes nothing.
    world.watcher.unwatch(first, "w1:p2");
    await Bun.sleep(120);
    expect(world.observations[0].stopped).toBe(false);
    // Gone for good: stopped after the grace period, and nothing is streamed.
    world.watcher.unwatch(first, "w1:p1");
    await Bun.sleep(40);
    expect(world.observations[0].stopped).toBe(false);
    await until(() => world.observations[0].stopped, 1_000, "the stream to stop");
    expect(world.watcher.watched()).toEqual([]);
    // A later viewer starts a new one.
    world.watcher.watch(second, "w1:p1");
    await until(() => world.observations.length === 2);
  });

  test("a viewer watches one pane at a time: moving to another leaves the first, which stops after the grace period", async () => {
    const world = setup({ graceMs: 30 });
    const viewer = world.viewer();
    world.watcher.watch(viewer, "w1:p1");
    await until(() => world.observations.length === 1);
    world.watcher.watch(viewer, "w1:p2");
    await until(() => world.observations.length === 2 && world.observations[0].stopped, 1_000, "the swap");
    expect(world.watcher.watched()).toEqual(["w1:p2"]);
    // It hears only of the pane it views now.
    world.frame("w1:p2", fullFrame(SCREEN));
    await world.settle();
    expect(viewer.heard.map((event) => event.pane_id)).toEqual(["w1:p2", "w1:p2"]);
  });

  test("a stream that fails tells the viewers to poll, and opens again with back-off; streaming resumes with the text", async () => {
    const world = setup({ retryMs: { first: 30, max: 60 } });
    const viewer = world.viewer();
    world.watcher.watch(viewer, "w1:p1");
    await until(() => world.observations.length === 1);
    world.frame("w1:p1", fullFrame(SCREEN));
    await world.settle();
    viewer.heard.length = 0;

    world.observations[0].handlers.end(new HerdrError("herdr_failed", "herdr exited with status 1"));
    expect(viewer.heard).toEqual([{ type: "watch", pane_id: "w1:p1", streaming: false }]);
    await until(() => world.observations.length === 2, 1_000, "a retry");
    // It fails again at once, and again: the waits double up to the limit.
    world.observations[1].handlers.end(new HerdrError("herdr_failed", "again"));
    await until(() => world.observations.length === 3, 1_000, "a second retry");
    world.observations[2].handlers.end(new HerdrError("herdr_failed", "again"));
    await until(() => world.observations.length === 4, 1_000, "a third retry");
    const gaps = [1, 2, 3].map((index) => world.observations[index].at - world.observations[index - 1].at);
    expect([gaps[0] >= 28, gaps[1] >= 58, gaps[2] >= 58, gaps[2] < 100]).toEqual([true, true, true, true]);
    // An end from a stream that was replaced changes nothing.
    world.observations[0].handlers.end(new HerdrError("herdr_failed", "late"));
    expect(viewer.heard).toEqual([{ type: "watch", pane_id: "w1:p1", streaming: false }]);

    // Back: the first frame reads, and the viewer streams again, with the text even if unchanged.
    world.frame("w1:p1", fullFrame(SCREEN));
    await world.settle();
    expect(viewer.heard).toEqual([
      { type: "watch", pane_id: "w1:p1", streaming: false },
      { type: "watch", pane_id: "w1:p1", streaming: true },
      { type: "output", pane_id: "w1:p1", text: "text of w1:p1" },
    ]);
  });

  test("a pane that can't be looked up counts as a failed stream and is retried", async () => {
    const world = setup({ retryMs: { first: 20, max: 20 } });
    world.failPane(new HerdrError("pane_not_found", "pane w1:p1 not found"));
    world.watcher.watch(world.viewer(), "w1:p1");
    await Bun.sleep(80);
    expect(world.observations).toEqual([]);
    world.failPane(null);
    await until(() => world.observations.length === 1, 1_000, "a stream once the pane answers");
  });

  test("a read that fails is like a failed poll: the viewers poll (and show its error); the next change reads again and streams", async () => {
    const world = setup();
    const viewer = world.viewer();
    world.watcher.watch(viewer, "w1:p1");
    await until(() => world.observations.length === 1);
    world.frame("w1:p1", fullFrame(SCREEN));
    await world.settle();
    viewer.heard.length = 0;
    world.failReads(new HerdrError("server_unreachable", "down"));
    world.frame("w1:p1", partialFrame([[3, 1, "x"]]));
    await world.settle();
    expect(viewer.heard).toEqual([{ type: "watch", pane_id: "w1:p1", streaming: false }]);
    world.failReads(null);
    world.frame("w1:p1", partialFrame([[3, 1, "y"]]));
    await world.settle();
    expect(viewer.heard).toEqual([
      { type: "watch", pane_id: "w1:p1", streaming: false },
      { type: "watch", pane_id: "w1:p1", streaming: true },
      { type: "output", pane_id: "w1:p1", text: "text of w1:p1" },
    ]);
  });

  test("stop ends every stream", async () => {
    const world = setup();
    world.watcher.watch(world.viewer(), "w1:p1");
    world.watcher.watch(world.viewer(), "w1:p2");
    await until(() => world.observations.length === 2);
    world.watcher.stop();
    expect(world.observations.map((observation) => observation.stopped)).toEqual([true, true]);
    expect(world.watcher.watched()).toEqual([]);
  });
});
