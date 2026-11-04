import { RECENT_IDLE_READS, RECENT_ROWS } from "../web/activity.js";
import { HerdrError, SHELL, type Agent, type Herdr, type Pane, type Tab } from "./herdr";
import { latestLine, shellLatestLine } from "./latest-line";
import { kindOf, tabsOf, toTerminals, type Terminal } from "./terminals";

export const LATEST_LINE_STATUSES = new Set(["blocked", "working", "unknown", "done"]);
export { RECENT_IDLE_READS };
export const NAMED_IDLE_READS = RECENT_ROWS;
const READ_REUSE_MS = 3_000;
const OBSERVED_WITHIN_MS = 10_000;
// Tab labels change rarely, so every list reuses the last `tab list` the
// roster read while it is younger than this, instead of reading it again.
const TABS_REUSE_MS = 10_000;

type LineError = { code: string; message: string };
type LatestLine = { latest_line: string | null; latest_line_error?: LineError };

type AgentState = { status: string; seq: unknown };
type Look = AgentState & { at: number; since?: number };
type Read = { at: number; line: string | null };
type AgentRead = AgentState & Read;

const stateOf = (agent: Agent): AgentState => ({ status: agent.agent_status, seq: agent.state_change_seq });
const sameState = (a: AgentState, b: AgentState) => a.status === b.status && a.seq === b.seq;

function keepListed(memory: Map<string, unknown>, listed: string[]) {
  const panes = new Set(listed);
  for (const paneId of memory.keys()) if (!panes.has(paneId)) memory.delete(paneId);
}

const seqOf = (agent: Agent) => (typeof agent.state_change_seq === "number" ? agent.state_change_seq : -Infinity);

function agentsToRead<T extends Agent>(agents: T[], shownIdlePanes: string[]) {
  const recentIdle = agents
    .filter((agent) => agent.agent_status === "idle")
    .sort((a, b) => seqOf(b) - seqOf(a))
    .slice(0, RECENT_IDLE_READS);
  const names = new Set(shownIdlePanes.slice(0, NAMED_IDLE_READS));
  return agents.filter(
    (agent) =>
      LATEST_LINE_STATUSES.has(agent.agent_status) ||
      recentIdle.includes(agent) ||
      (agent.agent_status === "idle" && names.has(agent.pane_id)),
  );
}

function failedRead(error: unknown): LatestLine {
  if (!(error instanceof HerdrError)) {
    console.error(error);
    return { latest_line: null, latest_line_error: { code: "server_error", message: "The server hit an unexpected error." } };
  }
  if (error.code === "agent_not_found" || error.code === "pane_not_found") return { latest_line: null };
  return { latest_line: null, latest_line_error: { code: error.code, message: error.message } };
}

export function createRoster(herdr: Pick<Herdr, "list" | "panes" | "workspaces" | "tabs" | "read">, now: () => number) {
  const looks = new Map<string, Look>();
  const agentReads = new Map<string, AgentRead>();
  const shellReads = new Map<string, Read>();
  let tabList: { at: number; tabs: Tab[] } | null = null;

  const isFresh = (read: Read) => now() - read.at < READ_REUSE_MS;

  function stamp<T extends Agent>(agent: T): T {
    const at = now();
    const state = stateOf(agent);
    const last = looks.get(agent.pane_id);
    let since: number | undefined;
    if (last) since = sameState(last, state) ? last.since : at - last.at <= OBSERVED_WITHIN_MS ? at : undefined;
    looks.set(agent.pane_id, { ...state, at, since });
    return since === undefined ? agent : { ...agent, since };
  }

  function stampListed(agents: Agent[]) {
    const listed = agents.map((agent) => agent.pane_id);
    keepListed(looks, listed);
    keepListed(agentReads, listed);
    return agents.map(stamp);
  }

  const canReuse = (cached: AgentRead, agent: Agent) => sameState(cached, stateOf(agent)) && (agent.agent_status === "idle" || isFresh(cached));

  async function agentLine(agent: Agent): Promise<LatestLine> {
    const state = stateOf(agent);
    const cached = agentReads.get(agent.pane_id);
    if (cached && canReuse(cached, agent)) return { latest_line: cached.line };
    const at = now();
    try {
      const line = latestLine(await herdr.read(agent.pane_id, kindOf(agent.agent)));
      agentReads.set(agent.pane_id, { ...state, at, line });
      return { latest_line: line };
    } catch (error) {
      agentReads.delete(agent.pane_id);
      return failedRead(error);
    }
  }

  async function shellLine(paneId: string): Promise<LatestLine> {
    const cached = shellReads.get(paneId);
    if (cached && isFresh(cached)) return { latest_line: cached.line };
    const at = now();
    try {
      const line = shellLatestLine(await herdr.read(paneId, SHELL));
      shellReads.set(paneId, { at, line });
      return { latest_line: line };
    } catch (error) {
      shellReads.delete(paneId);
      return failedRead(error);
    }
  }

  async function linesOf(agents: Agent[], shells: string[]) {
    return new Map(
      await Promise.all([
        ...agents.map(async (agent) => [agent.pane_id, await agentLine(agent)] as const),
        ...shells.map(async (paneId) => [paneId, await shellLine(paneId)] as const),
      ]),
    );
  }

  async function recentTabsOrNone(): Promise<Tab[]> {
    if (tabList && now() - tabList.at < TABS_REUSE_MS) return tabList.tabs;
    const at = now();
    try {
      const tabs = await herdr.tabs();
      tabList = { at, tabs };
      return tabs;
    } catch (error) {
      if (!(error instanceof HerdrError)) throw error;
      return [];
    }
  }

  async function listing() {
    const [panes, agents, workspaces, tabs] = await Promise.all([herdr.panes(), herdr.list(), herdr.workspaces(), recentTabsOrNone()]);
    return { panes, agents, workspaces, tabs };
  }

  async function terminalsIn(
    { panes, agents, workspaces, tabs }: Awaited<ReturnType<typeof listing>>,
    inScope: (pane: Pane) => boolean,
    choose: (agents: Agent[]) => Agent[],
  ): Promise<Terminal[]> {
    const stamped = stampListed(agents);
    const all = toTerminals(panes, stamped, workspaces, tabs);
    const shells = all.filter((terminal) => terminal.kind === SHELL).map((terminal) => terminal.pane_id);
    keepListed(shellReads, shells);
    const scope = new Set(panes.filter(inScope).map((pane) => pane.pane_id));
    const lines = await linesOf(
      choose(stamped.filter((agent) => scope.has(agent.pane_id))),
      shells.filter((paneId) => scope.has(paneId)),
    );
    return all.filter((terminal) => scope.has(terminal.pane_id)).map((terminal) => ({ ...terminal, ...lines.get(terminal.pane_id) }));
  }

  return {
    async agents(shownIdlePanes: string[]): Promise<Agent[]> {
      const [listed, tabs] = await Promise.all([herdr.list(), recentTabsOrNone()]);
      const agents = stampListed(listed);
      const tabOf = tabsOf(tabs);
      const lines = await linesOf(agentsToRead(agents, shownIdlePanes), []);
      return agents.map((agent) => ({ ...agent, tab: tabOf(agent.tab_id), ...lines.get(agent.pane_id) }));
    },

    async terminals(shownIdlePanes: string[]): Promise<Terminal[]> {
      return terminalsIn(await listing(), () => true, (agents) => agentsToRead(agents, shownIdlePanes));
    },

    async terminal(paneId: string): Promise<Terminal | null> {
      const { panes, agents, workspaces, tabs } = await listing();
      const terminal = toTerminals(panes, agents, workspaces, tabs).find((candidate) => candidate.pane_id === paneId);
      const agent = agents.find((candidate) => candidate.pane_id === paneId);
      if (!terminal || !agent) return terminal ?? null;
      return { ...terminal, ...(await agentLine(agent)) };
    },

    async workspace(workspaceId: string) {
      const listed = await listing();
      const workspace = listed.workspaces.find((candidate) => candidate.workspace_id === workspaceId);
      if (!workspace) throw new HerdrError("workspace_not_found", `workspace ${workspaceId} not found`);
      const terminals = await terminalsIn(listed, (pane) => pane.workspace_id === workspaceId, (agents) => agents);
      return { workspace: { id: workspace.workspace_id, label: workspace.label ?? null }, terminals };
    },
  };
}
