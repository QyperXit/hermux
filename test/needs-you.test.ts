import { afterAll, describe, expect, test } from "bun:test";
import type { LiveEvent } from "../server/events";
import { createHerdr } from "../server/herdr";
import { createNeedsYou } from "../server/needs-you";
import { createHistory, openSessionStore } from "../server/history";
import { createNotifier } from "../server/notifier";
import type { Payload } from "../server/push";
import { createRoster } from "../server/roster";
import { makeFakeHerdr, type FakeAgent, type FakeConfig } from "./fake-herdr";
import { until } from "./support/fake-events";
import { addEntries, bumpLastSeq, makeStore, type Entry } from "./support/session-store";
import { FOOTER } from "./support/screens";
import { DONE_HELPER_SHELL_SCREEN, FORK_DONE_HELPER_SHELL_SCREEN, MAIN_AGAIN_SCREEN, PAUSED_MAIN_SCREEN, PAUSED_PANEL_SCREEN, PAUSED_SHOWN_SCREEN, QUESTION_SCREEN, SHOWN_WORKING_SCREEN, TASKS_PAUSED_SCREEN, WAITING_SCREEN } from "./support/atomic-0100";

const fakes: ReturnType<typeof makeFakeHerdr>[] = [];
const stops: (() => void)[] = [];
afterAll(() => {
  stops.splice(0).forEach((stop) => stop());
  fakes.splice(0).forEach((fake) => fake.dispose());
});

const SHED = "w8:p1";
const QUIET = "w9:pD";
const agent = (pane_id: string, agent_status: string, extra: Partial<FakeAgent> = {}): FakeAgent => ({
  pane_id,
  workspace_id: pane_id.split(":")[0],
  tab_id: `${pane_id.split(":")[0]}:t1`,
  agent: "atomic",
  agent_status,
  state_change_seq: 5,
  cwd: "/home/you/garden",
  terminal_title_stripped: "atomic - garden",
  ...extra,
});

function herdrWith(config: FakeConfig) {
  const fake = makeFakeHerdr(config);
  fakes.push(fake);
  return { fake, herdr: createHerdr(fake.bin) };
}

function fakeEvents() {
  const listeners = new Set<(event: LiveEvent) => void>();
  let live = true;
  return {
    subscribe(listener: (event: LiveEvent) => void) {
      listeners.add(listener);
      listener({ type: "live", live });
      return () => void listeners.delete(listener);
    },
    isLive: () => live,
    push(event: LiveEvent) {
      if (event.type === "live") live = event.live;
      for (const listener of listeners) listener(event);
    },
  };
}

const changed = (pane_id: string, agent_status: string): LiveEvent => ({ type: "change", changed: [{ pane_id, agent_status }], refetch: true });

describe.concurrent("the agent list, terminals and the notifier's look", () => {
  test("herdr's working agent whose screen shows a waiting subagent is blocked, its Latest line naming the subagent", async () => {
    const { herdr } = herdrWith({ agents: [agent(SHED, "working"), agent(QUIET, "working", { tab_id: "w9:t1" })], workspaces: [{ workspace_id: "w8", label: "garden" }], outputs: { [SHED]: WAITING_SCREEN, [QUIET]: SHOWN_WORKING_SCREEN } });
    const roster = createRoster(herdr, () => 1_000);
    const agents = await roster.agents([]);
    expect(agents.map((row) => [row.pane_id, row.agent_status, row.latest_line])).toEqual([
      [SHED, "blocked", "asker needs you: Which roof should the shed get?"],
      [QUIET, "working", "∀ Wait(task-1-1-1)"],
    ]);
    expect((await roster.terminal(SHED))?.status).toBe("blocked");
    expect((await roster.terminals([])).map((row) => [row.pane_id, row.status])).toEqual([
      [SHED, "blocked"],
      [QUIET, "working"],
    ]);
    expect((await roster.workspace("w8")).terminals.map((row) => row.status)).toEqual(["blocked"]);
  });

  test("only herdr's working is turned: a done agent's old screen keeps its status", async () => {
    const { herdr } = herdrWith({ agents: [agent(SHED, "done")], outputs: { [SHED]: WAITING_SCREEN } });
    expect((await createRoster(herdr, () => 1_000).agents([]))[0].agent_status).toBe("done");
  });

  test("the look reads only Atomic agents herdr calls working; another kind is never turned blocked", async () => {
    const PI = "w7:p1";
    const { herdr, fake } = herdrWith({ agents: [agent(SHED, "working"), agent(PI, "working", { agent: "pi", tab_id: "w7:t1" })], outputs: { [SHED]: WAITING_SCREEN, [PI]: WAITING_SCREEN } });
    const roster = createRoster(herdr, () => 1_000);
    expect(await roster.lookForWaiting()).toEqual([
      { pane_id: SHED, agent_status: "working", waiting: true, paused: false },
      { pane_id: PI, agent_status: "working", waiting: false, paused: false },
    ]);
    expect(fake.calls().filter((call) => call[1] === "read").map((call) => call[2])).toEqual([SHED]);
    expect((await roster.agents([])).map((row) => [row.pane_id, row.agent_status])).toEqual([
      [SHED, "blocked"],
      [PI, "working"],
    ]);
  });

  test("the look reads only the agents herdr calls working, and reuses a read the list made", async () => {
    const { herdr, fake } = herdrWith({ agents: [agent(SHED, "working"), agent(QUIET, "idle", { tab_id: "w9:t1" })], outputs: { [SHED]: WAITING_SCREEN, [QUIET]: `Idle.${FOOTER}` } });
    const roster = createRoster(herdr, () => 1_000);
    expect(await roster.lookForWaiting()).toEqual([
      { pane_id: SHED, agent_status: "working", waiting: true, paused: false },
      { pane_id: QUIET, agent_status: "idle", waiting: false, paused: false },
    ]);
    await roster.agents([]);
    await roster.lookForWaiting();
    expect(fake.calls().filter((call) => call[1] === "read").map((call) => call[2])).toEqual([SHED, QUIET]);
  });
});

describe("the event stream", () => {
  async function setup(config: FakeConfig) {
    const { herdr, fake } = herdrWith(config);
    let clock = 1_000;
    const roster = createRoster(herdr, () => clock);
    const events = fakeEvents();
    const needsYou = createNeedsYou({ events, roster, lookMs: 60_000 });
    needsYou.start();
    stops.push(needsYou.stop);
    const heard: LiveEvent[] = [];
    needsYou.subscribe((event) => heard.push(event));
    // A new screen, read once the last read is too old to reuse.
    const show = (screen: string) => {
      fake.setConfig({ ...config, outputs: { ...config.outputs, [SHED]: screen } });
      clock += 5_000;
    };
    return { needsYou, events, heard, show, fake };
  }

  test("tells nothing on its first look, then turns working to blocked when a subagent waits and back when none does", async () => {
    const { needsYou, events, heard, show } = await setup({ agents: [agent(SHED, "working")], outputs: { [SHED]: WAITING_SCREEN } });
    await needsYou.look();
    expect(heard).toEqual([{ type: "live", live: true }]);
    events.push(changed(SHED, "working"));
    expect(heard.at(-1)).toEqual(changed(SHED, "blocked"));
    show(MAIN_AGAIN_SCREEN);
    await needsYou.look();
    expect(heard.at(-1)).toEqual(changed(SHED, "working"));
    show(QUESTION_SCREEN);
    await needsYou.look();
    expect(heard.at(-1)).toEqual(changed(SHED, "blocked"));
    events.push(changed(SHED, "done"));
    expect(heard.at(-1)).toEqual(changed(SHED, "done"));
  });

  test("a subagent that starts waiting after the first look is told as blocked", async () => {
    const { needsYou, events, heard, show } = await setup({ agents: [agent(SHED, "working")], outputs: { [SHED]: SHOWN_WORKING_SCREEN } });
    await needsYou.look();
    show(WAITING_SCREEN);
    await needsYou.look();
    expect(heard.at(-1)).toEqual(changed(SHED, "blocked"));
    events.push({ type: "output", pane_id: SHED });
    expect(heard.at(-1)).toEqual({ type: "output", pane_id: SHED });
  });

  test("reads nothing while herdr calls no agent working", async () => {
    const { needsYou, events, fake } = await setup({ agents: [agent(SHED, "idle")], outputs: { [SHED]: WAITING_SCREEN } });
    await needsYou.look();
    const after = fake.calls().length;
    await needsYou.look();
    await needsYou.look();
    expect(fake.calls().length).toBe(after);
    events.push(changed(SHED, "working"));
    await needsYou.look();
    expect(fake.calls().length).toBeGreaterThan(after);
  });

  test("reads nothing while herdr's events are down", async () => {
    const { needsYou, events, fake } = await setup({ agents: [agent(SHED, "working")], outputs: { [SHED]: WAITING_SCREEN } });
    events.push({ type: "live", live: false });
    await needsYou.look();
    expect(fake.calls()).toEqual([]);
  });
});

test("a notification says the agent needs you, naming the waiting subagent and its question", async () => {
  const config: FakeConfig = { agents: [agent(SHED, "working")], outputs: { [SHED]: SHOWN_WORKING_SCREEN }, tabs: [{ tab_id: "w8:t1", workspace_id: "w8", label: "shed", number: 1 }] };
  const { herdr, fake } = herdrWith(config);
  let clock = 1_000;
  const roster = createRoster(herdr, () => clock);
  const events = fakeEvents();
  const needsYou = createNeedsYou({ events, roster, lookMs: 60_000 });
  needsYou.start();
  const sent: Payload[] = [];
  const notifier = createNotifier({ events: needsYou, herdr, roster, push: { broadcast: async (payload) => void sent.push(payload), hasSubscribers: () => true }, watcher: { viewed: () => false }, debounceMs: 20 });
  notifier.start();
  stops.push(needsYou.stop, notifier.stop);
  await needsYou.look();
  fake.setConfig({ ...config, outputs: { [SHED]: WAITING_SCREEN } });
  clock += 5_000;
  await needsYou.look();
  await until(() => sent.length > 0, 3_000, "the notification");
  expect(sent).toEqual([{ title: "garden · shed needs you", body: "asker needs you: Which roof should the shed get?", pane_id: SHED, tag: `pane-${SHED}` }]);
});

describe("a paused helper", () => {
  test("herdr's working agent whose main screen proves only paused helpers left is paused, its Latest line saying so; no panel without the store is working", async () => {
    const PANEL = "w7:p1";
    const SHELL = "w6:p1";
    const { herdr } = herdrWith({
      agents: [agent(SHED, "working"), agent(QUIET, "working", { tab_id: "w9:t1" }), agent(PANEL, "working", { tab_id: "w7:t1" }), agent(SHELL, "working", { tab_id: "w6:t1" })],
      outputs: { [SHED]: PAUSED_MAIN_SCREEN, [QUIET]: WAITING_SCREEN, [PANEL]: PAUSED_PANEL_SCREEN, [SHELL]: DONE_HELPER_SHELL_SCREEN },
    });
    const roster = createRoster(herdr, () => 1_000);
    const rows = await roster.agents([]);
    expect(rows.map((row) => [row.pane_id, row.agent_status])).toEqual([
      [SHED, "working"],
      [QUIET, "blocked"],
      [PANEL, "paused"],
      [SHELL, "working"],
    ]);
    expect(rows.map((row) => row.latest_line)).toEqual([
      expect.stringMatching(/^The worker's completion notice/),
      "asker needs you: Which roof should the shed get?",
      "asker is paused · send to continue",
      expect.stringMatching(/^The subagent \(task-1-0-6\) has finished/),
    ]);
    expect(await roster.terminal(PANEL)).toMatchObject({ status: "paused", latest_line: "asker is paused · send to continue" });
    expect(Object.fromEntries((await roster.terminals([])).map((row) => [row.pane_id, row.status]))).toEqual({ [SHED]: "working", [QUIET]: "blocked", [PANEL]: "paused", [SHELL]: "working" });
    expect(await roster.lookForWaiting()).toEqual([
      { pane_id: SHED, agent_status: "working", waiting: false, paused: false },
      { pane_id: QUIET, agent_status: "working", waiting: true, paused: false },
      { pane_id: PANEL, agent_status: "working", waiting: false, paused: true },
      { pane_id: SHELL, agent_status: "working", waiting: false, paused: false },
    ]);
  });

  test("only herdr's working is turned: the same screen of a done agent, a helper on screen, or another kind keeps its status and line", async () => {
    const PI = "w7:p1";
    const { herdr } = herdrWith({
      agents: [agent(SHED, "done"), agent(QUIET, "working", { tab_id: "w9:t1" }), agent(PI, "working", { agent: "pi", tab_id: "w7:t1" })],
      outputs: { [SHED]: PAUSED_MAIN_SCREEN, [QUIET]: PAUSED_SHOWN_SCREEN, [PI]: PAUSED_MAIN_SCREEN },
    });
    const rows = await createRoster(herdr, () => 1_000).agents([]);
    expect(rows.map((row) => row.agent_status)).toEqual(["done", "working", "working"]);
    expect(rows[0].latest_line).toStartWith("The worker's completion notice");
    expect(rows[1].latest_line).not.toContain("paused · send");
  });

  test("the stream turns working to paused and back to working when the helper runs again; done passes on", async () => {
    const config = { agents: [agent(SHED, "working")], outputs: { [SHED]: SHOWN_WORKING_SCREEN } };
    const { herdr, fake } = herdrWith(config);
    let clock = 1_000;
    const roster = createRoster(herdr, () => clock);
    const events = fakeEvents();
    const needsYou = createNeedsYou({ events, roster, lookMs: 60_000 });
    needsYou.start();
    stops.push(needsYou.stop);
    const heard: LiveEvent[] = [];
    needsYou.subscribe((event) => heard.push(event));
    const show = (screen: string) => {
      fake.setConfig({ ...config, outputs: { [SHED]: screen } });
      clock += 5_000;
    };
    await needsYou.look();
    show(PAUSED_PANEL_SCREEN);
    await needsYou.look();
    expect(heard.at(-1)).toEqual(changed(SHED, "paused"));
    events.push(changed(SHED, "working"));
    expect(heard.at(-1)).toEqual(changed(SHED, "paused"));
    show(WAITING_SCREEN);
    await needsYou.look();
    expect(heard.at(-1)).toEqual(changed(SHED, "blocked"));
    show(TASKS_PAUSED_SCREEN);
    await needsYou.look();
    expect(heard.at(-1)).toEqual(changed(SHED, "paused"));
    show(SHOWN_WORKING_SCREEN);
    await needsYou.look();
    expect(heard.at(-1)).toEqual(changed(SHED, "working"));
    show(PAUSED_PANEL_SCREEN);
    await needsYou.look();
    events.push(changed(SHED, "done"));
    expect(heard.at(-1)).toEqual(changed(SHED, "done"));
  });

  test("no notification while paused, and \"finished\" once the agent really ends", async () => {
    const config: FakeConfig = { agents: [agent(SHED, "working")], outputs: { [SHED]: SHOWN_WORKING_SCREEN }, tabs: [{ tab_id: "w8:t1", workspace_id: "w8", label: "shed", number: 1 }] };
    const { herdr, fake } = herdrWith(config);
    let clock = 1_000;
    const roster = createRoster(herdr, () => clock);
    const events = fakeEvents();
    const needsYou = createNeedsYou({ events, roster, lookMs: 60_000 });
    needsYou.start();
    const sent: Payload[] = [];
    const notifier = createNotifier({ events: needsYou, herdr, roster, push: { broadcast: async (payload) => void sent.push(payload), hasSubscribers: () => true }, watcher: { viewed: () => false }, debounceMs: 20 });
    notifier.start();
    stops.push(needsYou.stop, notifier.stop);
    await needsYou.look();
    fake.setConfig({ ...config, outputs: { [SHED]: PAUSED_PANEL_SCREEN } });
    clock += 5_000;
    await needsYou.look();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent).toEqual([]);
    fake.setConfig({ ...config, agents: [agent(SHED, "done")], outputs: { [SHED]: MAIN_AGAIN_SCREEN } });
    clock += 5_000;
    events.push(changed(SHED, "done"));
    await until(() => sent.length > 0, 3_000, "the finished notification");
    expect(sent.map((payload) => payload.title)).toEqual(["garden · shed finished"]);
  });
});

describe("a paused helper Atomic lists nowhere, confirmed by its saved session", () => {
  const CWD = "/home/you/garden";
  // The main session's latest words are on PAUSED_MAIN_SCREEN, so it is the pane's.
  const LATEST = "The worker's completion notice doesn't match what I launched. It refers to a task task-1-0-2 that I never started, and it doesn't contain the expected reply \"slept.\"";
  const words = (role: "user" | "assistant", text: string): Entry => ({ type: "message", message: { role, content: [{ type: "text", text }] } });
  const child = (childId: string, agentName: string, state: string, extra: Record<string, unknown> = {}): Entry => ({ type: "custom", customType: "subagent-child", data: { version: 1, childId, agent: agentName, state, ...extra } });
  // A session's helper records name it as their owner unless they say otherwise (a fork copies its parent's).
  const owned = (id: string, records: Entry[]) => records.map((entry) => (entry.customType === "subagent-child" && !(entry.data as Entry).owner ? { ...entry, data: { ...(entry.data as Entry), owner: { kind: "session", sessionId: id } } } : entry));
  const mainSession = (children: Entry[], id = "main") => ({ id, cwd: CWD, entries: [words("user", "Launch two helpers."), words("assistant", "launched"), ...owned(id, children), words("assistant", LATEST)] });
  const forkOf = (parent: Entry[], id = "fork") => ({ id, cwd: CWD, header: { parentSessionId: "main" }, entries: [...owned("main", parent), words("user", "Carry on."), words("assistant", LATEST)] });
  const PAUSED = [child("a:0", "asker", "running"), child("b:0", "worker", "running"), child("a:0", "asker", "running", { pausedByUser: true }), child("b:0", "worker", "terminal", { terminalStatus: "ok" })];

  function rosterWith(store: string | null, screen = PAUSED_MAIN_SCREEN, status = "working") {
    const { herdr, fake } = herdrWith({ agents: [agent(SHED, status, { cwd: CWD })], outputs: { [SHED]: screen } });
    let opened = 0;
    let looked = 0;
    const history = createHistory({
      herdr,
      openStore: () => {
        if (!store) throw new Error("no store");
        opened++;
        const s = openSessionStore(store);
        return { ...s, children: (session: string) => (looked++, s.children(session)) };
      },
    });
    let clock = 1_000;
    const roster = createRoster(herdr, () => clock, { pausedInStore: history.pausedHelpers });
    return { roster, fake, opened: () => opened, looked: () => looked, later: () => (clock += 5_000) };
  }
  const status = async (roster: ReturnType<typeof createRoster>) => (await roster.agents([])).map((row) => [row.agent_status, row.latest_line]);

  test("a child whose latest record is paused by you makes the agent paused, named from the store", async () => {
    const { roster } = rosterWith(makeStore([mainSession(PAUSED)]));
    expect(await status(roster)).toEqual([["paused", "asker is paused · send to continue"]]);
    expect(await roster.lookForWaiting()).toEqual([{ pane_id: SHED, agent_status: "working", waiting: false, paused: true }]);
  });

  test("resumed, finished or stopped since, or no child paused: working", async () => {
    for (const latest of [child("a:0", "asker", "running", { pausedByUser: false }), child("a:0", "asker", "terminal", { pausedByUser: false, terminalStatus: "quit" }), child("a:0", "asker", "terminal", { terminalStatus: "ok" })]) {
      const { roster } = rosterWith(makeStore([mainSession([...PAUSED, latest])]));
      expect((await status(roster))[0]).toEqual(["working", expect.stringMatching(/^The worker's completion notice/)]);
    }
    const { roster } = rosterWith(makeStore([mainSession([child("b:0", "worker", "running")])]));
    expect((await status(roster))[0][0]).toBe("working");
  });

  test("main and a helper's own session both on screen (main quotes it): the helper's session, whose parent is main, is dropped and main confirms", async () => {
    const helper = { id: "helper", cwd: CWD, header: { parentSessionId: "main" }, entries: [words("user", "Run sleep 30."), words("assistant", LATEST)] };
    const { roster } = rosterWith(makeStore([mainSession([...PAUSED, child("b:0", "worker", "terminal", { terminalStatus: "ok", childSessionId: "helper" })]), helper]));
    expect(await status(roster)).toEqual([["paused", "asker is paused · send to continue"]]);
  });

  test("a fork copies its parent's paused record, but the record's owner is the parent: the fork alone, or with its parent on screen, reads working", async () => {
    const alone = rosterWith(makeStore([{ ...mainSession(PAUSED), entries: [words("assistant", "Something long that is not on this screen at all, said much earlier.")] }, forkOf(PAUSED)]));
    expect((await status(alone.roster))[0][0]).toBe("working");
    const both = rosterWith(makeStore([mainSession(PAUSED), forkOf(PAUSED)]));
    expect((await status(both.roster))[0][0]).toBe("working");
  });

  test("a helper paused in the fork itself confirms there once the parent's words are off screen; with them still on screen it is ambiguous: working", async () => {
    const earlier = { ...mainSession(PAUSED), entries: [...owned("main", PAUSED), words("assistant", "Something long that is not on this screen at all, said much earlier.")] };
    const fork = { ...forkOf(PAUSED), entries: [...owned("main", PAUSED), ...owned("fork", [child("f:0", "heron", "running", { pausedByUser: true })]), words("assistant", LATEST)] };
    const off = rosterWith(makeStore([earlier, fork]));
    expect(await status(off.roster)).toEqual([["paused", "heron is paused · send to continue"]]);
    const on = rosterWith(makeStore([mainSession(PAUSED), fork]));
    expect((await status(on.roster))[0][0]).toBe("working");
  });

  test("the reviewer's fork, as captured: the parent's and the fork's latest words both on screen, the paused record copied from the parent; working", async () => {
    const parentWords = "The heath helper has been launched for the long sleep.";
    const forkWords = "The sleep 120 subagent finished and replied \"done\", so its background command was started and not checked.";
    const parent = { id: "main", cwd: CWD, entries: [words("user", "Launch a helper."), ...owned("main", PAUSED), words("assistant", parentWords)] };
    const fork = { id: "fork", cwd: CWD, header: { parentSessionId: "main" }, entries: [...parent.entries, words("user", "Launch another."), ...owned("fork", [child("c:0", "asker", "running"), child("c:0", "asker", "terminal", { terminalStatus: "ok" })]), words("assistant", forkWords)] };
    const { roster } = rosterWith(makeStore([parent, fork]), FORK_DONE_HELPER_SHELL_SCREEN);
    expect((await status(roster))[0][0]).toBe("working");
  });

  test("a session started from one on screen is left out only when that one's own records name it as a helper", async () => {
    const named = { id: "helper", cwd: CWD, header: { parentSessionId: "main" }, entries: [words("assistant", LATEST)] };
    const unnamed = rosterWith(makeStore([mainSession(PAUSED), named]));
    expect((await status(unnamed.roster))[0][0]).toBe("working");
    const copied = rosterWith(makeStore([mainSession([...PAUSED, child("z:0", "asker", "terminal", { terminalStatus: "ok", childSessionId: "helper", owner: { kind: "session", sessionId: "elsewhere" } })]), named]));
    expect((await status(copied.roster))[0][0]).toBe("working");
  });

  test("only a helper's session on screen, or two unrelated sessions: working", async () => {
    const helper = { id: "helper", cwd: CWD, header: { parentSessionId: "main" }, entries: [words("assistant", LATEST)] };
    const quiet = { ...mainSession(PAUSED), entries: [words("assistant", "Something long that is not on this screen at all, said much earlier.")] };
    const helperOnly = rosterWith(makeStore([quiet, helper]));
    expect((await status(helperOnly.roster))[0][0]).toBe("working");
    const unrelated = rosterWith(makeStore([mainSession(PAUSED), { ...mainSession(PAUSED, "other"), header: { parentSessionId: "elsewhere" } }]));
    expect((await status(unrelated.roster))[0][0]).toBe("working");
  });

  test("an ambiguous match, no match, or no store: working", async () => {
    const ambiguous = rosterWith(makeStore([mainSession(PAUSED), mainSession(PAUSED, "fork")]));
    expect((await status(ambiguous.roster))[0][0]).toBe("working");
    const elsewhere = rosterWith(makeStore([{ ...mainSession(PAUSED), cwd: "/home/you/elsewhere" }]));
    expect((await status(elsewhere.roster))[0][0]).toBe("working");
    const none = rosterWith(null);
    expect((await status(none.roster))[0][0]).toBe("working");
  });

  test("the store is looked at only for the no-panel screen while herdr says working, and not again while the session is unchanged", async () => {
    for (const [screen, herdrStatus] of [[WAITING_SCREEN, "working"], [PAUSED_PANEL_SCREEN, "working"], [SHOWN_WORKING_SCREEN, "working"], [PAUSED_MAIN_SCREEN, "done"]] as const) {
      const quiet = rosterWith(makeStore([mainSession(PAUSED)]), screen, herdrStatus);
      await status(quiet.roster);
      expect([screen === PAUSED_MAIN_SCREEN ? "main done" : "other", quiet.opened()]).toEqual([screen === PAUSED_MAIN_SCREEN ? "main done" : "other", 0]);
    }
    const store = makeStore([mainSession(PAUSED)]);
    const { roster, looked, later } = rosterWith(store);
    await status(roster);
    later();
    expect((await status(roster))[0][0]).toBe("paused");
    expect(looked()).toBe(1);
    addEntries(store, "main", 100, owned("main", [child("a:0", "asker", "running", { pausedByUser: false })]));
    bumpLastSeq(store, "main", 100);
    later();
    expect((await status(roster))[0][0]).toBe("working");
    expect(looked()).toBe(2);
  });

  test("a finished helper's own shell (no store record paused) reads working", async () => {
    const { roster } = rosterWith(makeStore([{ ...mainSession([child("c:0", "asker", "terminal", { terminalStatus: "ok" })]), entries: [words("assistant", "The subagent (task-1-0-6) has finished and replied \"done\". Its sleep 150 command was started in the background and may still be running.")] }]), DONE_HELPER_SHELL_SCREEN);
    expect((await status(roster))[0][0]).toBe("working");
  });
});
