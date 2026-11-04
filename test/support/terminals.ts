import type { FakeAgent, FakeConfig } from "../fake-herdr";
import { makeHarness } from "./http";
import { FOOTER } from "./screens";

// w9 runs a custom-kind agent (atomic), a built-in one (pi) and a plain shell;
// wF runs a blocked atomic agent and the shell with the server script.
export const ATOMIC = "w9:pD";
export const PI = "w9:pE";
export const SHELL_PANE = "w9:p2";
export const BLOCKED_ATOMIC = "wF:p1";
export const SERVER_SHELL = "wF:pM";
export const pane = (id: string, workspace: string, tab: string) => ({
  pane_id: id,
  workspace_id: workspace,
  tab_id: tab,
  focused: false,
  revision: 1,
  scroll: { max_offset_from_bottom: 0, offset_from_bottom: 0, viewport_rows: 64 },
  terminal_id: `term_${id}`,
});
export const AGENTS: FakeAgent[] = [
  { ...pane(ATOMIC, "w9", "w9:tD"), agent: "atomic", agent_status: "idle", state_change_seq: 30, completion_seq: 29, cwd: "/home/you/usage-dashboard", foreground_cwd: "/home/you/usage-dashboard", terminal_title: "atomic - next work - usage-dashboard", terminal_title_stripped: "atomic - next work - usage-dashboard" },
  { ...pane(PI, "w9", "w9:tE"), agent: "pi", agent_status: "working", state_change_seq: 40, cwd: "/home/you/usage-dashboard", terminal_title_stripped: "pi - usage-dashboard" },
  { ...pane(BLOCKED_ATOMIC, "wF", "wF:t1"), agent: "atomic", agent_status: "blocked", state_change_seq: 7, cwd: "/home/you/hermux", terminal_title_stripped: "atomic - hermux" },
];
export const SHELLS = [
  { ...pane(SHELL_PANE, "w9", "w9:t2"), cwd: "/home/you/usage-dashboard", foreground_cwd: "/home/you/usage-dashboard", terminal_title: "you@laptop:~/usage-dashboard", terminal_title_stripped: "you@laptop:~/usage-dashboard" },
  { ...pane(SERVER_SHELL, "wF", "wF:tM"), cwd: "/home/you/hermux", terminal_title_stripped: "bun server/main.ts" },
];
const WORKSPACES = [
  { workspace_id: "w9", label: "usage-dashboard", number: 1, active_tab_id: "w9:tD", agent_status: "working", focused: false, pane_count: 3, tab_count: 3 },
  { workspace_id: "wF", label: "hermux", number: 2, active_tab_id: "wF:t1", agent_status: "blocked", focused: true, pane_count: 2, tab_count: 2 },
];
const TABS = [
  { tab_id: "w9:t2", workspace_id: "w9", label: "1", number: 1, agent_status: "unknown", focused: false, pane_count: 1 },
  { tab_id: "w9:tD", workspace_id: "w9", label: "next work", number: 2, agent_status: "idle", focused: false, pane_count: 1 },
  { tab_id: "w9:tE", workspace_id: "w9", label: "3", number: 3, agent_status: "working", focused: false, pane_count: 1 },
  { tab_id: "wF:t1", workspace_id: "wF", label: "1", number: 1, agent_status: "blocked", focused: true, pane_count: 1 },
  { tab_id: "wF:tM", workspace_id: "wF", label: "server", number: 2, agent_status: "unknown", focused: false, pane_count: 1 },
];
export const OUTPUTS = {
  [ATOMIC]: `Finished the chart fix.${FOOTER}`,
  [PI]: `Running the chart tests${FOOTER}`,
  [BLOCKED_ATOMIC]: `Which port should it use?${FOOTER}`,
  [SHELL_PANE]: "you@laptop:~/usage-dashboard$ ls\nREADME.md  src\nyou@laptop:~/usage-dashboard$   \n\n\n",
  [SERVER_SHELL]: "$ bun server/main.ts\nAgents server listening on http://127.0.0.1:8787\n",
};
export const CONFIG: FakeConfig = { agents: AGENTS, shells: SHELLS, workspaces: WORKSPACES, tabs: TABS, outputs: OUTPUTS };

export const setup = (config: FakeConfig = CONFIG) => makeHarness(config);

export const without = (agentPane: string) => AGENTS.filter((agent) => agent.pane_id !== agentPane);

export const path = (paneId: string, action: string) => `/api/terminals/${encodeURIComponent(paneId)}/${action}`;
// A send names the kind of terminal the client saw as `kind`.
export const prompt = (paneId: string, text: unknown, kind?: unknown) => [path(paneId, "prompt"), { body: kind === undefined ? { text } : { text, kind } }] as const;
export const keys = (paneId: string, list: unknown, kind?: unknown) => [path(paneId, "keys"), { body: kind === undefined ? { keys: list } : { keys: list, kind } }] as const;
