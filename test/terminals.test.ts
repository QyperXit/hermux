// Every herdr pane is a terminal, an agent or a plain shell, that can be
// listed and read the same way; sends are in send.test.ts. The fake herdr
// mirrors the shapes of herdr 0.9.5's `pane list`, `pane get`, `workspace list`
// and `tab list`.
import { afterAll, describe, expect, test } from "bun:test";
import { shellLatestLine } from "../server/latest-line";
import { RECENT_IDLE_READS } from "../server/roster";
import type { FakeConfig } from "./fake-herdr";
import { FORMAT_REFUSALS, FORMAT_UNSUPPORTED, OTHER_READ_FAILURES, disposeFakes, herdrError, sorted } from "./support/http";
import { AGENTS, ATOMIC, CONFIG, OTHER_AGENT, OUTPUTS, PI, SERVER_SHELL, SHELL_PANE, keys, pane, path, prompt, setup, without } from "./support/terminals";

afterAll(disposeFakes);

const agentRead = (paneId: string) => ["agent", "read", paneId, "--source", "recent-unwrapped", "--lines", "200"];
const paneRead = (paneId: string) => ["pane", "read", paneId, "--source", "recent-unwrapped", "--lines", "200"];
const LISTS = [["pane", "list"], ["agent", "list"], ["workspace", "list"], ["tab", "list"]];

describe.concurrent("terminal inventory", () => {
  test("GET /api/terminals lists every pane once, in herdr's pane order, agents merged with their pane, labels and tab numbers", async () => {
    const { request, calls } = setup();
    const response = await request("GET", "/api/terminals");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      terminals: [
        { pane_id: SHELL_PANE, kind: "shell", status: null, workspace: { id: "w9", label: "usage-dashboard" }, tab: { id: "w9:t2", label: "1", number: 1 }, cwd: "/home/you/usage-dashboard", title: "you@laptop:~/usage-dashboard", latest_line: "you@laptop:~/usage-dashboard$" },
        { pane_id: ATOMIC, kind: "atomic", status: "idle", workspace: { id: "w9", label: "usage-dashboard" }, tab: { id: "w9:tD", label: "next work", number: 2 }, cwd: "/home/you/usage-dashboard", title: "atomic - next work - usage-dashboard", state_change_seq: 30, completion_seq: 29, latest_line: "Finished the chart fix." },
        { pane_id: PI, kind: "pi", status: "working", workspace: { id: "w9", label: "usage-dashboard" }, tab: { id: "w9:tE", label: "3", number: 3 }, cwd: "/home/you/usage-dashboard", title: "pi - usage-dashboard", state_change_seq: 40, latest_line: "Running the chart tests" },
        { pane_id: OTHER_AGENT, kind: "atomic", status: "blocked", workspace: { id: "wF", label: "hermux" }, tab: { id: "wF:t1", label: "1", number: 1 }, cwd: "/home/you/hermux", title: "atomic - hermux", state_change_seq: 7, latest_line: "Which port should it use?" },
        { pane_id: SERVER_SHELL, kind: "shell", status: null, workspace: { id: "wF", label: "hermux" }, tab: { id: "wF:tM", label: "server", number: 2 }, cwd: "/home/you/hermux", title: "bun server/main.ts", latest_line: "Agents server listening on http://127.0.0.1:8787" },
      ],
    });
    // Agents are read with `agent read` (Atomic's chrome is cut), shells with `pane read`.
    expect(sorted(calls())).toEqual(sorted([...LISTS, agentRead(ATOMIC), agentRead(PI), agentRead(OTHER_AGENT), paneRead(SHELL_PANE), paneRead(SERVER_SHELL)]));
  });

  test("a shell's latest line is the last line with anything on it, trimmed; none when the screen is blank", () => {
    expect(shellLatestLine("a\n  b  \n \n\t\n")).toBe("b");
    expect(shellLatestLine("only\r\n")).toBe("only");
    expect(shellLatestLine("\n \n")).toBeNull();
    expect(shellLatestLine("")).toBeNull();
  });

  test("GET /api/terminals reads the idle agents named in `lines` too, and never every idle agent", async () => {
    const idle = Array.from({ length: RECENT_IDLE_READS + 3 }, (_, index) => ({ ...pane(`w9:pI${index}`, "w9", `w9:tI${index}`), agent: "atomic", agent_status: "idle", state_change_seq: 100 + index }));
    const { request, calls } = setup({ ...CONFIG, agents: [...AGENTS, ...idle] });
    const terminals = (await (await request("GET", `/api/terminals?lines=${encodeURIComponent("w9:pI0,w9:pI1")}`)).json()).terminals as { pane_id: string; latest_line?: string }[];
    const read = new Set(calls().filter((call) => call[1] === "read").map((call) => call[2]));
    expect([read.has("w9:pI0"), read.has("w9:pI1"), read.has("w9:pI2")]).toEqual([true, true, false]);
    expect(terminals.find((t) => t.pane_id === "w9:pI2")).not.toHaveProperty("latest_line");
  });

  test("a pane herdr lists with an agent is never offered as a shell, even if `agent list` missed it", async () => {
    const { request } = setup({ ...CONFIG, answers: { list: { exit: 0, stdout: JSON.stringify({ id: "cli:agent:list", result: { agents: without(ATOMIC) } }) } } });
    const terminals = (await (await request("GET", "/api/terminals")).json()).terminals as { pane_id: string; kind: string; status: string }[];
    expect(terminals.find((t) => t.pane_id === ATOMIC)).toMatchObject({ kind: "atomic", status: "idle" });
  });

  test("pane and workspace JSON in the wrong shape is 502 herdr_bad_output where it is parsed, never passed on", async () => {
    const out = (result: unknown) => ({ exit: 0, stdout: JSON.stringify({ id: "cli:request", result }) });
    const cases: [string, string, FakeConfig["answers"]][] = [
      ["a pane list row without pane_id", "/api/terminals", { "pane list": out({ type: "pane_list", panes: [{ workspace_id: "w9" }] }) }],
      ["a workspace list row without workspace_id", "/api/terminals", { "workspace list": out({ type: "workspace_list", workspaces: [{ label: "x" }] }) }],
      ["a pane get that isn't a pane", path(SHELL_PANE, "keys"), { "pane get": out({ pane: [], type: "pane_info" }) }],
    ];
    for (const [name, route, answers] of cases) {
      const { request, calls } = setup({ ...CONFIG, answers });
      const send = route.endsWith("/keys");
      const response = await request(send ? "POST" : "GET", route, send ? { body: { keys: ["enter"], kind: "shell" } } : {});
      expect([name, response.status, (await response.json()).error?.code]).toEqual([name, 502, "herdr_bad_output"]);
      expect(calls().filter((call) => call[1].startsWith("send"))).toEqual([]);
    }
  });
});

describe.concurrent("tab names (D31)", () => {
  const tabLists = (calls: string[][]) => calls.filter((call) => call.join(" ") === "tab list").length;

  test("GET /api/agents gives each agent its tab, the same as the terminal list gives its pane", async () => {
    const { request } = setup();
    const agents = (await (await request("GET", "/api/agents")).json()).agents as { pane_id: string; tab: unknown }[];
    const terminals = (await (await request("GET", "/api/terminals")).json()).terminals as { pane_id: string; tab: unknown }[];
    expect(agents.map(({ pane_id, tab }) => [pane_id, tab])).toEqual([
      [ATOMIC, { id: "w9:tD", label: "next work", number: 2 }],
      [PI, { id: "w9:tE", label: "3", number: 3 }],
      [OTHER_AGENT, { id: "wF:t1", label: "1", number: 1 }],
    ]);
    for (const agent of agents) expect(agent.tab).toEqual(terminals.find((terminal) => terminal.pane_id === agent.pane_id)?.tab);
  });

  test("the agent list and the terminal lists share one `tab list` for 10 s, then read it again", async () => {
    const { request, calls, setClock } = setup();
    for (const route of ["/api/agents", "/api/terminals", "/api/workspaces/w9/terminals", "/api/agents", "/api/terminals"]) {
      expect((await request("GET", route)).status).toBe(200);
    }
    setClock(10_999);
    expect((await request("GET", "/api/agents")).status).toBe(200);
    expect(tabLists(calls())).toBe(1);
    setClock(11_000);
    expect((await request("GET", "/api/terminals")).status).toBe(200);
    expect((await request("GET", "/api/agents")).status).toBe(200);
    expect(tabLists(calls())).toBe(2);
  });

  test("a `tab list` that fails or is the wrong shape leaves every tab without a label or number; the lists still answer", async () => {
    const out = (result: unknown) => ({ exit: 0, stdout: JSON.stringify({ id: "cli:tab:list", result }) });
    for (const answer of [herdrError("server_unreachable", "herdr server not running", "cli:tab:list"), out({ type: "tab_list", tabs: [null] })]) {
      const { request } = setup({ ...CONFIG, answers: { "tab list": answer } });
      for (const [route, field] of [["/api/agents", "agents"], ["/api/terminals", "terminals"], ["/api/workspaces/wF/terminals", "terminals"]]) {
        const response = await request("GET", route);
        expect([route, response.status]).toEqual([route, 200]);
        const rows = (await response.json())[field] as { tab: { label: unknown; number: unknown } }[];
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect([route, row.tab.label, row.tab.number]).toEqual([route, null, null]);
      }
    }
  });
});

describe.concurrent("a workspace's terminals", () => {
  test("GET /api/workspaces/:id/terminals answers the workspace and its panes, each with its latest line", async () => {
    const { request } = setup();
    const response = await request("GET", "/api/workspaces/w9/terminals");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workspace).toEqual({ id: "w9", label: "usage-dashboard" });
    expect(body.terminals.map((t: { pane_id: string; kind: string; latest_line: string }) => [t.pane_id, t.kind, t.latest_line])).toEqual([
      [SHELL_PANE, "shell", "you@laptop:~/usage-dashboard$"],
      [ATOMIC, "atomic", "Finished the chart fix."],
      [PI, "pi", "Running the chart tests"],
    ]);
  });

  test("an unknown workspace is 404 workspace_not_found; other methods 405; nothing is read", async () => {
    const { request, calls } = setup();
    const missing = await request("GET", "/api/workspaces/w99/terminals");
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("workspace_not_found");
    for (const odd of ["/api/workspaces/--help/terminals", "/api/workspaces/w9%3Ap2/terminals"]) expect((await request("GET", odd)).status).toBe(404);
    expect((await request("POST", "/api/workspaces/w9/terminals", { body: {} })).status).toBe(405);
    expect((await request("GET", "/api/workspaces/w9")).status).toBe(404);
    expect((await request("GET", "/api/workspaces")).status).toBe(404);
    expect(calls().filter((call) => call[1] === "read")).toEqual([]);
  });
});

describe.concurrent("terminal output", () => {
  test("a shell's output is `pane read --source recent-unwrapped --format ansi`, unchanged, in the agent output's shape", async () => {
    const text = "\x1b[0m\x1b[1m\x1b[38;5;2myou@laptop\x1b[0m:~$ echo \"<b>&amp;\" $HOME\n<b>&amp; /home/you\n";
    const { request, calls } = setup({ ...CONFIG, ansiOutputs: { [SHELL_PANE]: text } });
    const response = await request("GET", path(SHELL_PANE, "output"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text });
    expect(calls()).toEqual([[...paneRead(SHELL_PANE), "--format", "ansi"]]);
  });

  test("an agent's output on the terminal route is the same `pane read` (herdr gives agent panes the same bytes)", async () => {
    const { request, calls } = setup({ ...CONFIG, ansiOutputs: { [ATOMIC]: "\x1b[1mstyled\x1b[0m" } });
    expect(await (await request("GET", path(ATOMIC, "output"))).json()).toEqual({ text: "\x1b[1mstyled\x1b[0m" });
    expect(calls()).toEqual([[...paneRead(ATOMIC), "--format", "ansi"]]);
  });

  test("falls back to the plain read when herdr can't style it; a gone pane is 404 pane_not_found without a second read", async () => {
    const { request, calls } = setup({ ...CONFIG, answers: { "pane read --format ansi": FORMAT_UNSUPPORTED } });
    expect(await (await request("GET", path(SHELL_PANE, "output"))).json()).toEqual({ text: OUTPUTS[SHELL_PANE] });
    expect(calls()).toEqual([[...paneRead(SHELL_PANE), "--format", "ansi"], paneRead(SHELL_PANE)]);

    const gone = setup();
    const response = await gone.request("GET", path("w9:p99", "output"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "pane_not_found", message: "pane w9:p99 not found" } });
    expect(gone.calls()).toHaveLength(1);
  });

  test("falls back to the plain read for each way herdr says it can't style, and on any other failure answers it after one read", async () => {
    for (const refusal of FORMAT_REFUSALS) {
      const { request, calls } = setup({ ...CONFIG, answers: { "pane read --format ansi": refusal } });
      const response = await request("GET", path(SHELL_PANE, "output"));
      expect([refusal.stderr, response.status, await response.json()]).toEqual([refusal.stderr, 200, { text: OUTPUTS[SHELL_PANE] }]);
      expect(calls()).toEqual([[...paneRead(SHELL_PANE), "--format", "ansi"], paneRead(SHELL_PANE)]);
    }
    for (const [code, failure] of OTHER_READ_FAILURES) {
      const { request, calls } = setup({ ...CONFIG, answers: { "pane read --format ansi": failure } });
      const response = await request("GET", path(SHELL_PANE, "output"));
      expect([code, response.status, (await response.json()).error.code]).toEqual([code, 502, code]);
      expect(calls()).toEqual([[...paneRead(SHELL_PANE), "--format", "ansi"]]);
    }
  });

  test("history stays agent-only: a shell is refused with 409 not_an_agent, a gone pane 404, an agent answers", async () => {
    const { request, calls } = setup();
    const shell = await request("GET", path(SHELL_PANE, "history"));
    expect(shell.status).toBe(409);
    expect((await shell.json()).error.code).toBe("not_an_agent");
    expect(calls()).toEqual([["agent", "get", SHELL_PANE], ["pane", "get", SHELL_PANE]]);
    const gone = await request("GET", path("w9:p99", "history"));
    expect([gone.status, (await gone.json()).error.code]).toEqual([404, "pane_not_found"]);
    // This app has no session store, so an agent answers "unavailable" as before.
    expect(await (await request("GET", path(ATOMIC, "history"))).json()).toEqual({ history: null, reason: "unavailable" });
    expect((await request("GET", `${path(SHELL_PANE, "history")}?before=0`)).status).toBe(400);
    expect((await request("POST", path(SHELL_PANE, "history"), { body: {} })).status).toBe(405);
  });
});

describe.concurrent("guards on the terminal routes", () => {
  const routes: [string, string, unknown?][] = [
    ["GET", "/api/terminals"],
    ["GET", "/api/workspaces/w9/terminals"],
    ["GET", path(SHELL_PANE, "output")],
    ["GET", path(SHELL_PANE, "history")],
    ["POST", path(SHELL_PANE, "prompt"), { text: "id", kind: "shell" }],
    ["POST", path(SHELL_PANE, "keys"), { keys: ["ctrl+c"], kind: "shell" }],
  ];

  for (const login of [null, "", "someone.else@example.com", "You@Example.com"]) {
    test(`403 with login ${JSON.stringify(login)} and herdr never runs`, async () => {
      const { request, calls } = setup();
      for (const [method, route, body] of routes) expect([route, (await request(method, route, { login, body })).status]).toEqual([route, 403]);
      expect(calls()).toEqual([]);
    });
  }

  test("cross-site and non-JSON POSTs are refused before herdr runs", async () => {
    const { request, calls } = setup();
    for (const [, route, body] of routes.filter(([method]) => method === "POST")) {
      expect((await request("POST", route, { body, headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
      expect((await request("POST", route, { body: JSON.stringify(body), headers: { "content-type": "text/plain" } })).status).toBe(415);
    }
    expect(calls()).toEqual([]);
  });

  for (const target of ["-x", "--help", "w1:p1;rm", "w1", "w1:p1 --machine x"]) {
    test(`refuses target ${JSON.stringify(target)} with 400 before herdr runs`, async () => {
      const { request, calls } = setup();
      for (const [method, route, init] of [
        ["GET", path(target, "output"), {}],
        ["GET", path(target, "history"), {}],
        ["POST", ...prompt(target, "hi", "shell")],
        ["POST", ...keys(target, ["enter"], "shell")],
      ] as const) {
        const response = await request(method, route, init);
        expect([route, response.status, (await response.json()).error.code]).toEqual([route, 400, "invalid_target"]);
      }
      expect(calls()).toEqual([]);
    });
  }

  test("unknown terminal routes and wrong methods are refused without running herdr", async () => {
    const { request, calls } = setup();
    expect((await request("POST", "/api/terminals", { body: {} })).status).toBe(405);
    expect((await request("GET", `/api/terminals/${encodeURIComponent(SHELL_PANE)}`)).status).toBe(405);
    expect((await request("POST", path(SHELL_PANE, "run"), { body: { text: "id" } })).status).toBe(404);
    expect((await request("POST", path(SHELL_PANE, "close"), { body: {} })).status).toBe(404);
    expect((await request("GET", path(SHELL_PANE, "prompt"))).status).toBe(405);
    expect((await request("POST", path(SHELL_PANE, "output"), { body: {} })).status).toBe(405);
    expect(calls()).toEqual([]);
  });

  test("a pane itself has no method on the terminal route: every method is 405; an unknown action stays 404", async () => {
    const { request, calls } = setup();
    for (const paneId of [SHELL_PANE, ATOMIC]) {
      for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"]) {
        const response = await request(method, `/api/terminals/${encodeURIComponent(paneId)}`, { body: method === "POST" ? {} : undefined });
        expect([paneId, method, response.status, (await response.json()).error.code]).toEqual([paneId, method, 405, "method_not_allowed"]);
      }
      const unknown = await request("PUT", path(paneId, "bogus"));
      expect([paneId, unknown.status, (await unknown.json()).error.code]).toEqual([paneId, 404, "not_found"]);
    }
    expect(calls()).toEqual([]);
  });
});
