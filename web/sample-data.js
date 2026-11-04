import { RECENT_IDLE_READS } from "./activity.js";

/**
 * @typedef {import("./types.js").Agent} Agent
 * @typedef {import("./types.js").Terminal} Terminal
 * @typedef {import("./types.js").Client} Client
 */

const MINUTE = 60_000;

const RULE = "─".repeat(120);

/**
 * @param {string} model
 * @param {string} place
 */
function footer(model, place) {
  return [RULE, "❯", RULE, `(anthropic) ${model} • ${place}`].join("\n");
}

/** @type {Record<string, string>} */
const outputs = {
  "w8:p1": [
    "I've rebuilt the release bundle and the signing step passed.",
    "",
    " ✓ ./gradlew bundleRelease   2m 41s",
    " ✓ app/release/app-release.aab   38.2 MB",
    "",
    " ? Release track",
    "   Where should I upload the bundle?",
    "",
    " ❯ 1. Internal testing (Recommended)",
    "      Only your test group gets it. Safe to try the migration first.",
    "   2. Closed testing",
    "      Your beta list of about 40 people.",
    "   3. Production",
    "      Everyone. Not reversible once rolled out.",
    "   4. Type something.",
    "",
    " ↑↓ navigate • enter select • esc cancel",
  ].join("\n"),
  "w9:pD": [
    "Reading src/charts/usage-query.ts",
    "Reading src/charts/usage-query.test.ts",
    "",
    "The weekly chart double-counted sessions that crossed midnight. I changed the query to bucket by session start instead of by event time, and added a test for a session that runs from 23:50 to 00:20.",
    "",
    " $ bun test src/charts",
    "   ✓ usage-query › buckets by session start (4 ms)",
    "   ✓ usage-query › keeps single-day sessions unchanged (1 ms)",
    "   ✓ usage-query › handles a session across midnight (2 ms)",
    "",
    "   14 pass, 0 fail",
    "",
    "Now checking the dashboard renders the same totals as the CSV export…",
    "",
    footer("claude-opus-5-5 high", "~/projects/usage-dashboard (fix/weekly-totals)"),
  ].join("\n"),
  "wF:p1": [
    "Writing web/app.css",
    "Writing web/app.js",
    "",
    "The list screen renders from sample data. Next I'm wiring the agent screen's key bar and the hold-to-send Ctrl+C key.",
    "",
    footer("claude-opus-5-5 high", "~/projects/hermux"),
  ].join("\n"),
  "wA:pN": [
    "Done. Summary of what changed:",
    "",
    " • Notes are now saved as one Markdown file per day under idea/notes/.",
    " • The capture command trims trailing whitespace and keeps your line breaks.",
    " • Added 6 tests; all 31 pass.",
    "",
    "Nothing is committed yet. Say \"commit it\" and I'll write the commit with the usual trailers.",
    "",
    footer("claude-opus-5-5 medium", "~/projects/todo-cli (main)"),
  ].join("\n"),
};

/** @param {string | undefined} folder */
function idleOutput(folder) {
  return ["Ready.", "", footer("claude-opus-5-5 medium", `~/${folder}`)].join("\n");
}

const now = Date.now();

// herdr's state_change_seq is one counter for all agents; completion_seq is the
// seq of an agent's last completion. latest_line is what the server would show.
let seq = 390;

/** @type {Agent[]} */
const agents = [
  { pane_id: "w8:p1", workspace_id: "w8", agent_status: "blocked", state_change_seq: 387, cwd: "/home/you/projects/weather-app", terminal_title_stripped: "atomic - weather-app", since: now - 4 * MINUTE, latest_line: "Everyone. Not reversible once rolled out." },
  { pane_id: "w9:pD", workspace_id: "w9", agent_status: "working", state_change_seq: 380, cwd: "/home/you/projects/usage-dashboard", terminal_title_stripped: "atomic - new next - usage-dashboard", since: now - 7 * MINUTE, latest_line: "Now checking the dashboard renders the same totals as the CSV export…" },
  { pane_id: "wF:p1", workspace_id: "wF", agent_status: "working", state_change_seq: 389, cwd: "/home/you/projects/hermux", terminal_title_stripped: "atomic - hermux", since: now - 1 * MINUTE, latest_line: "The list screen renders from sample data. Next I'm wiring the agent screen's key bar and the hold-to-send Ctrl+C key." },
  { pane_id: "wA:pN", workspace_id: "wA", agent_status: "done", state_change_seq: 384, completion_seq: 384, cwd: "/home/you/projects/todo-cli", terminal_title_stripped: "atomic - todo-cli", since: now - 22 * MINUTE, latest_line: "Nothing is committed yet. Say \"commit it\" and I'll write the commit with the usual trailers." },
  ...[
    ["w9:pE", "/home/you/projects/usage-dashboard", "atomic - usage-dashboard"],
    ["w9:pF", "/home/you/projects/usage-dashboard", "atomic - New agent - usage-dashboard"],
    ["w9:pG", "/home/you/projects/usage-dashboard", "atomic - usage-dashboard"],
    ["wA:pA", "/home/you/projects/todo-cli", "atomic - todo-cli"],
    ["wA:pE", "/home/you/projects/todo-cli", "atomic - todo-cli"],
    ["wA:pF", "/home/you/projects/todo-cli", "atomic - todo-cli"],
    ["wA:pH", "/home/you/projects/todo-cli/idea", "atomic - idea"],
    ["wA:pM", "/home/you/projects/todo-cli/idea", "atomic - idea"],
    ["wB:p1", "/home/you/projects/recipe-book", "atomic - recipe-book"],
    ["wD:p1", "/home/you/projects/budget-tracker", "atomic - budget-tracker"],
    ["wE:p1", "/home/you/projects/portfolio-site", "atomic - portfolio-site"],
    ["wA:pG", "/home/you/projects/todo-cli", "atomic - todo-cli"],
    ["wA:pK", "/home/you/projects/todo-cli", "atomic - todo-cli"],
  ].map(([pane_id, cwd, terminal_title_stripped], i) => ({
    pane_id,
    workspace_id: pane_id.split(":")[0],
    agent_status: "idle",
    state_change_seq: 120 - i * 9,
    ...(i % 4 === 1 ? { completion_seq: 120 - i * 9 } : {}),
    ...(i < RECENT_IDLE_READS ? { latest_line: "Ready." } : {}),
    cwd,
    terminal_title_stripped,
  })),
];

/** @type {Record<string, string>} */
const WORKSPACES = { w8: "weather-app", w9: "usage-dashboard", wA: "todo-cli", wB: "recipe-book", wD: "budget-tracker", wE: "portfolio-site", wF: "hermux" };
/** @type {Record<string, [label: string, number: number]>} */
const TABS = {
  "w8:p1": ["release", 1],
  "w9:pD": ["new next", 13],
  "w9:pE": ["review", 14],
  "w9:pF": ["New agent", 15],
  "w9:pG": ["3", 16],
  "wA:pA": ["docs", 10],
  "wA:pE": ["2", 14],
  "wA:pF": ["questions", 15],
  "wA:pG": ["chat", 16],
  "wA:pH": ["idea", 17],
  "wA:pK": ["5", 19],
  "wA:pM": ["notes", 20],
  "wA:pN": ["7", 21],
  "wF:p1": ["Atomic", 1],
  "wF:pM": ["term", 20],
  "w9:pA": ["dev server", 10],
  "w9:p9": ["tests", 9],
  "wA:p5": ["qly", 5],
};
/** @param {string} paneId @returns {Terminal["tab"]} */
function tabOf(paneId) {
  const [label, number] = TABS[paneId] ?? ["1", 1];
  return { id: paneId.replace(":p", ":t"), label, number };
}

/** @param {string} folder */
const shellPrompt = (folder) => `you@laptop:~/${folder}$`;

const shells = [
  ["wF:pM", "projects/hermux", "Agents server listening on http://127.0.0.1:8787"],
  ["w9:pA", "projects/usage-dashboard", "ready - started server on http://localhost:3000"],
  ["w9:p9", "projects/usage-dashboard", "✓ 214 passed"],
  ["wA:p5", "projects/todo-cli", shellPrompt("projects/todo-cli")],
].map(([pane_id, path, line]) => ({ pane_id, workspace_id: pane_id.split(":")[0], cwd: `/home/you/${path}`, line }));

/** @typedef {(typeof shells)[number]} Shell */

/** @param {Shell} shell */
const shellOutput = (shell) => [shell.line, "", shellPrompt(shell.cwd.replace("/home/you/", ""))].join("\n");
/** @type {Record<string, string>} */
const shellOutputs = {};

/** @param {number} ms */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class HerdrError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** @param {string} paneId */
function findAgent(paneId) {
  const agent = agents.find((candidate) => candidate.pane_id === paneId);
  if (!agent) throw new HerdrError("agent_not_found", "That agent has gone. It may have exited.");
  return agent;
}

/** @param {string} paneId */
function findShell(paneId) {
  return shells.find((candidate) => candidate.pane_id === paneId);
}

/**
 * @param {Agent} agent
 * @param {string} status
 */
function setStatus(agent, status) {
  agent.agent_status = status;
  agent.state_change_seq = ++seq;
  if (status === "done") agent.completion_seq = seq;
  if (status === "working") delete agent.completion_seq;
  agent.since = Date.now();
}

/**
 * @param {string} paneId
 * @param {string} text
 */
function appendOutput(paneId, text) {
  const current = outputs[paneId] ?? idleOutput(findAgent(paneId).cwd.split("/").pop());
  const body = current.split(`\n${RULE}\n❯`)[0];
  const tail = current.slice(body.length);
  outputs[paneId] = `${body}\n${text}${tail}`;
  const lastLine = text.split("\n").filter((line) => line.trim()).pop();
  if (lastLine) findAgent(paneId).latest_line = lastLine.trim();
}

/** @param {string | undefined} workspaceId */
const workspaceLabel = (workspaceId) => (workspaceId === undefined ? null : WORKSPACES[workspaceId]);

/** @returns {Terminal[]} */
function sampleTerminals() {
  /** @param {string} cwd */
  const folderOf = (cwd) => cwd.split("/").pop() ?? cwd;
  const agentTerminals = agents.map((agent) => ({
    pane_id: agent.pane_id,
    kind: "atomic",
    status: agent.agent_status,
    workspace: { id: agent.workspace_id ?? null, label: workspaceLabel(agent.workspace_id) },
    tab: tabOf(agent.pane_id),
    cwd: agent.cwd,
    title: agent.terminal_title_stripped,
    state_change_seq: agent.state_change_seq,
    ...(agent.completion_seq !== undefined ? { completion_seq: agent.completion_seq } : {}),
    ...(agent.since !== undefined ? { since: agent.since } : {}),
    ...("latest_line" in agent ? { latest_line: agent.latest_line } : {}),
  }));
  const shellTerminals = shells.map((shell) => ({
    pane_id: shell.pane_id,
    kind: "shell",
    status: null,
    workspace: { id: shell.workspace_id, label: WORKSPACES[shell.workspace_id] },
    tab: tabOf(shell.pane_id),
    cwd: shell.cwd,
    title: shellPrompt(folderOf(shell.cwd)),
    latest_line: shellLastLine(shell),
  }));
  return [...agentTerminals, ...shellTerminals];
}

/** @param {Shell} shell */
function shellLastLine(shell) {
  const text = shellOutputs[shell.pane_id] ?? shellOutput(shell);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  let last = lines.length - 1;
  while (last >= 0 && lines[last].endsWith("$")) last--;
  return last >= 0 ? lines[last] : lines.pop();
}

/**
 * @param {Shell} shell
 * @param {string} text
 */
function typeInShell(shell, text) {
  const prompt = shellPrompt(shell.cwd.replace("/home/you/", ""));
  const current = shellOutputs[shell.pane_id] ?? shellOutput(shell);
  shellOutputs[shell.pane_id] = `${current.slice(0, current.lastIndexOf(prompt))}${prompt} ${text}\n${prompt}`;
}

/** @returns {Client} */
export function createSampleClient() {
  return {
    isSample: true,

    async listAgents() {
      await pause(120);
      return agents.map((agent) => ({ agent: "atomic", ...agent, tab: tabOf(agent.pane_id) }));
    },

    async listTerminals() {
      await pause(120);
      return sampleTerminals();
    },

    async listWorkspaceTerminals(workspaceId) {
      await pause(120);
      const terminals = sampleTerminals().filter((terminal) => terminal.workspace.id === workspaceId);
      if (!terminals.length) throw new HerdrError("workspace_not_found", "That workspace has gone.");
      return {
        workspace: { id: workspaceId, label: WORKSPACES[workspaceId] },
        terminals: terminals.map((terminal) => ({ latest_line: "Ready.", ...terminal })),
      };
    },

    async readOutput(paneId) {
      await pause(80);
      const shell = findShell(paneId);
      if (shell) return shellOutputs[paneId] ?? shellOutput(shell);
      const agent = findAgent(paneId);
      return outputs[paneId] ?? idleOutput(agent.cwd.split("/").pop());
    },

    async readHistory() {
      await pause(80);
      return { history: null, reason: "unavailable" };
    },

    async sendPrompt(paneId, text) {
      await pause(250);
      const shell = findShell(paneId);
      if (shell) return typeInShell(shell, text);
      const agent = findAgent(paneId);
      if (agent.agent_status === "blocked") {
        throw new HerdrError("agent_blocked", "It's waiting on a question. Answer it with the keys.");
      }
      appendOutput(paneId, `❯ ${text}`);
      setStatus(agent, "working");
      setTimeout(() => {
        appendOutput(paneId, "Understood. Working on it now.");
        setStatus(agent, "done");
      }, 5000);
    },

    async sendKeys(paneId, keys) {
      await pause(150);
      if (findShell(paneId)) return;
      const agent = findAgent(paneId);
      if (agent.agent_status === "blocked" && keys.includes("enter")) {
        appendOutput(paneId, "\nUploading to the internal testing track…");
        setStatus(agent, "working");
      }
      if (keys.includes("ctrl+c") && agent.agent_status === "working") {
        appendOutput(paneId, "\nInterrupted.");
        setStatus(agent, "idle");
      }
    },

    // The sample data has no event stream, so nothing is ever watched.
    async watchOutput() {},
    async unwatchOutput() {},
  };
}
