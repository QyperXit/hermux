// The browser's HTTP client (web/api.js) against the real app over real HTTP,
// with a fake herdr and a fixture session store. The page's relative URLs are
// sent to the test server with the login header tailscale serve adds; every
// request the client makes is recorded as it went out.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../server/app";
import { createHerdr } from "../server/herdr";
import { createHistory, openSessionStore, type HistoryPage } from "../server/history";
import { createHttpClient, errorMessage } from "../web/api.js";
import { lineErrorText } from "../web/terminals.js";
import { makeFakeHerdr, type FakeConfig } from "./fake-herdr";
import { ALLOWED_LOGIN, HERDR_COMMANDS, auditCalls, paste } from "./support/http";
import { FOOTER } from "./support/screens";
import { CWD, makeStore, removeStores, type Entry } from "./support/session-store";

const ATOMIC = "w8:p1";
const PI = "w8:p3";
const SHELL_PANE = "w8:p2";
const LAST = "the latest answer is on the screen right now";

const user = (text: string): Entry => ({ type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: 1 } });
const assistant = (text: string): Entry => ({ type: "message", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
// Six turns: seq 1-12, the last answer on screen.
const entries = Array.from({ length: 6 }, (_, index) => [user(`question number ${index + 1} about the release`), assistant(index === 5 ? LAST : `answer number ${index + 1} for the release notes`)]).flat();
const screen = ` question number 6 about the release\n ${LAST}${FOOTER}`;

const CONFIG: FakeConfig = {
  agents: [
    { agent: "atomic", pane_id: ATOMIC, workspace_id: "w8", tab_id: "w8:t1", agent_status: "idle", state_change_seq: 4, cwd: CWD, terminal_title_stripped: "atomic - weather-app" },
    { agent: "pi", pane_id: PI, workspace_id: "w8", tab_id: "w8:t3", agent_status: "working", state_change_seq: 9, cwd: CWD, terminal_title_stripped: "pi - weather-app" },
  ],
  shells: [{ pane_id: SHELL_PANE, workspace_id: "w8", tab_id: "w8:t2", cwd: CWD, terminal_title_stripped: "you@laptop:~/weather-app" }],
  workspaces: [{ workspace_id: "w8", label: "weather-app" }],
  tabs: [
    { tab_id: "w8:t1", workspace_id: "w8", label: "release" },
    { tab_id: "w8:t2", workspace_id: "w8", label: "2" },
    { tab_id: "w8:t3", workspace_id: "w8", label: "3" },
  ],
  outputs: { [ATOMIC]: screen, [PI]: "Running the tests\n", [SHELL_PANE]: "$ make\nbuilt\n" },
  ansiOutputs: { [SHELL_PANE]: "\x1b[1m$ make\x1b[0m\nbuilt\n" },
};

type Sent = { method: string; path: string; type: string | null; body: unknown };

const realFetch = globalThis.fetch;
const fakes: ReturnType<typeof makeFakeHerdr>[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
let fake: ReturnType<typeof makeFakeHerdr>;
let sent: Sent[];

// The page of earlier messages the server answered; the test fails if it has none.
function held(answer: HistoryPage) {
  if (!answer.history) throw new Error(`Expected a page of earlier messages, got ${answer.reason}.`);
  return answer.history;
}

// A server for the real app; the page's fetch goes to it.
function serve(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  servers.push(server);
  const toTestServer = async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Tailscale-User-Login", ALLOWED_LOGIN);
    sent.push({ method: init.method ?? "GET", path: String(input), type: headers.get("content-type"), body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
    return realFetch(`http://127.0.0.1:${server.port}/${input}`, { ...init, headers });
  };
  globalThis.fetch = Object.assign(toTestServer, { preconnect: realFetch.preconnect });
}

beforeEach(() => {
  sent = [];
  fake = makeFakeHerdr(CONFIG);
  fakes.push(fake);
  const herdr = createHerdr(fake.bin, { submitDelayMs: 0 });
  const store = makeStore([{ id: "s1", entries }]);
  serve(createApp({ herdr, allowedLogin: ALLOWED_LOGIN, webRoot: "/nonexistent", history: createHistory({ herdr, openStore: () => openSessionStore(store) }) }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  auditCalls(fake.calls(), HERDR_COMMANDS);
});

afterAll(() => {
  for (const server of servers) server.stop(true);
  for (const each of fakes) each.dispose();
  removeStores();
});

describe("reads", () => {
  test("listAgents gets the agent list, naming the panes whose lines it wants", async () => {
    const agents = await createHttpClient().listAgents([ATOMIC, SHELL_PANE]);
    expect(agents.map((agent) => [agent.pane_id, agent.latest_line])).toEqual([
      [ATOMIC, LAST],
      [PI, "Running the tests"],
    ]);
    expect(sent).toEqual([{ method: "GET", path: `api/agents?lines=${encodeURIComponent(`${ATOMIC},${SHELL_PANE}`)}`, type: null, body: undefined }]);
    expect(await createHttpClient().listAgents()).toHaveLength(2);
    expect(sent[1].path).toBe("api/agents");
  });

  test("listTerminals and listWorkspaceTerminals get every pane, agents and shells", async () => {
    const client = createHttpClient();
    const terminals = await client.listTerminals();
    expect(terminals.map((terminal: { pane_id: string; kind: string }) => [terminal.pane_id, terminal.kind])).toEqual([
      [ATOMIC, "atomic"],
      [SHELL_PANE, "shell"],
      [PI, "pi"],
    ]);
    const workspace = await client.listWorkspaceTerminals("w8");
    expect(workspace.workspace).toEqual({ id: "w8", label: "weather-app" });
    expect(workspace.terminals).toHaveLength(3);
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual(["GET api/terminals", "GET api/workspaces/w8/terminals"]);
  });

  test("readOutput reads any pane's styled screen through the terminal route", async () => {
    expect(await createHttpClient().readOutput(SHELL_PANE)).toBe("\x1b[1m$ make\x1b[0m\nbuilt\n");
    expect(sent.map(({ path }) => path)).toEqual([`api/terminals/${encodeURIComponent(SHELL_PANE)}/output`]);
  });

  test("readHistory asks for a page with before, from and limit, and gets the store's messages", async () => {
    const client = createHttpClient();
    const first = held(await client.readHistory(ATOMIC, { limit: 4 }));
    expect(first.session).toBe("s1");
    expect(first.messages.map((message) => message.seq)).toEqual([7, 8, 9, 10]);
    const next = held(await client.readHistory(ATOMIC, { before: first.before, limit: 4 }));
    expect(next.messages.map((message) => message.seq)).toEqual([3, 4, 5, 6]);
    const since = held(await client.readHistory(ATOMIC, { from: 9, limit: 4 }));
    expect(since.messages.map((message) => message.seq)).toEqual([9, 10]);
    const path = `api/terminals/${encodeURIComponent(ATOMIC)}/history`;
    expect(sent.map((request) => request.path)).toEqual([`${path}?limit=4`, `${path}?before=7&limit=4`, `${path}?from=9&limit=4`]);
  });

  test("a read that doesn't answer in time is the laptop not answering", async () => {
    serve(() => new Promise<Response>(() => {}));
    const started = performance.now();
    const error = await createHttpClient({ readTimeoutMs: 100 })
      .listTerminals()
      .then(() => null, (thrown: Error & { code?: string }) => thrown);
    expect([error?.code, error?.message]).toEqual(["unreachable", "The laptop didn't answer."]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("sends", () => {
  test("sendPrompt to a shell posts JSON with its kind, and the exact text is typed, then Enter", async () => {
    await createHttpClient().sendPrompt(SHELL_PANE, `echo "it's" $HOME`, "shell");
    expect(sent).toEqual([{ method: "POST", path: `api/terminals/${encodeURIComponent(SHELL_PANE)}/prompt`, type: "application/json", body: { text: `echo "it's" $HOME`, kind: "shell" } }]);
    expect(fake.calls()).toEqual([["pane", "get", SHELL_PANE], ["pane", "send-text", SHELL_PANE, `echo "it's" $HOME`], ["pane", "send-keys", SHELL_PANE, "enter"]]);
  });

  test("sendPrompt to a custom-kind agent posts its kind, and the text goes as one bracketed paste, then Enter", async () => {
    await createHttpClient().sendPrompt(ATOMIC, "ship it\nnow", "atomic");
    expect(sent).toEqual([{ method: "POST", path: `api/terminals/${encodeURIComponent(ATOMIC)}/prompt`, type: "application/json", body: { text: "ship it\nnow", kind: "atomic" } }]);
    expect(fake.calls()).toEqual([["agent", "get", ATOMIC], ["pane", "send-text", ATOMIC, paste("ship it\nnow")], ["pane", "send-keys", ATOMIC, "enter"]]);
  });

  test("sendKeys posts the keys with the kind, and they go in one send-keys after the re-check", async () => {
    await createHttpClient().sendKeys(PI, ["ctrl+c", "up", "enter"], "pi");
    expect(sent).toEqual([{ method: "POST", path: `api/terminals/${encodeURIComponent(PI)}/keys`, type: "application/json", body: { keys: ["ctrl+c", "up", "enter"], kind: "pi" } }]);
    expect(fake.calls()).toEqual([["agent", "get", PI], ["agent", "send-keys", PI, "ctrl+c", "up", "enter"]]);
  });

  test("a refused send comes back as the server's code with the page's words, and nothing is sent", async () => {
    const error = await createHttpClient()
      .sendKeys(SHELL_PANE, ["ctrl+c"], "atomic")
      .then(() => null, (thrown: Error & { code?: string }) => thrown);
    expect([error?.code, error?.message]).toEqual(["terminal_changed", "That terminal changed since this screen loaded. Nothing was sent."]);
    expect(fake.calls().filter((call) => call[1].startsWith("send"))).toEqual([]);
  });
});

test("watchOutput and unwatchOutput send the stream's name as JSON to the pane's watch route; a refusal comes back as an error", async () => {
  const client = createHttpClient();
  const path = `api/terminals/${encodeURIComponent(SHELL_PANE)}/watch`;
  // This app has no event stream, so no such stream exists.
  for (const call of [() => client.watchOutput(SHELL_PANE, "s1"), () => client.unwatchOutput(SHELL_PANE, "s1")]) {
    const error = await call().then(() => null, (thrown: Error & { code?: string }) => thrown);
    expect(error?.code).toBe("not_found");
  }
  expect(sent).toEqual([
    { method: "POST", path, type: "application/json", body: { stream: "s1" } },
    { method: "DELETE", path, type: "application/json", body: { stream: "s1" } },
  ]);
  expect(fake.calls()).toEqual([]);
});

test("a request-level server_error keeps herdr's wording; only the latest-line row words it as the server's", () => {
  expect(errorMessage("server_error", "The server hit an unexpected error.", 500)).toBe("herdr said: The server hit an unexpected error. (server_error).");
  expect(errorMessage("herdr_odd", "boom", 502)).toBe("herdr said: boom (herdr_odd).");
  const row = (code: string, message: string) => ({ latest_line_error: { code, message } });
  expect(lineErrorText(row("server_error", "The server hit an unexpected error."))).toBe("Couldn't read its latest line. The server hit an unexpected error.");
  expect(lineErrorText(row("herdr_failed", "boom"))).toBe("Couldn't read its latest line. herdr said: boom (herdr_failed).");
});
