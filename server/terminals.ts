import { SHELL, type Agent, type Pane, type Tab, type Workspace } from "./herdr";

export type Terminal = {
  pane_id: string;
  // The agent kind (`agent` in herdr, e.g. "atomic" or "pi"), or "shell". Sends
  // pass it back as `kind`, and it is checked again just before each send.
  kind: string;
  // The agent's status; null for a plain shell.
  status: string | null;
  workspace: { id: string | null; label: string | null };
  tab: TerminalTab;
  cwd: string | null;
  title: string | null;
  // Agents only, as herdr gives them (and `since` as the server saw it).
  state_change_seq?: unknown;
  completion_seq?: unknown;
  since?: unknown;
  latest_line?: string | null;
  latest_line_error?: { code: string; message: string };
};

export type TerminalTab = { id: string | null; label: string | null; number: number | null };

const text = (value: unknown) => (typeof value === "string" ? value : null);

export function tabsOf(tabs: Tab[]) {
  const byId = new Map(tabs.map((tab) => [tab.tab_id, tab]));
  return (tabId: unknown): TerminalTab => {
    const id = text(tabId);
    const tab = id === null ? undefined : byId.get(id);
    return { id, label: text(tab?.label), number: typeof tab?.number === "number" ? tab.number : null };
  };
}

export const kindOf = (agent: unknown) => (agent === undefined ? SHELL : String(agent));

// In herdr's pane order. A pane that herdr lists with an agent is an agent
// even if `agent list` (a separate call) missed it, so it is never offered as
// a shell.
export function toTerminals(panes: Pane[], agents: Agent[], workspaces: Workspace[], tabs: Tab[]): Terminal[] {
  const agentOf = new Map(agents.map((agent) => [agent.pane_id, agent]));
  const workspaceLabel = new Map(workspaces.map((workspace) => [workspace.workspace_id, text(workspace.label)]));
  const tabOf = tabsOf(tabs);
  return panes.map((pane) => {
    const agent = agentOf.get(pane.pane_id);
    const kind = agent?.agent ?? pane.agent;
    const source: Record<string, unknown> = agent ?? pane;
    const workspaceId = text(pane.workspace_id);
    const terminal: Terminal = {
      pane_id: pane.pane_id,
      kind: kindOf(kind),
      status: kind === undefined ? null : text(source.agent_status),
      workspace: { id: workspaceId, label: workspaceId === null ? null : (workspaceLabel.get(workspaceId) ?? null) },
      tab: tabOf(pane.tab_id),
      cwd: text(source.cwd),
      title: text(source.terminal_title_stripped),
    };
    if (agent) {
      for (const field of ["state_change_seq", "completion_seq", "since"] as const) {
        if (agent[field] !== undefined) terminal[field] = agent[field];
      }
    }
    return terminal;
  });
}
