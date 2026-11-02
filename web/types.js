// The shapes the page shares with the server's JSON answers. Types only: the
// typedefs below are read by the type checker (`bun run typecheck`) and no
// code runs here.

/**
 * A terminal as the server lists it (see server/terminals.ts).
 * @typedef {import("../server/terminals").Terminal} Terminal
 */

/**
 * Why a row's latest line couldn't be read.
 * @typedef {{ code: string, message: string }} LineError
 */

/**
 * An agent as `GET /api/agents` lists it: herdr's fields, plus the server's
 * `since` and the latest line it read.
 * @typedef {object} Agent
 * @property {string} pane_id
 * @property {string} agent_status
 * @property {string} [agent] the agent kind, e.g. "atomic"
 * @property {string} cwd
 * @property {string} terminal_title_stripped
 * @property {string} [workspace_id]
 * @property {import("../server/terminals").TerminalTab} [tab] its tab's ID, label and number
 * @property {number} [state_change_seq]
 * @property {number} [completion_seq]
 * @property {number} [since]
 * @property {string | null} [latest_line]
 * @property {LineError} [latest_line_error]
 */

/**
 * The workspace of the open screen's terminal, with its panes.
 * @typedef {{ id: string | null, label: string | null, terminals: Terminal[] }} Workspace
 */

/**
 * A request that failed, as the screen keeps it: the error's code and message.
 * @typedef {{ code: string, message: string }} RequestError
 */

/**
 * What the server answers to a request for earlier messages.
 * @typedef {import("../server/history").HistoryPage} HistoryPage
 */

/**
 * The page's client: the HTTP client, or the sample one under `?demo`.
 * @typedef {object} Client
 * @property {boolean} isSample
 * @property {(linePanes?: string[]) => Promise<Agent[]>} listAgents
 * @property {(linePanes?: string[]) => Promise<Terminal[]>} listTerminals
 * @property {(workspaceId: string) => Promise<{ workspace: { id: string, label: string | null }, terminals: Terminal[] }>} listWorkspaceTerminals
 * @property {(paneId: string) => Promise<string>} readOutput
 * @property {(paneId: string, query?: { before?: number | null, from?: number, limit?: number }) => Promise<HistoryPage>} readHistory
 * @property {(paneId: string, text: string, kind: string) => Promise<void>} sendPrompt
 * @property {(paneId: string, keys: string[], kind: string) => Promise<void>} sendKeys
 * @property {(paneId: string, stream: string) => Promise<void>} watchOutput
 * @property {(paneId: string, stream: string) => Promise<void>} unwatchOutput
 */

export {};
