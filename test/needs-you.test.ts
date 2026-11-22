import { afterAll, describe, expect, test } from "bun:test";
import type { LiveEvent } from "../server/events";
import { createHerdr } from "../server/herdr";
import { createNeedsYou } from "../server/needs-you";
import { createNotifier } from "../server/notifier";
import type { Payload } from "../server/push";
import { createRoster } from "../server/roster";
import { makeFakeHerdr, type FakeAgent, type FakeConfig } from "./fake-herdr";
import { until } from "./support/fake-events";
import { FOOTER } from "./support/screens";
import { MAIN_AGAIN_SCREEN, QUESTION_SCREEN, SHOWN_WORKING_SCREEN, WAITING_SCREEN } from "./support/atomic-0100";

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
      { pane_id: SHED, agent_status: "working", waiting: true },
      { pane_id: PI, agent_status: "working", waiting: false },
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
      { pane_id: SHED, agent_status: "working", waiting: true },
      { pane_id: QUIET, agent_status: "idle", waiting: false },
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
