// Live output streaming (D30) through the real app: the page's event stream
// names itself, a watch request for that name gets one pane's output pushed on
// it (and only on it), every guard applies to the new endpoint, a closed
// stream drops its watch, and streamed text renders exactly as polled text.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../server/app";
import { createLiveEvents, type LiveEvents } from "../server/events";
import { createHerdr } from "../server/herdr";
import { createWatcher, type Watcher } from "../server/watch";
import { readerHtml, shellHtml } from "../web/reader.js";
import { makeFakeHerdr } from "./fake-herdr";
import { WEB } from "./support/agents";
import { makeFakeEvents, until, type FakeEvents } from "./support/fake-events";
import { fullFrame } from "./support/frames";
import { ALLOWED_LOGIN, auditCalls } from "./support/http";

const ESC = "\x1b";
// A styled screen as herdr's recent-unwrapped `--format ansi` read gives it
// (the shape calibrated on a disposable pane, generic content): rows end in
// CRLF, each style is a reset and one code per attribute, and a long line
// that wrapped on the laptop comes back joined.
const STYLED = [
  `${ESC}[0m${ESC}[1mRelease notes${ESC}[0m`,
  `The build finished and ${ESC}[0m${ESC}[38;2;0;255;255mweb/app.js${ESC}[0m changed; see ${ESC}[0m${ESC}[38;2;255;102;0mhttps://example.org/notes${ESC}[0m for ${"more detail ".repeat(20).trim()}.`,
  `${ESC}[0m${ESC}[38;5;245mThinking level: medium${ESC}[0m`,
  `${ESC}[0m${ESC}[48;2;45;45;48m ok 12 tests ${ESC}[0m`,
  `${ESC}[0m${ESC}[1m${ESC}[38;5;2myou@laptop${ESC}[0m:${ESC}[0m${ESC}[1m${ESC}[38;5;2m~/project${ESC}[0m$ `,
].join("\r\n");

const fakes: ReturnType<typeof makeFakeHerdr>[] = [];
const eventFakes: FakeEvents[] = [];
const hubs: LiveEvents[] = [];
const watchers: Watcher[] = [];
afterEach(() => {
  hubs.splice(0).forEach((hub) => hub.stop());
  watchers.splice(0).forEach((watcher) => watcher.stop());
});
afterAll(() => {
  fakes.forEach((fake) => fake.dispose());
  eventFakes.forEach((fake) => fake.dispose());
});

async function setup() {
  // `hold(pane)` makes the next `pane get` for that pane wait; `held` has its
  // release once it does, so a test can decide what happens meanwhile.
  const holds: string[] = [];
  const held: { paneId: string; release: () => void }[] = [];
  const hold = (paneId: string) => void holds.push(paneId);
  const shells = ["w1:p1", "w1:p2"].map((pane_id) => ({ pane_id, workspace_id: "w1", tab_id: "w1:t1", scroll: { viewport_rows: 4 } }));
  const fake = makeFakeHerdr({
    shells,
    outputs: { "w1:p1": "plain one\n", "w1:p2": "plain two\n" },
    ansiOutputs: { "w1:p1": STYLED, "w1:p2": `${ESC}[0m${ESC}[1mtwo${ESC}[0m` },
    observe: { "w1:p1": { frames: [fullFrame(["one"])] }, "w1:p2": { frames: [fullFrame(["two"])] } },
  });
  fakes.push(fake);
  const socket = makeFakeEvents();
  eventFakes.push(socket);
  const real = createHerdr(fake.bin);
  const herdr: typeof real = {
    ...real,
    pane: async (paneId, ...rest) => {
      const pane = await real.pane(paneId, ...rest);
      const at = holds.indexOf(paneId);
      if (at >= 0) {
        holds.splice(at, 1);
        await new Promise<void>((release) => held.push({ paneId, release }));
      }
      return pane;
    },
  };
  const hub = createLiveEvents({ socketPath: socket.path, panes: async () => ["w1:p1", "w1:p2"], retryMs: { first: 20, max: 80 } });
  hubs.push(hub);
  hub.start();
  await until(() => hub.isLive());
  const watcher = createWatcher({ herdr, debounceMs: 10, graceMs: 50, retryMs: { first: 20, max: 80 } });
  watchers.push(watcher);
  const app = createApp({ herdr, allowedLogin: ALLOWED_LOGIN, webRoot: WEB, events: hub, watcher });
  const request = (method: string, path: string, { body, headers = {}, login = ALLOWED_LOGIN }: { body?: string; headers?: Record<string, string>; login?: string | null } = {}) => {
    const all = new Headers(headers);
    if (login !== null) all.set("Tailscale-User-Login", login);
    return app(new Request(`http://127.0.0.1:8787${path}`, { method, headers: all, body }));
  };
  const watch = (method: "POST" | "DELETE", paneId: string, stream: string) =>
    request(method, `/api/terminals/${encodeURIComponent(paneId)}/watch`, { body: JSON.stringify({ stream }), headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" } });
  // A page's stream, read as it comes, and its name.
  async function open() {
    const response = await request("GET", "/api/events");
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const page = { text: "", id: "", reader };
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        page.text += decoder.decode(value, { stream: true });
      }
    })();
    await until(() => page.text.includes("event: stream"), 2_000, "the stream's name");
    page.id = JSON.parse(/event: stream\ndata: (.*)\n/.exec(page.text)![1]).id;
    return Object.assign(page, { pump, events: () => eventsOf(page.text) });
  }
  return { fake, watcher, request, watch, open, hold, held };
}

// The server-sent events in a stream's text, after its retry line.
const eventsOf = (text: string) =>
  text
    .split("\n\n")
    .filter((block) => block.startsWith("event: "))
    .map((block) => {
      const [, type, data] = /^event: (\w+)\ndata: (.*)$/.exec(block)!;
      return { type, data: JSON.parse(data) as Record<string, unknown> };
    });

const outputs = (page: { events: () => { type: string; data: Record<string, unknown> }[] }) => page.events().filter((event) => event.type === "output" && "text" in event.data);

describe("watching a pane's output on the page's stream", () => {
  test("the stream names itself first; a watch for that name streams the pane's output, as the output endpoint returns it", async () => {
    const { watch, open, request, fake } = await setup();
    const page = await open();
    expect(page.text.startsWith(`retry: 2000\n\nevent: stream\ndata: {"id":"${page.id}"}\n\nevent: live\n`)).toBe(true);
    expect(page.id).toMatch(/^[0-9a-f-]{36}$/);
    const response = await watch("POST", "w1:p1", page.id);
    expect([response.status, await response.json()]).toEqual([200, { ok: true }]);
    await until(() => outputs(page).length === 1, 3_000, "the output");
    const polled = (await (await request("GET", "/api/terminals/w1%3Ap1/output")).json()).text;
    expect(polled).toBe(STYLED);
    expect(page.events().filter((event) => event.type === "watch" || "text" in event.data)).toEqual([
      { type: "watch", data: { pane_id: "w1:p1", streaming: true } },
      { type: "output", data: { pane_id: "w1:p1", text: polled } },
    ]);
    auditCalls(fake.calls());
    await page.reader.cancel();
  });

  test("only the connection viewing a pane gets its output; one viewing nothing gets none", async () => {
    const { watch, open } = await setup();
    const [one, two, none] = [await open(), await open(), await open()];
    await watch("POST", "w1:p1", one.id);
    await watch("POST", "w1:p2", two.id);
    await until(() => outputs(one).length === 1 && outputs(two).length === 1, 3_000, "both outputs");
    await Bun.sleep(60);
    expect(outputs(one).map((event) => event.data.pane_id)).toEqual(["w1:p1"]);
    expect(outputs(two).map((event) => event.data.pane_id)).toEqual(["w1:p2"]);
    expect(none.events().filter((event) => event.type === "output" || event.type === "watch")).toEqual([]);
    for (const page of [one, two, none]) await page.reader.cancel();
  });

  test("a closed stream drops its watch, and the observe stream's process stops after the grace period", async () => {
    const { watch, open, watcher, fake } = await setup();
    const page = await open();
    await watch("POST", "w1:p1", page.id);
    await until(() => outputs(page).length === 1, 3_000, "the output");
    const [pid] = fake.observers();
    expect(watcher.watched()).toEqual(["w1:p1"]);
    await page.reader.cancel();
    await until(() => watcher.watched().length === 0, 2_000, "the watch to go");
    await until(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, 2_000, "the observe process to end");
    // Its name is no longer a stream.
    expect((await watch("POST", "w1:p1", page.id)).status).toBe(404);
  });

  test("DELETE ends the watch; a DELETE for a pane it doesn't watch changes nothing", async () => {
    const { watch, open, watcher } = await setup();
    const page = await open();
    await watch("POST", "w1:p1", page.id);
    await until(() => outputs(page).length === 1, 3_000, "the output");
    expect([(await watch("DELETE", "w1:p2", page.id)).status]).toEqual([200]);
    await Bun.sleep(100);
    expect(watcher.watched()).toEqual(["w1:p1"]);
    const response = await watch("DELETE", "w1:p1", page.id);
    expect([response.status, await response.json()]).toEqual([200, { ok: true }]);
    await until(() => watcher.watched().length === 0, 2_000, "the watch to go");
    await page.reader.cancel();
  });

  test("every guard applies: the login (403), other sites, JSON only, a real stream and a real pane; nothing is observed", async () => {
    const { request, open, watcher, fake } = await setup();
    const page = await open();
    const body = JSON.stringify({ stream: page.id });
    const json = { "content-type": "application/json" };
    for (const method of ["POST", "DELETE"]) {
      for (const login of [null, "", "someone.else@example.com", "You@Example.com"]) {
        const response = await request(method, "/api/terminals/w1%3Ap1/watch", { body, headers: json, login });
        expect([method, login, response.status, await response.text()]).toEqual([method, login, 403, "Forbidden\n"]);
      }
      for (const site of ["cross-site", "same-site"]) {
        const response = await request(method, "/api/terminals/w1%3Ap1/watch", { body, headers: { ...json, "sec-fetch-site": site } });
        expect([method, site, response.status, (await response.json()).error.code]).toEqual([method, site, 403, "cross_site_request"]);
      }
      for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
        const response = await request(method, "/api/terminals/w1%3Ap1/watch", { body, headers: { "content-type": type } });
        expect([method, type, response.status]).toEqual([method, type, 415]);
      }
      for (const stream of [undefined, "", "not-a-stream", 7]) {
        const response = await request(method, "/api/terminals/w1%3Ap1/watch", { body: JSON.stringify({ stream }), headers: json });
        expect([method, stream, response.status, (await response.json()).error.code]).toEqual([method, stream, 404, "not_found"]);
      }
      const invalid = await request(method, "/api/terminals/--help/watch", { body, headers: json });
      expect([method, invalid.status, (await invalid.json()).error.code]).toEqual([method, 400, "invalid_target"]);
    }
    const gone = await request("POST", "/api/terminals/w1%3Ap9/watch", { body, headers: json });
    expect([gone.status, (await gone.json()).error.code]).toEqual([404, "pane_not_found"]);
    expect((await request("GET", "/api/terminals/w1%3Ap1/watch")).status).toBe(405);
    // The stream itself: 403 without the login, refused from other sites.
    expect((await request("GET", "/api/events", { login: "someone.else@example.com" })).status).toBe(403);
    expect((await request("GET", "/api/events", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    await Bun.sleep(50);
    expect(watcher.watched()).toEqual([]);
    expect(fake.calls().filter((call) => call[0] === "terminal")).toEqual([]);
    expect(page.events().filter((event) => event.type === "watch" || event.type === "output")).toEqual([]);
    await page.reader.cancel();
  });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("a watch request that is still pending when its stream changes", () => {
  test("the stream closes first: nothing is watched after the grace period and no observe process is left", async () => {
    const { watch, open, watcher, fake, hold, held } = await setup();
    const page = await open();
    hold("w1:p1");
    const post = watch("POST", "w1:p1", page.id);
    await until(() => held.length === 1, 2_000, "the request to wait");
    await page.reader.cancel();
    await Bun.sleep(20);
    held[0].release();
    const answer = await post;
    await Bun.sleep(300);
    expect(watcher.watched()).toEqual([]);
    expect(fake.observers().filter(alive)).toEqual([]);
    expect(fake.calls().filter((call) => call[0] === "terminal")).toEqual([]);
    expect(answer.status).toBe(404);
  });

  test("a DELETE lands first: the page no longer views the pane, so nothing is watched after the grace period", async () => {
    const { watch, open, watcher, fake, hold, held } = await setup();
    const page = await open();
    hold("w1:p1");
    const post = watch("POST", "w1:p1", page.id);
    await until(() => held.length === 1, 2_000, "the request to wait");
    expect((await watch("DELETE", "w1:p1", page.id)).status).toBe(200);
    held[0].release();
    expect((await post).status).toBe(200);
    await Bun.sleep(300);
    expect(watcher.watched()).toEqual([]);
    expect(fake.observers().filter(alive)).toEqual([]);
    expect(page.events().filter((event) => event.type === "output" || event.type === "watch")).toEqual([]);
    await page.reader.cancel();
  });

  test("a later watch for another pane finishes first: only that pane is watched, and the first one's observe process stops", async () => {
    const { watch, open, watcher, fake, hold, held } = await setup();
    const page = await open();
    hold("w1:p1");
    const first = watch("POST", "w1:p1", page.id);
    await until(() => held.length === 1, 2_000, "the first request to wait");
    expect((await watch("POST", "w1:p2", page.id)).status).toBe(200);
    await until(() => outputs(page).some((event) => event.data.pane_id === "w1:p2"), 3_000, "the second pane's output");
    held[0].release();
    expect((await first).status).toBe(200);
    await Bun.sleep(300);
    expect(watcher.watched()).toEqual(["w1:p2"]);
    expect(fake.observers().filter(alive)).toHaveLength(1);
    expect(outputs(page).map((event) => event.data.pane_id)).toEqual(["w1:p2"]);
    await page.reader.cancel();
  });
});

describe("streamed and polled text render the same", () => {
  test("the same screen by the event path and by the poll renders identical Reader and shell HTML", async () => {
    const { watch, open, request } = await setup();
    const page = await open();
    await watch("POST", "w1:p1", page.id);
    await until(() => outputs(page).length === 1, 3_000, "the output");
    const streamed = String(outputs(page)[0].data.text);
    const polled = (await (await request("GET", "/api/terminals/w1%3Ap1/output")).json()).text;
    expect(readerHtml(streamed)).toBe(readerHtml(polled));
    expect(shellHtml(streamed)).toBe(shellHtml(polled));
    // Not trivially equal: the Reader drew the styles and the joined line.
    expect(readerHtml(streamed)).toContain(`<span class="a-code">web/app.js</span>`);
    expect(readerHtml(streamed)).toContain("more detail more detail");
    await page.reader.cancel();
  });
});
