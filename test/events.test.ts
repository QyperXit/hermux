import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../server/app";
import { LIFECYCLE, createLiveEvents, herdrSocketPath, type LiveEvent, type LiveEvents } from "../server/events";
import { createHerdr } from "../server/herdr";
import { makeFakeHerdr } from "./fake-herdr";
import { ALLOWED_LOGIN, auditCalls } from "./support/http";
import { makeFakeEvents, until, type FakeEvents } from "./support/fake-events";
import { WEB } from "./support/agents";

const PANES = ["w1:p1", "w1:p2"];
const fakes: FakeEvents[] = [];
const hubs: LiveEvents[] = [];
const herdrFakes: ReturnType<typeof makeFakeHerdr>[] = [];
afterEach(() => hubs.splice(0).forEach((hub) => hub.stop()));
afterAll(() => {
  fakes.forEach((fake) => fake.dispose());
  herdrFakes.forEach((fake) => fake.dispose());
});

// The subscription to a fake herdr socket, with the panes `pane list` gives
// (a fake herdr binary, so every herdr command it runs is audited too).
function setup({ listen = true, panes = PANES } = {}) {
  const events = makeFakeEvents({ listen });
  fakes.push(events);
  const herdrFake = makeFakeHerdr({ shells: panes.map((pane_id) => ({ pane_id, workspace_id: "w1", tab_id: "w1:t1" })) });
  herdrFakes.push(herdrFake);
  const herdr = createHerdr(herdrFake.bin);
  const hub = createLiveEvents({
    socketPath: events.path,
    panes: async () => (await herdr.panes()).map((pane) => pane.pane_id),
    retryMs: { first: 20, max: 80 },
    resubscribeMs: 10,
  });
  hubs.push(hub);
  const heard: LiveEvent[] = [];
  hub.subscribe((event) => heard.push(event));
  return { events, herdrFake, hub, heard, setPanes: (next: string[]) => herdrFake.setConfig({ shells: next.map((pane_id) => ({ pane_id, workspace_id: "w1", tab_id: "w1:t1" })) }) };
}

const subscriptionsOf = (request: Record<string, unknown>) => (request.params as { subscriptions: Record<string, unknown>[] }).subscriptions;

// Every line the server ever wrote to herdr's socket is one events.subscribe
// request, and subscribes only to the read-only lifecycle events and the
// status of named panes.
function auditRequests(events: FakeEvents) {
  for (const request of events.requests) {
    expect(Object.keys(request).sort()).toEqual(["id", "method", "params"]);
    expect(request.method).toBe("events.subscribe");
    for (const entry of subscriptionsOf(request)) {
      if (entry.type === "pane.agent_status_changed") expect(Object.keys(entry).sort()).toEqual(["pane_id", "type"]);
      else expect([entry, LIFECYCLE.includes(String(entry.type)) && Object.keys(entry).length === 1]).toEqual([entry, true]);
    }
  }
}

describe("the subscription to herdr's events", () => {
  test("one events.subscribe with the lifecycle events and every pane's status; live once herdr starts it", async () => {
    const { events, herdrFake, hub, heard } = setup();
    expect(hub.isLive()).toBe(false);
    hub.start();
    await until(() => hub.isLive(), 2_000, "live");
    expect(events.requests).toHaveLength(1);
    expect(events.requests[0].method).toBe("events.subscribe");
    expect(subscriptionsOf(events.requests[0])).toEqual([
      ...LIFECYCLE.map((type) => ({ type })),
      { type: "pane.agent_status_changed", pane_id: "w1:p1" },
      { type: "pane.agent_status_changed", pane_id: "w1:p2" },
    ]);
    expect(heard).toEqual([{ type: "live", live: false }, { type: "live", live: true }]);
    expect(herdrFake.calls()).toEqual([["pane", "list"]]);
    auditCalls(herdrFake.calls());
    auditRequests(events);
  });

  test("a status change is passed on with its record and as output activity; other events as a refetch", async () => {
    const { events, hub, heard } = setup();
    hub.start();
    await until(() => hub.isLive());
    heard.length = 0;
    events.push("pane.agent_status_changed", { agent: "atomic", agent_status: "blocked", pane_id: "w1:p1", workspace_id: "w1" });
    events.push("pane_updated", { pane: { pane_id: "w1:p2", agent_status: "working", revision: 3 }, type: "pane_updated" });
    events.push("tab_renamed", { tab_id: "w1:t1", workspace_id: "w1", label: "x", type: "tab_renamed" });
    events.push("something_new", {});
    await until(() => heard.length >= 6);
    expect(heard).toEqual([
      { type: "change", changed: [{ pane_id: "w1:p1", agent_status: "blocked", agent: "atomic" }], refetch: true },
      { type: "output", pane_id: "w1:p1" },
      { type: "change", refetch: true },
      { type: "output", pane_id: "w1:p2" },
      { type: "change", refetch: true },
      { type: "change", refetch: true },
    ]);
  });

  test("a new pane opens a new subscription that names it, then closes the old one", async () => {
    const { events, hub, heard, setPanes } = setup();
    hub.start();
    await until(() => hub.isLive());
    setPanes([...PANES, "w1:p3"]);
    events.push("pane_created", { pane: { pane_id: "w1:p3" }, type: "pane_created" });
    await until(() => events.requests.length === 2 && events.subscribers() === 1, 2_000, "the new subscription");
    expect(subscriptionsOf(events.requests[1]).filter((entry) => entry.type === "pane.agent_status_changed").map((entry) => entry.pane_id)).toEqual([...PANES, "w1:p3"]);
    expect(heard.filter((event) => event.type === "live")).toEqual([{ type: "live", live: false }, { type: "live", live: true }]);
    heard.length = 0;
    events.push("pane.agent_status_changed", { agent_status: "working", pane_id: "w1:p3", workspace_id: "w1" });
    await until(() => heard.length >= 2);
    expect(heard[0]).toEqual({ type: "change", changed: [{ pane_id: "w1:p3", agent_status: "working" }], refetch: true });
    auditRequests(events);
  });

  test("a dropped subscription says so, and comes back with back-off", async () => {
    const { events, hub, heard } = setup();
    hub.start();
    await until(() => hub.isLive());
    events.drop();
    await until(() => !hub.isLive(), 2_000, "not live");
    await until(() => hub.isLive(), 2_000, "live again");
    expect(heard.filter((event) => event.type === "live").map((event) => event.type === "live" && event.live)).toEqual([false, true, false, true]);
    expect(events.requests).toHaveLength(2);

    events.answerWith({ code: "events_lost", message: "subscriber fell behind" });
    events.drop();
    await until(() => events.requests.length >= 4, 2_000, "retries");
    expect(hub.isLive()).toBe(false);
    events.answerWith("start");
    await until(() => hub.isLive(), 2_000, "live after the refusals");
    auditRequests(events);
  });

  test("while herdr's socket is missing it retries without running herdr, and subscribes once it is there", async () => {
    const { events, herdrFake, hub } = setup({ listen: false });
    hub.start();
    await Bun.sleep(150);
    expect(hub.isLive()).toBe(false);
    expect(herdrFake.calls()).toEqual([]);
    events.start();
    await until(() => hub.isLive(), 2_000, "live");
    expect(herdrFake.calls()).toEqual([["pane", "list"]]);
  });

  test("a failed `pane list` sends no request and is retried", async () => {
    const { events, herdrFake, hub } = setup();
    herdrFake.setConfig({ answers: { "pane list": { exit: 1, stderr: JSON.stringify({ error: { code: "server_unreachable", message: "down" } }) } } });
    hub.start();
    await until(() => herdrFake.calls().length >= 2, 2_000, "a retry");
    expect(events.requests).toEqual([]);
    expect(hub.isLive()).toBe(false);
    herdrFake.setConfig({ shells: [{ pane_id: "w1:p1" }] });
    await until(() => hub.isLive(), 2_000, "live");
  });

  test("stop closes the subscription", async () => {
    const { events, hub } = setup();
    hub.start();
    await until(() => hub.isLive());
    hub.stop();
    expect(hub.isLive()).toBe(false);
    await until(() => events.subscribers() === 0, 2_000, "closed");
  });

  test("reconnects back off, doubling up to the limit", async () => {
    const retryMs = { first: 20, max: 80 };
    const tries: number[] = [];
    const hub = createLiveEvents({
      socketPath: "/nowhere/herdr.sock",
      panes: async () => [],
      connect: async () => {
        tries.push(Date.now());
        throw new Error("no socket");
      },
      retryMs,
    });
    hubs.push(hub);
    hub.start();
    await until(() => tries.length >= 6, 2_000, "six tries");
    hub.stop();
    const gaps = tries.slice(1).map((at, index) => at - tries[index]);
    const schedule = [retryMs.first, retryMs.first * 2, retryMs.max, retryMs.max, retryMs.max];
    expect(gaps.map((gap, index) => gap >= schedule[index] - 2)).toEqual([true, true, true, true, true]);
    expect(gaps[1]).toBeLessThan(retryMs.max);
    expect(gaps.slice(2).every((gap) => gap < retryMs.max * 2)).toBe(true);
  });

  test("the socket is the one the herdr CLI would use", () => {
    expect(herdrSocketPath({ HERDR_SOCKET_PATH: "/run/x.sock", HERDR_SESSION: "s" }, "/home/q")).toBe("/run/x.sock");
    expect(herdrSocketPath({ HERDR_SESSION: "work" }, "/home/q")).toBe("/home/q/.config/herdr/sessions/work/herdr.sock");
    expect(herdrSocketPath({}, "/home/q")).toBe("/home/q/.config/herdr/herdr.sock");
  });
});

// Reads a stream's text until `ok` holds for it.
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, ok: (text: string) => boolean, text = "") {
  const decoder = new TextDecoder();
  while (!ok(text)) {
    const { value, done } = await Promise.race([reader.read(), Bun.sleep(2_000).then(() => ({ value: undefined, done: true }))]);
    if (done) throw new Error(`The stream ended or stalled; so far: ${JSON.stringify(text)}`);
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("GET /api/events, the page's stream", () => {
  async function appWithEvents() {
    const { events, hub, herdrFake } = setup();
    hub.start();
    await until(() => hub.isLive());
    const app = createApp({ herdr: createHerdr(herdrFake.bin), allowedLogin: ALLOWED_LOGIN, webRoot: WEB, events: hub });
    const request = (method = "GET", headers: Record<string, string> = {}, login: string | null = ALLOWED_LOGIN) => {
      const all = new Headers(headers);
      if (login !== null) all.set("Tailscale-User-Login", login);
      return app(new Request("http://127.0.0.1:8787/api/events", { method, headers: all }));
    };
    return { events, hub, request };
  }

  test("streams server-sent events: a retry, the live state, then changes and output activity", async () => {
    const { events, request } = await appWithEvents();
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const reader = response.body!.getReader();
    let text = await readUntil(reader, (so) => so.includes("event: live"));
    expect(text).toBe('retry: 2000\n\nevent: live\ndata: {"live":true}\n\n');
    events.push("pane.agent_status_changed", { agent: "atomic", agent_status: "working", pane_id: "w1:p2", workspace_id: "w1" });
    text = await readUntil(reader, (so) => so.includes("event: output"));
    expect(text).toBe('event: change\ndata: {"changed":[{"pane_id":"w1:p2","agent_status":"working","agent":"atomic"}],"refetch":true}\n\nevent: output\ndata: {"pane_id":"w1:p2"}\n\n');
    events.drop();
    text = await readUntil(reader, (so) => so.includes('{"live":true}'));
    expect(text).toBe('event: live\ndata: {"live":false}\n\nevent: live\ndata: {"live":true}\n\n');
    await reader.cancel();
  });

  test("403 without the right login, and no stream", async () => {
    const { request } = await appWithEvents();
    for (const login of [null, "", "someone.else@example.com", "You@Example.com"]) {
      const response = await request("GET", {}, login);
      expect([login, response.status, await response.text()]).toEqual([login, 403, "Forbidden\n"]);
    }
  });

  test("GET only", async () => {
    const { request } = await appWithEvents();
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      const response = await request(method, { "content-type": "application/json", "sec-fetch-site": "same-origin" });
      expect([method, response.status]).toEqual([method, 405]);
    }
  });

  test("only this page's own origin: a cross-site or same-site request is refused", async () => {
    const { request } = await appWithEvents();
    for (const site of ["cross-site", "same-site"]) {
      const response = await request("GET", { "sec-fetch-site": site });
      expect([site, response.status]).toEqual([site, 403]);
      expect((await response.json()).error.code).toBe("cross_site_request");
    }
    for (const site of ["same-origin", "none"]) {
      const response = await request("GET", { "sec-fetch-site": site });
      expect([site, response.status]).toEqual([site, 200]);
      await response.body!.cancel();
    }
  });
});
