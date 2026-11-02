// The /api/agents list's fixtures: three agents and their tabs as herdr lists
// them, and the harness audited against the herdr commands the list may run.
import { resolve } from "node:path";
import type { FakeConfig } from "../fake-herdr";
import { AGENT_LIST_COMMANDS, makeHarness } from "./http";

export const WEB = resolve(import.meta.dir, "../../web");
// PANE hosts a herdr built-in kind (pi); CUSTOM and BLOCKED host `atomic`, like
// Atomic's agents.
export const PANE = "w9:pD";
export const CUSTOM = "w9:pE";
export const BLOCKED = "w8:p1";
export const AGENTS = [
  { agent: "atomic", pane_id: BLOCKED, tab_id: "w8:t3", agent_status: "blocked", state_change_seq: 10, cwd: "/home/you/weather-app", terminal_title_stripped: "atomic - weather-app" },
  { agent: "pi", pane_id: PANE, tab_id: "w9:tD", agent_status: "working", state_change_seq: 20, cwd: "/home/you/usage-dashboard", terminal_title_stripped: "pi - new next - usage-dashboard" },
  { agent: "atomic", pane_id: CUSTOM, tab_id: "w9:tE", agent_status: "idle", state_change_seq: 30, cwd: "/home/you/hermux", terminal_title_stripped: "atomic - hermux" },
];
// herdr names an unlabelled tab by its place in the workspace ("2"), which
// can differ from its number (3) once a tab before it has closed.
export const TABS = [
  { tab_id: "w8:t3", workspace_id: "w8", label: "2", number: 3, agent_status: "blocked", focused: false, pane_count: 1 },
  { tab_id: "w9:tD", workspace_id: "w9", label: "next work", number: 13, agent_status: "working", focused: false, pane_count: 1 },
  { tab_id: "w9:tE", workspace_id: "w9", label: "5", number: 14, agent_status: "idle", focused: false, pane_count: 1 },
];

export const setup = (config: FakeConfig = { agents: AGENTS, tabs: TABS }) => makeHarness(config, { allowed: AGENT_LIST_COMMANDS });
