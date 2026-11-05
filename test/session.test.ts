import { expect, test } from "bun:test";
import { homeLists, memoryStorage } from "../web/home.js";
import { createSession } from "../web/session.js";
import { CONNECTING, FakeSource } from "./support/event-source";

type Tab = { id: string; label: string; number: number };
type Agent = { pane_id: string; agent: string; agent_status: string; cwd: string; terminal_title_stripped: string; workspace_id: string; tab: Tab; state_change_seq: number; completion_seq?: number; latest_line: string };
type Terminal = {
  pane_id: string;
  kind: string;
  status: string | null;
  workspace: { id: string; label: string };
  tab: Tab;
  cwd: string;
  title: string;
  latest_line: string;
};
type Route = { name: "home" | "all" } | { name: "agent"; paneId: string };

const dashboard = { id: "w9", label: "usage-dashboard" };
const agent = (pane_id: string, kind: string, agent_status: string, seq: number): Agent => ({
  pane_id,
  agent: kind,
  agent_status,
  cwd: "/home/you/usage-dashboard",
  terminal_title_stripped: `${kind} - ${pane_id} - usage-dashboard`,
  workspace_id: "w9",
  tab: { id: `t-${pane_id}`, label: "1", number: 1 },
  state_change_seq: seq,
  latest_line: `list line of ${pane_id}`,
});

function world() {
  const agents = [agent("w9:pD", "pi", "working", 3), agent("w9:pE", "atomic", "idle", 2)];
  const shell: Terminal = {
    pane_id: "w9:p2",
    kind: "shell",
    status: null,
    workspace: dashboard,
    tab: { id: "w9:t2", label: "server", number: 2 },
    cwd: "/home/you/usage-dashboard",
    title: "you@laptop:~/usage-dashboard$",
    latest_line: "$ ls",
  };
  const terminals = (): Terminal[] => [
    ...agents.map((row) => ({ pane_id: row.pane_id, kind: row.agent, status: row.agent_status, workspace: dashboard, tab: row.tab, cwd: row.cwd, title: row.terminal_title_stripped, latest_line: `workspace line of ${row.pane_id}` })),
    shell,
  ];
  return { agents, terminals };
}

type Held = { settle?: (refusal: Error | null) => void };

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup({ route = { name: "home" } as Route, visible = true, sample = false, namedIdleLines = false } = {}) {
  const herdr = world();
  const calls: string[] = [];
  const asked: string[][] = [];
  const holds = new Map<string, Held>();
  const failing = new Map<string, Error>();
  const answer = async <T>(call: string, value: () => T): Promise<T> => {
    calls.push(call);
    const held = holds.get(call);
    holds.delete(call);
    const settled = held
      ? await new Promise<Error | null>((settle) => {
          held.settle = settle;
        })
      : await null;
    const refusal = settled ?? failing.get(call);
    if (refusal) throw refusal;
    return value();
  };
  const client = {
    isSample: sample,
    listAgents: (linePanes: string[] = []) => {
      asked.push(linePanes);
      return answer("agents", () =>
        herdr.agents.map(({ latest_line, ...row }) => (namedIdleLines && row.agent_status === "idle" && !linePanes.includes(row.pane_id) ? row : { ...row, latest_line })),
      );
    },
    listTerminals: () => answer("terminals", () => herdr.terminals()),
    listWorkspaceTerminals: (id: string) => answer(`workspace ${id}`, () => ({ workspace: dashboard, terminals: herdr.terminals() })),
    readOutput: (paneId: string) => answer(`output ${paneId}`, () => `screen of ${paneId}`),
    readHistory: () => answer("history", () => ({ history: null, reason: "unavailable" as const })),
    sendPrompt: (paneId: string, text: string, kind: string) => answer(`prompt ${paneId} ${kind} ${text}`, () => undefined),
    sendKeys: (paneId: string, keys: string[], kind: string) => answer(`keys ${paneId} ${kind} ${keys.join(" ")}`, () => undefined),
    watchOutput: (paneId: string, stream: string) => answer(`watch ${paneId} ${stream}`, () => undefined),
    unwatchOutput: (paneId: string, stream: string) => answer(`unwatch ${paneId} ${stream}`, () => undefined),
    uploadImage: () => answer("upload", () => ({ path: "/uploads/image.png", name: "image.png", size: 1 })),
    readPicture: () => answer("picture", () => new Blob()),
  };
  const sources: FakeSource[] = [];
  let now = 0;
  const intervals: { run: () => void; ms: number; next: number }[] = [];
  const timers = {
    setInterval: (run: () => void, ms: number) => intervals.push({ run, ms, next: now + ms }),
    now: () => now,
  };
  const opened = memoryStorage();
  const session = createSession({
    client,
    openStream: (path) => {
      const source = new FakeSource(path);
      sources.push(source);
      return source;
    },
    timers,
    opened,
  });
  const changes: string[] = [];
  session.subscribe((change) => changes.push(change));
  session.open(route);
  session.start(visible);
  return {
    herdr,
    session,
    opened,
    calls,
    asked,
    changes,
    sources,
    failing,
    stream: () => sources[sources.length - 1],
    hold(call: string) {
      const held: Held = {};
      holds.set(call, held);
      return {
        resolve: () => held.settle?.(null),
        fail: (error: Error) => held.settle?.(error),
      };
    },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = intervals.filter((interval) => interval.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.ms;
        due.run();
        await flush();
      }
      now = end;
    },
    async live() {
      sources[sources.length - 1].fire("live", { live: true });
      await flush();
    },
    count: (call: string) => calls.filter((made) => made === call).length,
    reset() {
      calls.length = 0;
      asked.length = 0;
      changes.length = 0;
    },
  };
}

test("home is drawn once the list answers, which asks again at once for an idle Activity line the server didn't read; later reads name those panes, and once the stream is live, no list polls run", async () => {
  const page = setup({ namedIdleLines: true });
  const again = page.hold("agents");
  await flush();
  expect(page.asked).toEqual([[], ["w9:pE"]]);
  expect(page.changes).toEqual([]);
  page.herdr.agents.push({ ...agent("w9:pF", "pi", "idle", 4), completion_seq: 1 });
  again.resolve();
  await flush();
  expect(page.changes).toEqual(["screen"]);
  expect(page.session.snapshot()).toMatchObject({ loaded: true, streaming: false, route: { name: "home" } });
  expect(page.session.snapshot().agents.map((row) => [row.pane_id, row.agent_status, row.latest_line])).toEqual([
    ["w9:pD", "working", "list line of w9:pD"],
    ["w9:pE", "idle", "list line of w9:pE"],
    ["w9:pF", "idle", undefined],
  ]);
  expect(homeLists(page.session.snapshot().agents, page.opened).finished.map((row) => row.pane_id)).toEqual(["w9:pF"]);
  await page.live();
  expect(page.session.snapshot().streaming).toBe(true);
  page.reset();
  page.stream().fire("change", { changed: [], refetch: true });
  await flush();
  expect(page.asked).toEqual([["w9:pE"]]);
  page.reset();
  await page.advance(30_000);
  expect(page.calls).toEqual([]);
});

test("the stream drops: the list is polled at once and every 3 s, each answer drawn, and stops when the stream is Live again", async () => {
  const page = setup();
  await flush();
  await page.live();
  page.reset();
  page.stream().fail(CONNECTING);
  expect(page.session.snapshot().streaming).toBe(false);
  expect(page.changes).toEqual(["screen"]);
  await flush();
  expect(page.count("agents")).toBe(1);
  expect(page.changes).toEqual(["screen", "screen"]);
  await page.advance(3_000);
  expect(page.count("agents")).toBe(2);
  expect(page.changes).toEqual(["screen", "screen", "screen"]);
  expect(page.session.snapshot().updatedAt).toBe(3_000);
  await page.advance(3_000);
  expect(page.count("agents")).toBe(3);
  await page.live();
  expect(page.session.snapshot().streaming).toBe(true);
  page.reset();
  await page.advance(9_000);
  expect(page.calls).toEqual([]);
});

test("a status event updates the one roster at once, for home, the open Terminal and its workspace, and re-reads the list once", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pE" } });
  await flush();
  await page.live();
  page.reset();
  page.stream().fire("change", { changed: [{ pane_id: "w9:pE", agent_status: "blocked" }, { pane_id: "w9:p2", agent_status: "unknown" }], refetch: true });
  const view = page.session.snapshot();
  expect(page.changes).toEqual(["screen"]);
  expect(view.terminal?.status).toBe("blocked");
  expect(view.agents.find((row) => row.pane_id === "w9:pE")?.agent_status).toBe("blocked");
  expect(view.workspace?.terminals.map((row) => [row.pane_id, row.status])).toEqual([
    ["w9:pD", "working"],
    ["w9:pE", "blocked"],
    ["w9:p2", null],
  ]);
  expect(page.calls).toEqual(["agents"]);
  await flush();
  expect(page.calls).toEqual(["agents", "workspace w9"]);
});

test("an open Agent's output is re-read every 2 s only while it is working, after a read failed, or while the stream is down, each read drawn", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pD" } });
  await flush();
  await page.live();
  expect(page.session.snapshot().output).toEqual({ text: "screen of w9:pD", error: null });
  page.reset();
  await page.advance(6_000);
  expect(page.count("output w9:pD")).toBe(3);
  expect(page.changes).toEqual(["output", "output", "output"]);
  page.herdr.agents[0].agent_status = "idle";
  page.stream().fire("change", { changed: [{ pane_id: "w9:pD", agent_status: "idle" }], refetch: true });
  page.stream().fire("output", { pane_id: "w9:pD" });
  await flush();
  page.reset();
  await page.advance(10_000);
  expect(page.calls).toEqual([]);
  page.stream().fire("output", { pane_id: "w9:pE" });
  await flush();
  expect(page.calls).toEqual([]);
  page.reset();
  page.failing.set("output w9:pD", failure("server_unavailable", "herdr said: busy (server_unavailable)."));
  page.stream().fire("output", { pane_id: "w9:pD" });
  await flush();
  expect(page.calls).toEqual(["output w9:pD"]);
  expect(page.changes).toEqual(["output"]);
  expect(page.session.snapshot().output).toEqual({ text: "screen of w9:pD", error: "herdr said: busy (server_unavailable)." });
  page.failing.clear();
  page.reset();
  await page.advance(2_000);
  expect(page.changes).toEqual(["output"]);
  expect(page.session.snapshot().output).toEqual({ text: "screen of w9:pD", error: null });
  page.reset();
  await page.advance(10_000);
  expect(page.calls).toEqual([]);
  for (const status of ["blocked", "done"]) {
    page.herdr.agents[0].agent_status = status;
    page.stream().fire("change", { changed: [{ pane_id: "w9:pD", agent_status: status }], refetch: true });
    await flush();
    page.reset();
    await page.advance(10_000);
    expect([status, page.calls]).toEqual([status, []]);
  }
  page.reset();
  page.stream().fail(CONNECTING);
  await flush();
  expect(page.count("output w9:pD")).toBe(1);
  page.reset();
  await page.advance(4_000);
  expect(page.count("output w9:pD")).toBe(2);
});

test("a Shell opened by link is looked up in the full list, then a swap inside its workspace keeps the workspace", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:p2" } });
  expect(page.session.snapshot()).toMatchObject({ terminal: null, missing: null });
  await flush();
  expect(page.calls).toEqual(["output w9:p2", "terminals", "agents", "workspace w9", "workspace w9"]);
  const shell = page.session.snapshot();
  expect(shell.terminal).toMatchObject({ pane_id: "w9:p2", kind: "shell", status: null, tab: { label: "server" } });
  expect(shell.workspace).toMatchObject({ id: "w9", label: "usage-dashboard" });
  expect(shell.workspace?.terminals.map((row) => row.latest_line)).toEqual(["workspace line of w9:pD", "workspace line of w9:pE", "$ ls"]);
  page.reset();
  page.session.open({ name: "agent", paneId: "w9:pD" });
  const swapped = page.session.snapshot();
  expect(swapped.terminal).toMatchObject({ pane_id: "w9:pD", kind: "pi", status: "working" });
  expect(swapped.workspace?.terminals).toHaveLength(3);
  expect(swapped.output).toEqual({ text: null, error: null });
  await flush();
  expect(page.calls).toEqual(["output w9:pD", "workspace w9"]);
  expect(swapped.agents.map((row) => row.latest_line)).toEqual(["list line of w9:pD", "list line of w9:pE"]);
});

test("answers for a screen that was left are dropped: its output, and its workspace, answered or refused", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pE" } });
  await flush();
  // Opens pD, goes back to pE while that read is held, and settles the read:
  // the screen and the changes heard are as if it never answered.
  const leaveWhileHeld = async (call: string, settle: (held: ReturnType<typeof page.hold>) => void) => {
    const held = page.hold(call);
    page.session.open({ name: "agent", paneId: "w9:pD" });
    page.session.open({ name: "agent", paneId: "w9:pE" });
    await flush();
    const before = page.session.snapshot();
    expect(before).toMatchObject({ terminal: { pane_id: "w9:pE" }, output: { text: "screen of w9:pE", error: null } });
    page.reset();
    settle(held);
    await flush();
    expect(page.session.snapshot()).toEqual(before);
    expect(page.changes).toEqual([]);
  };
  await leaveWhileHeld("output w9:pD", (held) => held.resolve());
  await leaveWhileHeld("output w9:pD", (held) => held.fail(failure("server_unavailable", "herdr said: busy (server_unavailable).")));
  await leaveWhileHeld("workspace w9", (held) => held.fail(failure("workspace_not_found", "That workspace is gone.")));

  const workspace = page.hold("workspace w9");
  page.session.open({ name: "home" });
  page.session.open({ name: "agent", paneId: "w9:pD" });
  await flush();
  page.session.open({ name: "home" });
  workspace.resolve();
  await flush();
  expect(page.session.snapshot().workspace).toBeNull();
});

test("a full list answered for a screen that was left is dropped: the All screen's, and a link's lookup", async () => {
  const page = setup();
  await flush();
  for (const route of [{ name: "all" }, { name: "agent", paneId: "w9:p2" }] as Route[]) {
    const terminals = page.hold("terminals");
    page.session.open(route);
    page.session.open({ name: "home" });
    const before = page.session.snapshot();
    expect(before).toMatchObject({ terminals: [], terminalsLoaded: false });
    page.reset();
    terminals.resolve();
    await flush();
    expect(page.session.snapshot()).toEqual(before);
    expect(page.changes).toEqual([]);
  }
});

test("a failed lookup shows its error in the header, is retried on the list's rhythm while Live, and clears", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:p2" } });
  page.failing.set("terminals", failure("unreachable", "The laptop didn't answer."));
  await flush();
  await page.live();
  expect(page.session.snapshot()).toMatchObject({ terminal: null, missing: { error: "Can't reach the laptop. Retrying…" } });
  page.failing.clear();
  await page.advance(3_000);
  expect(page.session.snapshot()).toMatchObject({ terminal: { pane_id: "w9:p2" }, missing: null });
  page.reset();
  await page.advance(9_000);
  expect(page.count("agents")).toBe(0);
});

test("while Live, a failed list read is drawn and retried every 3 s until one works", async () => {
  const page = setup();
  await flush();
  await page.live();
  page.reset();
  page.failing.set("agents", failure("server_unavailable", "herdr said: busy (server_unavailable)."));
  page.stream().fire("change", { changed: [], refetch: true });
  await flush();
  expect(page.changes).toEqual(["screen"]);
  expect(page.session.snapshot().listError).toEqual({ code: "server_unavailable", message: "herdr said: busy (server_unavailable)." });
  page.failing.clear();
  page.reset();
  await page.advance(3_000);
  expect(page.calls).toEqual(["agents"]);
  expect(page.changes).toEqual(["screen"]);
  expect(page.session.snapshot().listError).toBeNull();
  page.reset();
  await page.advance(9_000);
  expect(page.calls).toEqual([]);
});

test("while Live, a lookup error left by an Agent's screen keeps no list poll running on home, or on All while its terminals are read", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pD" } });
  page.failing.set("workspace w9", failure("unreachable", "The laptop didn't answer."));
  await flush();
  await page.live();
  page.reset();
  await page.advance(3_000);
  expect(page.count("agents")).toBe(1);
  page.failing.clear();
  page.session.open({ name: "home" });
  page.reset();
  await page.advance(9_000);
  expect(page.calls).toEqual([]);
  const terminals = page.hold("terminals");
  page.session.open({ name: "all" });
  page.reset();
  await page.advance(3_000);
  expect(page.calls).toEqual([]);
  terminals.resolve();
  await flush();
  expect(page.session.snapshot().terminalsLoaded).toBe(true);
});

test("a Terminal no list holds is gone only once the agent list has loaded, and nothing can be sent to it", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pZ" } });
  page.failing.set("agents", failure("unreachable", "The laptop didn't answer."));
  await flush();
  expect(page.calls).toContain("terminals");
  expect(page.session.snapshot()).toMatchObject({ loaded: false, terminal: null, missing: null });
  page.failing.clear();
  await page.advance(3_000);
  expect(page.session.snapshot()).toMatchObject({ loaded: true, terminal: null, missing: { gone: true } });
  page.reset();
  expect(await page.session.sendText("hello")).toEqual({ status: "ignored" });
  expect(await page.session.sendKey("enter")).toEqual({ status: "ignored" });
  await flush();
  expect(page.calls).toEqual([]);
  expect(page.changes).toEqual([]);
});

test("a link to a pane no list holds, opened from another Agent's screen, is neither gone nor in error before its own lookup", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pE" } });
  await flush();
  page.session.open({ name: "agent", paneId: "w9:pZ" });
  expect(page.session.snapshot()).toMatchObject({ terminal: null, missing: null });
  await flush();
  expect(page.session.snapshot()).toMatchObject({ terminal: null, missing: { gone: true } });
  page.failing.set("workspace w9", failure("unreachable", "The laptop didn't answer."));
  page.session.open({ name: "agent", paneId: "w9:pD" });
  await flush();
  page.session.open({ name: "agent", paneId: "w9:pZ" });
  expect(page.session.snapshot()).toMatchObject({ terminal: null, missing: null });
});

test("a workspace that went makes its Terminal gone, not an error retried on the list's rhythm", async () => {
  const page = setup();
  await flush();
  page.session.open({ name: "agent", paneId: "w9:pE" });
  await flush();
  await page.live();
  page.failing.set("workspace w9", failure("workspace_not_found", "That workspace is gone."));
  page.session.open({ name: "agent", paneId: "w9:pD" });
  await flush();
  expect(page.session.snapshot()).toMatchObject({ terminal: null, missing: { gone: true }, workspace: { id: "w9", label: null, terminals: [] } });
  page.reset();
  await page.advance(9_000);
  expect(page.count("agents")).toBe(0);
});

test("the All screen is drawn once its terminals answer, not when the list does", async () => {
  const page = setup();
  await flush();
  const terminals = page.hold("terminals");
  page.session.open({ name: "all" });
  page.reset();
  await page.advance(3_000);
  expect(page.calls).toEqual(["agents"]);
  expect(page.changes).toEqual([]);
  terminals.resolve();
  await flush();
  expect(page.changes).toContain("screen");
  expect(page.session.snapshot()).toMatchObject({ terminalsLoaded: true });
  expect(page.session.snapshot().terminals).toHaveLength(3);
});

test("an agent list answer updates the one copy of a pane, its tab included, and keeps its workspace label; a pane every list dropped is forgotten", async () => {
  const page = setup();
  await flush();
  await page.live();
  page.session.open({ name: "agent", paneId: "w9:pE" });
  await flush();
  const workspace = page.hold("workspace w9");
  page.herdr.agents[1].agent_status = "working";
  page.herdr.agents[1].tab = { id: "t-w9:pE", label: "renamed", number: 1 };
  page.stream().fire("change", { changed: [], refetch: true });
  await flush();
  expect(page.session.snapshot().terminal).toMatchObject({ pane_id: "w9:pE", status: "working", tab: { id: "t-w9:pE", label: "renamed", number: 1 }, workspace: dashboard });
  expect(page.session.snapshot().agents.find((row) => row.pane_id === "w9:pE")?.tab).toEqual({ id: "t-w9:pE", label: "renamed", number: 1 });
  workspace.resolve();
  await flush();
  page.session.open({ name: "home" });
  const [pD] = page.herdr.agents.splice(0, 1);
  page.stream().fire("change", { changed: [], refetch: true });
  await flush();
  page.herdr.agents.unshift(pD);
  page.stream().fire("change", { changed: [], refetch: true });
  await flush();
  page.session.open({ name: "agent", paneId: "w9:pD" });
  expect(page.session.snapshot().terminal).toMatchObject({ pane_id: "w9:pD", tab: { id: "t-w9:pD", label: "1", number: 1 }, workspace: { id: "w9", label: null } });
});

test("a send goes to the open Terminal as its kind, one message at a time, then re-reads its output and the list", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pE" } });
  await flush();
  await page.live();
  page.reset();
  const drawn: boolean[] = [];
  page.session.subscribe((change) => {
    if (change === "screen") drawn.push(page.session.snapshot().sending);
  });
  const prompt = page.hold("prompt w9:pE atomic summarize what you changed");
  const output = page.hold("output w9:pE");
  const list = page.hold("agents");
  const sending = page.session.sendText("summarize what you changed");
  expect(drawn).toEqual([true]);
  expect(await page.session.sendText("again")).toEqual({ status: "ignored" });
  prompt.resolve();
  expect(await sending).toMatchObject({ status: "sent", terminal: { pane_id: "w9:pE" }, error: null });
  expect(drawn).toEqual([true, false]);
  expect(page.calls).toEqual(["prompt w9:pE atomic summarize what you changed", "output w9:pE", "agents"]);
  page.reset();
  output.resolve();
  await flush();
  expect(page.changes).toEqual(["output"]);
  list.resolve();
  await flush();
  expect(page.calls).toEqual(["workspace w9"]);
  expect(page.changes).toEqual(["output", "screen", "screen"]);

  page.reset();
  expect(await page.session.sendText("   ")).toEqual({ status: "ignored" });
  await flush();
  expect(page.calls).toEqual([]);
  expect(page.changes).toEqual([]);

  page.reset();
  expect(await page.session.sendKey("enter")).toMatchObject({ status: "sent", error: null });
  await flush();
  expect(page.calls).toEqual(["keys w9:pE atomic enter", "output w9:pE", "agents", "workspace w9"]);

  for (const code of ["terminal_changed", "pane_not_found"]) {
    page.reset();
    page.failing.set("keys w9:pE atomic enter", failure(code, "That terminal changed since this screen loaded. Nothing was sent."));
    expect(await page.session.sendKey("enter")).toMatchObject({ status: "refused", error: { code } });
    await flush();
    expect([code, page.calls]).toEqual([code, ["keys w9:pE atomic enter", "agents", "output w9:pE", "workspace w9"]]);
  }
  page.reset();
  page.failing.set("keys w9:pE atomic enter", failure("agent_blocked", "It's waiting on a question."));
  expect(await page.session.sendKey("enter")).toMatchObject({ status: "refused", error: { code: "agent_blocked" } });
  await flush();
  expect(page.calls).toEqual(["keys w9:pE atomic enter"]);
});

test("a hidden page closes the stream and its timers read nothing", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pD" } });
  await flush();
  await page.live();
  page.reset();
  page.session.hidden();
  expect(page.stream().closed).toBe(true);
  expect(page.session.snapshot().streaming).toBe(false);
  await page.advance(20_000);
  expect(page.calls).toEqual([]);
});

test("a page shown again opens a new stream, reads what it missed, and is Live once the stream says so", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pD" }, visible: false });
  await flush();
  expect(page.sources).toHaveLength(0);
  page.reset();
  page.session.visible();
  expect(page.sources).toHaveLength(1);
  await flush();
  expect(page.calls).toEqual(["agents", "output w9:pD", "workspace w9"]);
  expect([...page.changes].sort()).toEqual(["output", "screen", "screen"]);
  await page.live();
  expect(page.session.snapshot().streaming).toBe(true);
  page.session.hidden();
  page.session.visible();
  expect(page.sources.map((source) => source.closed)).toEqual([true, false]);
});

test("the sample data opens no stream, so its list is polled every 3 s, each answer drawn", async () => {
  const page = setup({ sample: true });
  await flush();
  page.session.hidden();
  page.session.visible();
  await flush();
  expect(page.sources).toHaveLength(0);
  page.reset();
  await page.advance(9_000);
  expect(page.count("agents")).toBe(3);
  expect(page.changes).toEqual(["screen", "screen", "screen"]);
  expect(page.session.snapshot().updatedAt).toBe(9_000);
});

// Live output: the open Terminal is watched on the page's named stream.
async function streamedPage(paneId = "w9:pD") {
  const page = setup({ route: { name: "agent", paneId } });
  await flush();
  await page.live();
  page.stream().fire("stream", { id: "s1" });
  await flush();
  page.stream().fire("watch", { pane_id: paneId, streaming: true });
  page.stream().fire("output", { pane_id: paneId, text: `pushed screen of ${paneId}` });
  await flush();
  return page;
}

test("live output: the open Terminal is watched on the page's named stream; once streamed, its output arrives by push and isn't polled", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pD" } });
  await flush();
  await page.live();
  expect(page.calls).not.toContain("watch w9:pD s1");
  page.stream().fire("stream", { id: "s1" });
  await flush();
  expect(page.calls).toContain("watch w9:pD s1");
  page.reset();
  await page.advance(2_000);
  expect(page.count("output w9:pD")).toBe(1);
  page.stream().fire("watch", { pane_id: "w9:pD", streaming: true });
  page.stream().fire("output", { pane_id: "w9:pD", text: "pushed one" });
  await flush();
  expect(page.session.snapshot().output).toEqual({ text: "pushed one", error: null });
  page.reset();
  await page.advance(10_000);
  page.stream().fire("output", { pane_id: "w9:pD" });
  page.stream().fire("output", { pane_id: "w9:pD", text: "pushed two" });
  await flush();
  expect(page.calls).toEqual([]);
  expect(page.changes).toEqual(["output"]);
  expect(page.session.snapshot().output).toEqual({ text: "pushed two", error: null });
  page.stream().fire("output", { pane_id: "w9:pE", text: "not this one" });
  await flush();
  expect(page.session.snapshot().output.text).toBe("pushed two");
});

test("live output: a pushed screen is the same text a poll would give, so the snapshot (and so the Reader) is the same", async () => {
  const polled = setup({ route: { name: "agent", paneId: "w9:pD" } });
  await flush();
  const streamed = await streamedPage();
  streamed.stream().fire("output", { pane_id: "w9:pD", text: "screen of w9:pD" });
  await flush();
  expect(streamed.session.snapshot().output).toEqual(polled.session.snapshot().output);
});

test("live output: when the server stops streaming it, or the stream drops, the output is read at once and polled again; a new stream watches again", async () => {
  const page = await streamedPage();
  page.reset();
  page.stream().fire("watch", { pane_id: "w9:pD", streaming: false });
  await flush();
  expect(page.calls).toEqual(["output w9:pD"]);
  page.reset();
  await page.advance(4_000);
  expect(page.count("output w9:pD")).toBe(2);
  page.stream().fire("watch", { pane_id: "w9:pD", streaming: true });
  await flush();
  page.reset();
  await page.advance(4_000);
  expect(page.calls).toEqual([]);
  page.stream().fail(CONNECTING);
  await flush();
  expect(page.count("output w9:pD")).toBe(1);
  page.reset();
  await page.advance(4_000);
  expect(page.count("output w9:pD")).toBe(2);
  page.stream().fire("stream", { id: "s2" });
  await page.live();
  expect(page.calls).toContain("watch w9:pD s2");
  page.stream().fire("watch", { pane_id: "w9:pD", streaming: true });
  await flush();
  page.reset();
  await page.advance(4_000);
  expect(page.calls).toEqual([]);
});

test("live output: swapping Terminals moves the watch; leaving the screen or hiding the page ends it; a stale push is dropped", async () => {
  const page = await streamedPage();
  page.reset();
  page.session.open({ name: "agent", paneId: "w9:pE" });
  await flush();
  expect(page.calls).toContain("watch w9:pE s1");
  expect(page.calls).not.toContain("unwatch w9:pD s1");
  page.stream().fire("watch", { pane_id: "w9:pD", streaming: true });
  page.stream().fire("output", { pane_id: "w9:pD", text: "old pane" });
  await flush();
  expect(page.session.snapshot().output.text).toBe("screen of w9:pE");
  page.reset();
  page.session.open({ name: "home" });
  await flush();
  expect(page.calls).toContain("unwatch w9:pE s1");
  page.session.open({ name: "agent", paneId: "w9:pD" });
  await flush();
  page.reset();
  page.session.hidden();
  await flush();
  expect(page.calls).toEqual(["unwatch w9:pD s1"]);
  expect(page.stream().closed).toBe(true);
  page.session.visible();
  page.stream().fire("stream", { id: "s3" });
  await flush();
  expect(page.calls).toContain("watch w9:pD s3");
});

test("live output: a watch request that fails leaves the page polling", async () => {
  const page = setup({ route: { name: "agent", paneId: "w9:pD" } });
  await flush();
  await page.live();
  page.failing.set("watch w9:pD s1", failure("not_found", "No such event stream."));
  page.stream().fire("stream", { id: "s1" });
  await flush();
  page.reset();
  await page.advance(4_000);
  expect(page.count("output w9:pD")).toBe(2);
});

test("live output: a read that began before a push is dropped, so an older screen never replaces a pushed one", async () => {
  const page = await streamedPage();
  const read = page.hold("output w9:pD");
  await page.session.sendKey("enter");
  page.stream().fire("output", { pane_id: "w9:pD", text: "pushed after the key" });
  await flush();
  read.resolve();
  await flush();
  expect(page.session.snapshot().output).toEqual({ text: "pushed after the key", error: null });
});

test("live output: herdr's events down doesn't stop a streamed Terminal; if its stream then drops, the output is read at once", async () => {
  const page = await streamedPage();
  page.stream().fire("live", { live: false });
  await flush();
  page.reset();
  await page.advance(4_000);
  expect(page.count("output w9:pD")).toBe(0);
  page.stream().fail(CONNECTING);
  await flush();
  expect(page.count("output w9:pD")).toBe(1);
});
