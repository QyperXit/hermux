// The /api/agents list's fixtures: three agents as herdr lists them, and the
// harness audited against the herdr commands the list may run.
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
  { agent: "atomic", pane_id: BLOCKED, agent_status: "blocked", state_change_seq: 10, cwd: "/home/you/weather-app", terminal_title_stripped: "atomic - weather-app" },
  { agent: "pi", pane_id: PANE, agent_status: "working", state_change_seq: 20, cwd: "/home/you/usage-dashboard", terminal_title_stripped: "pi - new next - usage-dashboard" },
  { agent: "atomic", pane_id: CUSTOM, agent_status: "idle", state_change_seq: 30, cwd: "/home/you/hermux", terminal_title_stripped: "atomic - hermux" },
];

export const setup = (config: FakeConfig = { agents: AGENTS }) => makeHarness(config, { allowed: AGENT_LIST_COMMANDS });
