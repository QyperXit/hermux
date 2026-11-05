/**
 * @typedef {import("../server/terminals").Terminal} Terminal
 */

/**
 * @typedef {{ code: string, message: string }} LineError
 */

/**
 * An agent as `GET /api/agents` lists it: herdr's fields, plus the server's
 * `since` and the latest line it read.
 * @typedef {object} Agent
 * @property {string} pane_id
 * @property {string} agent_status
 * @property {string} [agent]
 * @property {string} cwd
 * @property {string} terminal_title_stripped
 * @property {string} [workspace_id]
 * @property {import("../server/terminals").TerminalTab} [tab]
 * @property {number} [state_change_seq]
 * @property {number} [completion_seq]
 * @property {number} [since]
 * @property {string | null} [latest_line]
 * @property {LineError} [latest_line_error]
 */

/**
 * @typedef {{ id: string | null, label: string | null, terminals: Terminal[] }} Workspace
 */

/**
 * @typedef {{ code: string, message: string }} RequestError
 */

/**
 * @typedef {import("../server/history").HistoryPage} HistoryPage
 */

/**
 * @typedef {import("../server/uploads").Saved} Upload
 */

/**
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
 * @property {(file: Blob, name: string, options?: { signal?: AbortSignal }) => Promise<Upload>} uploadImage
 */

export {};
