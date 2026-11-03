import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { createHerdr, type Herdr } from "../server/herdr";
import { createRoster, NAMED_IDLE_READS, RECENT_IDLE_READS } from "../server/roster";
import type { Agent as PageAgent } from "../web/types.js";
import { activityLinePanes, homeLists, memoryStorage, missingActivityLines, recordFirstSight, recordOpened } from "../web/home.js";
import { makeFakeHerdr, type FakeAgent, type FakeConfig } from "./fake-herdr";
import { herdrError, sorted } from "./support/http";
import { FOOTER } from "./support/screens";

const fakes: ReturnType<typeof makeFakeHerdr>[] = [];
afterAll(() => fakes.splice(0).forEach((fake) => fake.dispose()));

function setup(config: FakeConfig) {
  const fake = makeFakeHerdr(config);
  fakes.push(fake);
  let clock = 1_000;
  const roster = createRoster(createHerdr(fake.bin), () => clock);
  const readsOf = (paneId: string) => fake.calls().filter((call) => call[1] === "read" && call[2] === paneId).length;
  const readPanes = () => fake.calls().filter((call) => call[1] === "read").map((call) => call[2]);
  return { roster, fake, readsOf, readPanes, calls: () => fake.calls(), setClock: (ms: number) => (clock = ms) };
}

const pane = (id: string, workspace = id.split(":")[0]) => ({ pane_id: id, workspace_id: workspace, tab_id: `${workspace}:t${id.split(":p")[1]}` });
const agent = (id: string, agent_status: string, state_change_seq?: number, extra: Partial<FakeAgent> = {}): FakeAgent => ({
  ...pane(id),
  agent: "atomic",
  agent_status,
  ...(state_change_seq === undefined ? {} : { state_change_seq }),
  ...extra,
});
const wordsOf = (panes: { pane_id: string }[], tag = "") => Object.fromEntries(panes.map(({ pane_id }) => [pane_id, `words of ${pane_id}${tag}${FOOTER}`]));
const linesOf = (rows: { pane_id: string; latest_line?: string | null }[]) => Object.fromEntries(rows.map((row) => [row.pane_id, row.latest_line]));
const sinceOf = (rows: { pane_id: string; since?: unknown }[]) => Object.fromEntries(rows.map((row) => [row.pane_id, row.since]));
const agentRead = (paneId: string) => ["agent", "read", paneId, "--source", "recent-unwrapped", "--lines", "200"];
// An agent's tab when `tab list` doesn't name it: its ID only.
const unnamedTab = (row: Record<string, unknown>) => ({ id: typeof row.tab_id === "string" ? row.tab_id : null, label: null, number: null });
const idleRun = (prefix: string, count: number, firstSeq = 100) => Array.from({ length: count }, (_, index) => agent(`${prefix}${index}`, "idle", firstSeq + index));

describe.concurrent("the agents list", () => {
  test("blocked, working, unknown and done agents and recent idle ones get their latest line; herdr's fields pass through", async () => {
    const agents = [
      agent("w1:p1", "done", 384, { completion_seq: 384 }),
      agent("w1:p2", "unknown", 7),
      agent("w1:p3", "idle", 118, { completion_seq: 118 }),
      agent("w1:p4", "idle"),
      agent("w1:p5", "working"),
      agent("w1:p6", "blocked", 0),
    ];
    const { roster, calls } = setup({ agents, outputs: { "w1:p1": `Finished the release.${FOOTER}`, "w1:p6": `Upload to which track?${FOOTER}` } });
    expect(await roster.agents([])).toEqual([
      { ...agents[0], tab: unnamedTab(agents[0]), latest_line: "Finished the release." },
      { ...agents[1], tab: unnamedTab(agents[1]), latest_line: null },
      { ...agents[2], tab: unnamedTab(agents[2]), latest_line: null },
      { ...agents[3], tab: unnamedTab(agents[3]), latest_line: null },
      { ...agents[4], tab: unnamedTab(agents[4]), latest_line: null },
      { ...agents[5], tab: unnamedTab(agents[5]), latest_line: "Upload to which track?" },
    ]);
    expect(sorted(calls())).toEqual(sorted([["agent", "list"], ["tab", "list"], ...agents.map((row) => agentRead(row.pane_id))]));
  });

  test(`only the ${RECENT_IDLE_READS} most recently active idle agents are read, on every refresh; older idle ones never are`, async () => {
    const idle = idleRun("w2:p", RECENT_IDLE_READS + 6);
    const agents = [agent("w1:p1", "working", 50), ...idle, agent("w2:pX", "idle")];
    const { roster, setClock, readPanes } = setup({ agents, outputs: wordsOf(agents) });
    const recent = idle.slice(-RECENT_IDLE_READS).map((row) => row.pane_id);
    for (let refresh = 0; refresh < 4; refresh++) {
      setClock(1_000 + refresh * 3_000);
      const lines = linesOf(await roster.agents([]));
      for (const paneId of recent) expect(lines[paneId]).toBe(`words of ${paneId}`);
      for (const { pane_id } of [...idle.slice(0, -RECENT_IDLE_READS), agents.at(-1)!]) expect(lines[pane_id]).toBeUndefined();
    }
    expect([...new Set(readPanes())].sort()).toEqual(["w1:p1", ...recent].sort());
  });

  test(`the first ${NAMED_IDLE_READS} names the page gives are read too when listed and idle; other names are ignored`, async () => {
    const idle = idleRun("w2:p", RECENT_IDLE_READS + 12);
    const agents = [agent("w1:p1", "working", 50), ...idle];
    const { roster, readPanes } = setup({ agents, outputs: wordsOf(agents) });
    const recent = idle.slice(-RECENT_IDLE_READS).map((row) => row.pane_id);
    const named = ["w2:p0", "w2:p1", "w1:p1", "nope", "w2:p2", "w2:p3", "w2:p4", "--help"];
    const lines = linesOf(await roster.agents(named));
    for (const paneId of ["w2:p0", "w2:p1", "w2:p2", ...recent]) expect(lines[paneId]).toBe(`words of ${paneId}`);
    for (const paneId of ["w2:p3", "w2:p4", "w2:p5"]) expect(lines[paneId]).toBeUndefined();
    expect(readPanes().filter((paneId) => paneId !== "w1:p1").sort()).toEqual(["w2:p0", "w2:p1", "w2:p2", ...recent].sort());
  });

  test("an idle agent's read is kept while its state is unchanged, however long and whoever asks; a new seq reads it again", async () => {
    const idle = idleRun("w2:p", RECENT_IDLE_READS + 1);
    const outputs = wordsOf(idle);
    const { roster, fake, setClock, readsOf } = setup({ agents: idle, outputs });
    for (let refresh = 0; refresh < 6; refresh++) {
      setClock(1_000 + refresh * 600_000);
      expect(linesOf(await roster.agents(["w2:p0"]))["w2:p0"]).toBe("words of w2:p0");
      await roster.agents([]);
    }
    fake.setConfig({ agents: idle, outputs: { ...outputs, "w2:p0": `changed${FOOTER}`, "w2:p8": `changed${FOOTER}` } });
    setClock(9_000_000);
    expect(linesOf(await roster.agents(["w2:p0"]))).toMatchObject({ "w2:p0": "words of w2:p0", "w2:p8": "words of w2:p8" });
    expect([readsOf("w2:p0"), readsOf("w2:p8")]).toEqual([1, 1]);

    fake.setConfig({ agents: [{ ...idle[0], state_change_seq: 200 }, ...idle.slice(1)], outputs: { ...outputs, "w2:p0": `new words${FOOTER}` } });
    expect(linesOf(await roster.agents([]))["w2:p0"]).toBe("new words");
    expect(readsOf("w2:p0")).toBe(2);
  });

  test("a busy agent's read is reused for under 3 s while its state is unchanged; a new seq is read at once", async () => {
    const agents = [agent("w8:p1", "blocked", 10), agent("w9:pD", "working", 20)];
    const { roster, fake, setClock, readsOf } = setup({ agents, outputs: { "w8:p1": "first question", "w9:pD": "first step" } });
    expect(linesOf(await roster.agents([]))).toEqual({ "w8:p1": "first question", "w9:pD": "first step" });
    fake.setConfig({ agents, outputs: { "w8:p1": "second question", "w9:pD": "second step" } });
    setClock(3_999);
    expect(linesOf(await roster.agents([]))).toEqual({ "w8:p1": "first question", "w9:pD": "first step" });
    setClock(4_000);
    expect(linesOf(await roster.agents([]))).toEqual({ "w8:p1": "second question", "w9:pD": "second step" });
    fake.setConfig({ agents: [agents[0], { ...agents[1], state_change_seq: 21 }], outputs: { "w8:p1": "third question", "w9:pD": "third step" } });
    setClock(4_100);
    expect(linesOf(await roster.agents([]))).toEqual({ "w8:p1": "second question", "w9:pD": "third step" });
    expect([readsOf("w8:p1"), readsOf("w9:pD")]).toEqual([2, 3]);
  });

  test("an agent that goes idle is read once for its new state, then not again", async () => {
    const agents = [agent("w8:p1", "blocked", 10), agent("w9:pD", "working", 20)];
    const { roster, fake, setClock, readsOf } = setup({ agents, outputs: { "w9:pD": "step" } });
    await roster.agents([]);
    fake.setConfig({ agents: [agents[0], { ...agents[1], agent_status: "idle", state_change_seq: 21 }], outputs: { "w9:pD": "done step" } });
    setClock(9_000);
    expect(linesOf(await roster.agents([]))["w9:pD"]).toBe("done step");
    setClock(20_000);
    await roster.agents([]);
    expect([readsOf("w8:p1"), readsOf("w9:pD")]).toEqual([3, 2]);
  });

  test("an agent that leaves the list and comes back in the same state is read afresh, not from its old read", async () => {
    const agents = [agent("w2:p1", "idle", 5), agent("w2:p2", "idle", 6)];
    const { roster, fake, setClock } = setup({ agents, outputs: wordsOf(agents) });
    await roster.agents([]);
    fake.setConfig({ agents: agents.slice(1), outputs: wordsOf(agents) });
    setClock(2_000);
    await roster.agents([]);
    fake.setConfig({ agents, outputs: wordsOf(agents, " again") });
    setClock(3_000);
    expect(linesOf(await roster.agents([]))).toEqual({ "w2:p1": "words of w2:p1 again", "w2:p2": "words of w2:p2" });
  });

  test("a gone agent's read leaves its line null with no error; another failure says why on that row only and is read again next time", async () => {
    const agents = [agent("w8:p1", "blocked", 10), agent("w9:pD", "working", 20), agent("w9:pE", "idle", 30), agent("w9:pF", "done", 40)];
    const { roster, setClock, readsOf } = setup({
      agents,
      outputs: { "w8:p1": "Which port should it use?\n" },
      answers: {
        "read w9:pD": herdrError("server_unreachable", "herdr server not running", "cli:agent:read"),
        "read w9:pE": { exit: 1, stderr: "something broke\n" },
        "read w9:pF": herdrError("agent_not_found", "agent target w9:pF not found", "cli:agent:read"),
      },
    });
    expect(await roster.agents([])).toEqual([
      { ...agents[0], tab: unnamedTab(agents[0]), latest_line: "Which port should it use?" },
      { ...agents[1], tab: unnamedTab(agents[1]), latest_line: null, latest_line_error: { code: "server_unreachable", message: "herdr server not running" } },
      { ...agents[2], tab: unnamedTab(agents[2]), latest_line: null, latest_line_error: { code: "herdr_failed", message: "something broke" } },
      { ...agents[3], tab: unnamedTab(agents[3]), latest_line: null },
    ]);
    setClock(1_500);
    await roster.agents([]);
    expect(agents.map((row) => readsOf(row.pane_id))).toEqual([1, 2, 2, 2]);
  });

  test("an unexpected error reading one agent is logged and that row alone says server_error", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const working = (pane_id: string) => ({ pane_id, agent_status: "working" });
      const herdr: Pick<Herdr, "list" | "panes" | "workspaces" | "tabs" | "read"> = {
        list: async () => [working("w8:p1"), working("w8:p2"), working("w8:p3")],
        panes: async () => [],
        workspaces: async () => [],
        tabs: async () => [],
        read: async (paneId) => {
          if (paneId === "w8:p2") throw new TypeError("something the server didn't expect");
          return "The tests pass.\n";
        },
      };
      expect<unknown>(await createRoster(herdr, () => 0).agents([])).toEqual([
        { ...working("w8:p1"), tab: unnamedTab({}), latest_line: "The tests pass." },
        { ...working("w8:p2"), tab: unnamedTab({}), latest_line: null, latest_line_error: { code: "server_error", message: "The server hit an unexpected error." } },
        { ...working("w8:p3"), tab: unnamedTab({}), latest_line: "The tests pass." },
      ]);
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });

  test("every idle row home's Activity shows gets its line once the page names them, even when finished idle agents fill the recent reads", async () => {
    const finished = idleRun("w1:p", RECENT_IDLE_READS, 200).map((row) => ({ ...row, completion_seq: row.state_change_seq }));
    const older = idleRun("w3:p", 12, 10);
    const agents = [agent("w2:pW", "working", 300), ...finished, ...older];
    const { roster } = setup({ agents, outputs: wordsOf(agents) });
    const store = memoryStorage();
    recordOpened(store, { pane_id: "w0:p0", completion_seq: 1 });
    const visit = async (named: string[]) => {
      const listed: PageAgent[] = JSON.parse(JSON.stringify(await roster.agents(named)));
      recordFirstSight(store, listed);
      return homeLists(listed, store);
    };
    const first = await visit([]);
    expect(first.finished).toHaveLength(RECENT_IDLE_READS);
    expect(missingActivityLines(first)).toBe(true);
    const named = activityLinePanes(first);
    const second = await visit(named);
    expect(missingActivityLines(second)).toBe(false);
    expect(second.activity.filter(({ agent: row }) => row.agent_status === "idle").map(({ agent: row }) => row.latest_line)).toEqual(named.map((paneId) => `words of ${paneId}`));
  });
});

describe.concurrent("since", () => {
  const two = [agent("w8:p1", "blocked", 10), agent("w9:pD", "working", 20)];

  test("no since on first sight; a change seen between two looks moments apart sets it, and it stays while the state is unchanged", async () => {
    const { roster, fake, setClock } = setup({ agents: two });
    expect(sinceOf(await roster.agents([]))).toEqual({ "w8:p1": undefined, "w9:pD": undefined });
    setClock(4_000);
    expect(sinceOf(await roster.agents([]))).toEqual({ "w8:p1": undefined, "w9:pD": undefined });
    setClock(7_000);
    fake.setConfig({ agents: [two[0], { ...two[1], agent_status: "done" }] });
    expect(sinceOf(await roster.agents([]))).toEqual({ "w8:p1": undefined, "w9:pD": 7_000 });
    setClock(10_000);
    fake.setConfig({ agents: [{ ...two[0], state_change_seq: 11 }, { ...two[1], agent_status: "done" }] });
    expect(sinceOf(await roster.agents([]))).toEqual({ "w8:p1": 10_000, "w9:pD": 7_000 });
    setClock(60_000);
    expect(sinceOf(await roster.agents([]))).toEqual({ "w8:p1": 10_000, "w9:pD": 7_000 });
  });

  test("a change first noticed after a gap of over 10 s gets no time; the next change seen moments after a look does", async () => {
    const { roster, fake, setClock } = setup({ agents: two });
    await roster.agents([]);
    setClock(11_000);
    fake.setConfig({ agents: [two[0], { ...two[1], agent_status: "done" }] });
    expect(sinceOf(await roster.agents([]))["w9:pD"]).toBe(11_000);
    setClock(21_001);
    fake.setConfig({ agents: [two[0], { ...two[1], agent_status: "working", state_change_seq: 25 }] });
    expect(sinceOf(await roster.agents([]))["w9:pD"]).toBeUndefined();
    setClock(24_000);
    expect(sinceOf(await roster.agents([]))["w9:pD"]).toBeUndefined();
    setClock(27_000);
    fake.setConfig({ agents: [two[0], { ...two[1], agent_status: "done", state_change_seq: 26 }] });
    expect(sinceOf(await roster.agents([]))["w9:pD"]).toBe(27_000);
  });

  test("an agent that leaves the list and comes back has no since until a change is seen", async () => {
    const { roster, fake, setClock } = setup({ agents: two });
    await roster.agents([]);
    setClock(2_000);
    fake.setConfig({ agents: [two[0]] });
    await roster.agents([]);
    setClock(3_000);
    fake.setConfig({ agents: [two[0], { ...two[1], agent_status: "done" }] });
    expect(sinceOf(await roster.agents([]))["w9:pD"]).toBeUndefined();
    setClock(4_000);
    fake.setConfig({ agents: [two[0], { ...two[1], agent_status: "idle" }] });
    expect(sinceOf(await roster.agents([]))["w9:pD"]).toBe(4_000);
  });
});

const WORKSPACES = [
  { workspace_id: "w9", label: "usage-dashboard" },
  { workspace_id: "wF", label: "hermux" },
];
const SHELLS = [
  { ...pane("w9:p2"), cwd: "/home/you/usage-dashboard" },
  { ...pane("wF:pM"), cwd: "/home/you/hermux" },
];
const TERMINAL_AGENTS = [agent("w9:pD", "idle", 30), agent("w9:pE", "working", 40, { agent: "pi" }), agent("wF:p1", "blocked", 7)];
const SHELL_OUTPUTS = { "w9:p2": "you@laptop:~/usage-dashboard$ ls\nREADME.md  src\n", "wF:pM": "$ bun server/main.ts\nlistening\n" };
const terminalsConfig = (agents: FakeAgent[] = TERMINAL_AGENTS, extra: Partial<FakeConfig> = {}): FakeConfig => ({
  agents,
  shells: SHELLS,
  workspaces: WORKSPACES,
  outputs: { ...wordsOf(agents), ...SHELL_OUTPUTS },
  ...extra,
});

describe.concurrent("the terminals", () => {
  test("all terminals: agents' lines are chosen as for the agents list, names included, and every shell is read", async () => {
    const idle = idleRun("w9:pI", RECENT_IDLE_READS + 4);
    const { roster, readPanes } = setup(terminalsConfig([...TERMINAL_AGENTS, ...idle]));
    const terminals = await roster.terminals(["w9:pI0"]);
    expect(terminals.map((terminal) => terminal.pane_id).sort()).toEqual([...TERMINAL_AGENTS, ...idle, ...SHELLS].map((row) => row.pane_id).sort());
    const lines = linesOf(terminals);
    expect(lines["w9:p2"]).toBe("README.md  src");
    expect(lines["wF:pM"]).toBe("listening");
    expect(lines["w9:pI0"]).toBe("words of w9:pI0");
    for (const { pane_id } of idle.slice(1, 4)) expect(lines[pane_id]).toBeUndefined();
    expect(lines["w9:pD"]).toBeUndefined();
    expect(readPanes().sort()).toEqual(["w9:pE", "wF:p1", "w9:pI0", ...idle.slice(4).map((row) => row.pane_id), "w9:p2", "wF:pM"].sort());
  });

  test("the agents list and the terminals share their reads and their since: the second list moments later reads nothing again", async () => {
    const { roster, fake, setClock, readPanes } = setup(terminalsConfig());
    await roster.agents([]);
    setClock(2_000);
    fake.setConfig(terminalsConfig([TERMINAL_AGENTS[0], { ...TERMINAL_AGENTS[1], agent_status: "done", state_change_seq: 41 }, TERMINAL_AGENTS[2]]));
    await roster.agents([]);
    setClock(2_500);
    const terminals = await roster.terminals([]);
    expect(sinceOf(terminals)).toMatchObject({ "w9:pE": 2_000 });
    expect(sorted(readPanes().map((paneId) => [paneId]))).toEqual(sorted([["w9:pD"], ["w9:pE"], ["w9:pE"], ["wF:p1"], ["w9:p2"], ["wF:pM"]]));
    expect((await roster.agents([])).map((row) => row.pane_id)).toEqual(TERMINAL_AGENTS.map((row) => row.pane_id));
  });

  test("a shell's read is reused for under 3 s, then read again; a closed shell's read is dropped", async () => {
    const { roster, fake, setClock } = setup(terminalsConfig());
    const shellLine = async () => linesOf(await roster.terminals([]))["w9:p2"];
    expect(await shellLine()).toBe("README.md  src");
    fake.setConfig(terminalsConfig(TERMINAL_AGENTS, { outputs: { ...SHELL_OUTPUTS, "w9:p2": "$ make\nbuilt\n" } }));
    setClock(3_999);
    expect(await shellLine()).toBe("README.md  src");
    setClock(4_000);
    expect(await shellLine()).toBe("built");
    fake.setConfig(terminalsConfig(TERMINAL_AGENTS, { shells: SHELLS.slice(1), outputs: { ...SHELL_OUTPUTS, "w9:p2": "new shell\n" } }));
    setClock(4_100);
    expect(await shellLine()).toBeUndefined();
    fake.setConfig(terminalsConfig(TERMINAL_AGENTS, { outputs: { ...SHELL_OUTPUTS, "w9:p2": "new shell\n" } }));
    setClock(4_200);
    expect(await shellLine()).toBe("new shell");
  });

  test("a shell read that fails says why on that row only, and is read again next time; a gone shell just has no line", async () => {
    const { roster, setClock, readsOf } = setup(
      terminalsConfig(TERMINAL_AGENTS, {
        answers: {
          "pane read w9:p2": herdrError("server_unreachable", "herdr server not running", "cli:pane:read"),
          "pane read wF:pM": herdrError("pane_not_found", "pane wF:pM not found", "cli:pane:read"),
        },
      }),
    );
    const rows = Object.fromEntries((await roster.terminals([])).map((terminal) => [terminal.pane_id, terminal]));
    expect(rows["w9:p2"]).toMatchObject({ latest_line: null, latest_line_error: { code: "server_unreachable", message: "herdr server not running" } });
    expect(rows["wF:pM"]).toMatchObject({ latest_line: null });
    expect(rows["wF:pM"]).not.toHaveProperty("latest_line_error");
    expect(rows["w9:pD"]).toMatchObject({ latest_line: "words of w9:pD" });
    setClock(1_500);
    await roster.terminals([]);
    expect([readsOf("w9:p2"), readsOf("wF:pM"), readsOf("w9:pD")]).toEqual([2, 2, 1]);
  });

  test("a workspace's terminals are its panes only, every agent and shell in it read, even idle ones the All list wouldn't read", async () => {
    const old = agent("w9:pZ", "idle", 1);
    const recent = idleRun("w9:pI", RECENT_IDLE_READS);
    const elsewhere = idleRun("wF:pI", 2);
    const { roster, readPanes } = setup(terminalsConfig([...TERMINAL_AGENTS, old, ...recent, ...elsewhere]));
    const answer = await roster.workspace("w9");
    expect(answer.workspace).toEqual({ id: "w9", label: "usage-dashboard" });
    const inWorkspace = ["w9:p2", "w9:pD", "w9:pE", "w9:pZ", ...recent.map((row) => row.pane_id)];
    expect(answer.terminals.map((terminal) => terminal.pane_id).sort()).toEqual([...inWorkspace].sort());
    expect(linesOf(answer.terminals)).toMatchObject({ "w9:p2": "README.md  src", "w9:pD": "words of w9:pD", "w9:pZ": "words of w9:pZ" });
    expect(readPanes().sort()).toEqual([...inWorkspace].sort());
  });

  test("an unknown workspace is refused with workspace_not_found, and nothing is read or looked at", async () => {
    const { roster, fake, setClock, readPanes } = setup(terminalsConfig());
    await roster.agents([]);
    setClock(4_000);
    fake.setConfig(terminalsConfig([TERMINAL_AGENTS[0], { ...TERMINAL_AGENTS[1], agent_status: "done", state_change_seq: 41 }, TERMINAL_AGENTS[2]]));
    const refused = await roster.workspace("w99").then(() => null, (error: unknown) => error);
    expect(refused).toMatchObject({ code: "workspace_not_found", message: "workspace w99 not found" });
    expect(readPanes().length).toBe(3);
    setClock(20_000);
    expect(sinceOf(await roster.agents([]))["w9:pE"]).toBeUndefined();
  });
});

describe.concurrent("one terminal (D32)", () => {
  const AGENT_TAB = { tab_id: "w1:t1", workspace_id: "w1", label: "next work", number: 4 };

  test("an agent comes with its tab, its title and its latest line, and only its own pane is read", async () => {
    const agents = [agent("w1:p1", "blocked", 9, { tab_id: "w1:t1", cwd: "/home/you/weather-app", terminal_title_stripped: "atomic - weather-app" }), agent("w1:p2", "working", 2)];
    const { roster, readPanes } = setup({ agents, tabs: [AGENT_TAB], outputs: { ...wordsOf(agents), "w1:p1": `Which database?${FOOTER}` } });
    expect(await roster.terminal("w1:p1")).toMatchObject({ pane_id: "w1:p1", kind: "atomic", status: "blocked", cwd: "/home/you/weather-app", title: "atomic - weather-app", tab: { id: "w1:t1", label: "next work", number: 4 }, latest_line: "Which database?" });
    expect(readPanes()).toEqual(["w1:p1"]);
  });

  test("a plain shell comes without a status and is never read", async () => {
    const { roster, readPanes } = setup({ shells: [{ pane_id: "w1:p3", workspace_id: "w1", tab_id: "w1:t1" }], tabs: [AGENT_TAB] });
    expect(await roster.terminal("w1:p3")).toMatchObject({ pane_id: "w1:p3", kind: "shell", status: null });
    expect(readPanes()).toEqual([]);
  });

  test("a pane herdr doesn't list is null", async () => {
    const { roster } = setup({ agents: [agent("w1:p1", "idle", 1)] });
    expect(await roster.terminal("w1:p9")).toBeNull();
  });

  test("a read that fails still answers the terminal, with the reason in place of a line", async () => {
    const { roster } = setup({ agents: [agent("w1:p1", "blocked", 1)], answers: { read: herdrError("server_unreachable", "down") } });
    expect(await roster.terminal("w1:p1")).toMatchObject({ status: "blocked", latest_line: null, latest_line_error: { code: "server_unreachable" } });
  });
});
