// Push notifications (D32): which status changes notify, what the notification
// says, and when it stays quiet. The real roster and herdr client run over a
// fake herdr; herdr's events and the push are stand-ins that record.
import { afterAll, describe, expect, test } from "bun:test";
import { createHerdr } from "../server/herdr";
import { DEBOUNCE_MS, createNotifier, notificationFor, plainText } from "../server/notifier";
import type { Payload } from "../server/push";
import { createRoster } from "../server/roster";
import type { Terminal } from "../server/terminals";
import { makeFakeHerdr, type FakeAgent, type FakeConfig } from "./fake-herdr";
import { until } from "./support/fake-events";
import { FOOTER } from "./support/screens";

const fakes: ReturnType<typeof makeFakeHerdr>[] = [];
const notifiers: ReturnType<typeof createNotifier>[] = [];
// The tests of a group run side by side, so everything is cleaned up once, at the end.
afterAll(() => {
  notifiers.splice(0).forEach((notifier) => notifier.stop());
  fakes.splice(0).forEach((fake) => fake.dispose());
});

const WEATHER = "w8:p1";
const INVESTOR = "w9:pD";
const HERMUX = "w9:pE";
const SHELL = "w9:p2";
const agent = (pane_id: string, agent_status: string, fields: Partial<FakeAgent>): FakeAgent => ({
  pane_id,
  workspace_id: pane_id.split(":")[0],
  agent: "atomic",
  agent_status,
  state_change_seq: 5,
  ...fields,
});
const AGENTS = [
  agent(WEATHER, "idle", { tab_id: "w8:t3", cwd: "/home/you/weather-app", terminal_title_stripped: "atomic - weather-app" }),
  agent(INVESTOR, "working", { tab_id: "w9:tD", cwd: "/home/you/usage-dashboard", terminal_title_stripped: "atomic - investor path - usage-dashboard" }),
  agent(HERMUX, "idle", { tab_id: "w9:tE", cwd: "/home/you/hermux", terminal_title_stripped: "atomic - hermux" }),
];
const TABS = [
  { tab_id: "w8:t3", workspace_id: "w8", label: "2", number: 3 },
  { tab_id: "w9:tD", workspace_id: "w9", label: "next work", number: 13 },
  { tab_id: "w9:tE", workspace_id: "w9", label: "5", number: 14 },
  { tab_id: "w9:tS", workspace_id: "w9", label: "server", number: 15 },
];
const SHELLS = [{ pane_id: SHELL, workspace_id: "w9", tab_id: "w9:tS", cwd: "/home/you/hermux", terminal_title_stripped: "bun server/main.ts" }];
const OUTPUTS = {
  [WEATHER]: `Which database should I use?${FOOTER}`,
  [INVESTOR]: `Finished the investor path.${FOOTER}`,
  [HERMUX]: `Nothing to report.${FOOTER}`,
  [SHELL]: "$ bun server/main.ts\nlistening\n",
};

// The notifier over a fake herdr. `change` is what happens on the laptop: herdr
// now reports the new status, and says so in an event.
async function setup({ subscribers = true, config = {}, debounceMs = 40 }: { subscribers?: boolean; config?: Partial<FakeConfig>; debounceMs?: number } = {}) {
  const state: FakeConfig = { agents: AGENTS.map((entry) => ({ ...entry })), shells: SHELLS, tabs: TABS, outputs: OUTPUTS, ...config };
  const fake = makeFakeHerdr(state);
  fakes.push(fake);
  const real = createHerdr(fake.bin);
  let listed = () => {};
  const seeded = new Promise<void>((resolve) => (listed = resolve));
  const herdr = {
    list: async () => {
      const agents = await real.list();
      listed();
      return agents;
    },
  };
  const listeners = new Set<(event: Parameters<Parameters<Parameters<typeof createNotifier>[0]["events"]["subscribe"]>[0]>[0]) => void>();
  const events = {
    subscribe: (listener: (event: { type: "live"; live: boolean } | { type: "change"; changed?: { pane_id: string; agent_status: string; agent?: string | null }[]; refetch: true } | { type: "output"; pane_id: string }) => void) => {
      listeners.add(listener);
      listener({ type: "live", live: true });
      return () => void listeners.delete(listener);
    },
  };
  const sent: Payload[] = [];
  const viewing = new Set<string>();
  const hasSubscribers = { value: subscribers };
  const notifier = createNotifier({
    events,
    herdr,
    roster: createRoster(real, Date.now),
    push: { hasSubscribers: () => hasSubscribers.value, broadcast: async (payload) => void sent.push(payload) },
    watcher: { viewed: (paneId) => viewing.has(paneId) },
    debounceMs,
  });
  notifiers.push(notifier);
  notifier.start();
  await seeded;
  await Bun.sleep(20);
  const emit = (paneId: string, status: string, agent: string | null = "atomic") => {
    for (const listener of listeners) listener({ type: "change", changed: [{ pane_id: paneId, agent_status: status, agent }], refetch: true });
  };
  return {
    sent,
    viewing,
    hasSubscribers,
    calls: () => fake.calls(),
    emit,
    // The laptop's agent changes status: herdr lists it so, and tells us.
    change(paneId: string, status: string) {
      state.agents = (state.agents ?? []).map((entry) => (entry.pane_id === paneId ? { ...entry, agent_status: status } : entry));
      fake.setConfig(state);
      emit(paneId, status);
    },
    // herdr lists the status without an event having told us.
    quietly(paneId: string, status: string) {
      state.agents = (state.agents ?? []).map((entry) => (entry.pane_id === paneId ? { ...entry, agent_status: status } : entry));
      fake.setConfig(state);
    },
    // Long enough for a notification that is going to be sent to have been sent.
    quiet: () => Bun.sleep(40 + 600),
  };
}

describe.concurrent("which changes notify", () => {
  test("an agent that becomes blocked needs you: one notification with the folder, its session and the question", async () => {
    const { sent, change } = await setup();
    change(WEATHER, "blocked");
    await until(() => sent.length === 1, 3_000, "the notification");
    expect(sent).toEqual([{ title: "weather-app · tab 2 needs you", body: "Which database should I use?", pane_id: WEATHER, tag: `pane-${WEATHER}` }]);
  });

  test("an agent that goes from working to done has finished: one notification with its session and its latest line", async () => {
    const { sent, change } = await setup();
    change(INVESTOR, "done");
    await until(() => sent.length === 1, 3_000, "the notification");
    expect(sent).toEqual([{ title: "usage-dashboard · investor path finished", body: "Finished the investor path.", pane_id: INVESTOR, tag: `pane-${INVESTOR}` }]);
  });

  test("blocked straight from working notifies too, and the one that was blocked and answers (working) and finishes (done) notifies twice in all", async () => {
    const { sent, change, quiet } = await setup();
    change(INVESTOR, "blocked");
    await until(() => sent.length === 1, 3_000, "the first notification");
    change(INVESTOR, "working");
    await quiet();
    change(INVESTOR, "done");
    await until(() => sent.length === 2, 3_000, "the second notification");
    expect(sent.map((payload) => payload.title)).toEqual(["usage-dashboard · investor path needs you", "usage-dashboard · investor path finished"]);
  });

  for (const [from, to] of [
    ["idle", "idle"],
    ["idle", "working"],
    ["idle", "done"],
    ["working", "idle"],
    ["working", "unknown"],
    ["blocked", "idle"],
    ["blocked", "working"],
    ["done", "idle"],
    ["done", "done"],
  ]) {
    test(`${from} to ${to} is not news`, async () => {
      const { sent, change, quietly, emit, quiet } = await setup();
      const pane = HERMUX;
      // Get the agent into `from` first (without notifying), then change it.
      quietly(pane, from);
      emit(pane, from);
      await quiet();
      sent.length = 0;
      change(pane, to);
      await quiet();
      expect(sent).toEqual([]);
    });
  }

  test("the same status told twice notifies once", async () => {
    const { sent, change, emit } = await setup();
    change(WEATHER, "blocked");
    emit(WEATHER, "blocked");
    emit(WEATHER, "blocked");
    await until(() => sent.length === 1, 3_000, "the notification");
    await Bun.sleep(700);
    expect(sent).toHaveLength(1);
  });

  test("the same status told again doesn't cancel the notification waiting for it", async () => {
    const { sent, change, emit } = await setup();
    change(INVESTOR, "done");
    emit(INVESTOR, "done");
    await until(() => sent.length === 1, 3_000, "the notification");
  });

  test("a done that doesn't come from working isn't a finish (an agent first heard of as done)", async () => {
    const { sent, emit, quietly, quiet } = await setup();
    quietly("w0:p0", "done");
    emit("w0:p0", "done");
    await quiet();
    expect(sent).toEqual([]);
  });

  test("an agent that was working when the server started has a before: its first done is a finish", async () => {
    const { sent, change } = await setup();
    // INVESTOR is working in herdr's list from the start; no event ever said so.
    change(INVESTOR, "done");
    await until(() => sent.length === 1, 3_000, "the notification");
  });

  test("a Shell is never notified, however its status reads", async () => {
    const { sent, change, emit, quiet } = await setup();
    emit(SHELL, "blocked", null);
    emit(SHELL, "working", null);
    emit(SHELL, "done", null);
    change(SHELL, "blocked");
    await quiet();
    expect(sent).toEqual([]);
  });
});

describe.concurrent("the debounce", () => {
  test("is a few seconds by default", () => {
    expect(DEBOUNCE_MS).toBeGreaterThanOrEqual(3_000);
    expect(DEBOUNCE_MS).toBeLessThanOrEqual(5_000);
  });

  test("an agent that flaps blocked, working, blocked within it notifies once", async () => {
    const { sent, change } = await setup();
    change(WEATHER, "blocked");
    change(WEATHER, "working");
    change(WEATHER, "blocked");
    await until(() => sent.length === 1, 3_000, "the notification");
    await Bun.sleep(700);
    expect(sent).toHaveLength(1);
  });

  test("an agent that is blocked and then answered within it isn't notified at all", async () => {
    const { sent, change, quiet } = await setup();
    change(WEATHER, "blocked");
    change(WEATHER, "working");
    await quiet();
    expect(sent).toEqual([]);
  });

  test("a finish that is cleared (done to idle) within it isn't notified", async () => {
    const { sent, change, quiet } = await setup();
    change(INVESTOR, "done");
    change(INVESTOR, "idle");
    await quiet();
    expect(sent).toEqual([]);
  });

  test("sends nothing until the whole debounce has passed, then sends", async () => {
    const { sent, change } = await setup({ debounceMs: 800 });
    const started = Date.now();
    change(WEATHER, "blocked");
    await Bun.sleep(500);
    expect(sent).toEqual([]);
    await until(() => sent.length === 1, 3_000, "the notification");
    expect(Date.now() - started).toBeGreaterThanOrEqual(800);
  });

  test("a change that herdr no longer shows when the time is up isn't notified", async () => {
    const { sent, emit, quietly, quiet } = await setup();
    emit(WEATHER, "blocked");
    quietly(WEATHER, "working");
    await quiet();
    expect(sent).toEqual([]);
  });

  test("another blocked that comes after a notification, once the agent was answered in between, notifies again", async () => {
    const { sent, change, quiet } = await setup();
    change(WEATHER, "blocked");
    await until(() => sent.length === 1, 3_000, "the first notification");
    change(WEATHER, "working");
    await quiet();
    change(WEATHER, "blocked");
    await until(() => sent.length === 2, 3_000, "the second notification");
    expect(sent[1].tag).toBe(sent[0].tag);
  });

  test("two agents changing together are notified separately, each once", async () => {
    const { sent, change } = await setup();
    change(WEATHER, "blocked");
    change(INVESTOR, "done");
    await until(() => sent.length === 2, 3_000, "both notifications");
    expect(sent.map((payload) => payload.pane_id).sort()).toEqual([WEATHER, INVESTOR]);
  });
});

describe.concurrent("when a page is viewing the Terminal", () => {
  test("no notification for a pane a visible page watches", async () => {
    const { sent, change, viewing, quiet } = await setup();
    viewing.add(WEATHER);
    change(WEATHER, "blocked");
    await quiet();
    expect(sent).toEqual([]);
  });

  test("only that pane is silenced: another pane still notifies", async () => {
    const { sent, change, viewing } = await setup();
    viewing.add(WEATHER);
    change(WEATHER, "blocked");
    change(INVESTOR, "done");
    await until(() => sent.length === 1, 3_000, "the notification");
    expect(sent[0].pane_id).toBe(INVESTOR);
  });

  test("the page looking away before the time is up lets it notify (it is decided when it is sent)", async () => {
    const { sent, change, viewing } = await setup();
    viewing.add(WEATHER);
    change(WEATHER, "blocked");
    viewing.delete(WEATHER);
    await until(() => sent.length === 1, 3_000, "the notification");
  });

  test("a page that starts looking before the time is up silences it", async () => {
    const { sent, change, viewing, quiet } = await setup();
    change(WEATHER, "blocked");
    viewing.add(WEATHER);
    await quiet();
    expect(sent).toEqual([]);
  });
});

describe.concurrent("when nobody can be notified", () => {
  test("with no phone subscribed it doesn't even ask herdr about the pane", async () => {
    const { sent, change, calls, quiet } = await setup({ subscribers: false });
    const before = calls().length;
    change(WEATHER, "blocked");
    await quiet();
    expect(sent).toEqual([]);
    expect(calls().length).toBe(before);
  });
});

describe.concurrent("what the notifier asks of herdr", () => {
  test("it only reads: lists and reads, never a send, a key or a focus", async () => {
    const { change, sent, calls } = await setup();
    change(WEATHER, "blocked");
    change(INVESTOR, "done");
    await until(() => sent.length === 2, 3_000, "both notifications");
    const commands = new Set(calls().map((call) => call.slice(0, 2).join(" ")));
    for (const command of commands) expect(["agent list", "pane list", "workspace list", "tab list", "agent read", "pane read"]).toContain(command);
    expect(commands.has("agent read") || commands.has("pane read")).toBe(true);
    // Only the changed panes are read, never a shell or an idle agent.
    const read = calls().filter((call) => call[1] === "read").map((call) => call[2]);
    expect([...new Set(read)].sort()).toEqual([WEATHER, INVESTOR]);
  });
});

const terminal = (fields: Partial<Terminal> = {}): Terminal => ({
  pane_id: "w1:p1",
  kind: "atomic",
  status: "blocked",
  workspace: { id: "w1", label: null },
  tab: { id: "w1:t1", label: null, number: null },
  cwd: "/home/you/weather-app",
  title: null,
  ...fields,
});

describe("the notification's words", () => {
  test("the title is the folder and the name, then what happened", () => {
    expect(notificationFor(terminal({ title: "atomic - investor path - weather-app" }), "needs-you").title).toBe("weather-app · investor path needs you");
    expect(notificationFor(terminal({ title: "atomic - investor path - weather-app" }), "finished").title).toBe("weather-app · investor path finished");
  });

  test("the name is the app's own (D31): the session, else the tab's label, else tab N, else the pane ID", () => {
    const name = (fields: Partial<Terminal>) => notificationFor(terminal(fields), "needs-you").title.replace("weather-app · ", "").replace(" needs you", "");
    expect(name({ title: "atomic - investor path - weather-app", tab: { id: "t", label: "next work", number: 3 } })).toBe("investor path");
    expect(name({ title: "atomic - weather-app", tab: { id: "t", label: "next work", number: 3 } })).toBe("next work");
    expect(name({ tab: { id: "t", label: "2", number: 3 } })).toBe("tab 2");
    expect(name({ tab: { id: "t", label: "", number: 3 } })).toBe("tab 3");
    expect(name({ tab: { id: null, label: null, number: null } })).toBe("w1:p1");
  });

  test("a folder is the last part of the working directory, and the pane ID when there is none", () => {
    expect(notificationFor(terminal({ cwd: "/home/you/deep/path/weather-app" }), "needs-you").title).toStartWith("weather-app · ");
    expect(notificationFor(terminal({ cwd: null }), "needs-you").title).toStartWith("w1:p1 · ");
  });

  test("the payload names its pane, and its tag is that pane's, the same for either kind of notification", () => {
    const needs = notificationFor(terminal({ pane_id: "w8:p1" }), "needs-you");
    const done = notificationFor(terminal({ pane_id: "w8:p1" }), "finished");
    const other = notificationFor(terminal({ pane_id: "w8:p2" }), "needs-you");
    expect([needs.pane_id, needs.tag === done.tag, needs.tag === other.tag, Object.keys(needs).sort()]).toEqual(["w8:p1", true, false, ["body", "pane_id", "tag", "title"]]);
  });

  test("the body is the latest line, or a plain fallback when there is none", () => {
    expect(notificationFor(terminal({ latest_line: "Which database?" }), "needs-you").body).toBe("Which database?");
    expect(notificationFor(terminal({ latest_line: null }), "needs-you").body).toBe("Waiting for your answer.");
    expect(notificationFor(terminal({}), "finished").body).toBe("Finished.");
    expect(notificationFor(terminal({ latest_line: " \n\t " }), "finished").body).toBe("Finished.");
  });

  test("a long body is cut to 120 characters with an ellipsis; 120 exactly is left alone", () => {
    expect(notificationFor(terminal({ latest_line: "a".repeat(120) }), "needs-you").body).toBe("a".repeat(120));
    const cut = notificationFor(terminal({ latest_line: `${"word ".repeat(60)}` }), "needs-you").body;
    expect([...cut]).toHaveLength(120);
    expect(cut.endsWith("…")).toBe(true);
    expect(notificationFor(terminal({ latest_line: "b".repeat(121) }), "needs-you").body).toBe(`${"b".repeat(119)}…`);
  });

  test("a cut never splits a character made of two UTF-16 units, or ends on a space", () => {
    const body = notificationFor(terminal({ latest_line: "😀".repeat(200) }), "needs-you").body;
    expect(() => encodeURIComponent(body)).not.toThrow();
    expect([...body]).toHaveLength(120);
    expect(notificationFor(terminal({ latest_line: `${"c".repeat(118)} ${"d".repeat(10)}` }), "needs-you").body).toBe(`${"c".repeat(118)}…`);
  });

  test("a long folder or name can't push the words after it out of the title", () => {
    const title = notificationFor(terminal({ cwd: `/x/${"f".repeat(200)}`, title: `atomic - ${"s".repeat(300)} - ${"f".repeat(200)}` }), "needs-you").title;
    expect(title.endsWith(" needs you")).toBe(true);
    expect([...title].length).toBeLessThanOrEqual(40 + 3 + 60 + 10);
  });

  test("it is plain text: markup stays as typed, and control characters, colour codes and newlines never reach it", () => {
    const hostile = notificationFor(
      terminal({ cwd: "/x/<f&o>", title: "atomic - <img src=x onerror=alert(1)> & \"q\" - <f&o>", latest_line: "\u001b[31mred\u001b[0m <script>alert(1)</script>\nline two\u0000\u0007\ttab\u202e" }),
      "needs-you",
    );
    expect(hostile).toEqual({
      title: '<f&o> · <img src=x onerror=alert(1)> & "q" needs you',
      body: "red <script>alert(1)</script> line two tab",
      pane_id: "w1:p1",
      tag: "pane-w1:p1",
    });
    expect(`${hostile.title}${hostile.body}`).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202e]/);
    expect(hostile.title).not.toContain("&lt;");
  });

  test("plainText collapses whitespace and trims", () => {
    expect(plainText("  a \n\n b\t\tc  ", 50)).toBe("a b c");
    expect(plainText("x".repeat(10), 5)).toBe("xxxx…");
  });
});
