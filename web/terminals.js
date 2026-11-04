import { errorMessage } from "./api.js";
import { describe } from "./home.js";
import { escapeHtml, icon } from "./html.js";

/**
 * @typedef {import("./types.js").Agent} Agent
 * @typedef {import("./types.js").Terminal} Terminal
 * @typedef {import("./types.js").LineError} LineError
 * @typedef {import("./types.js").RequestError} RequestError
 * @typedef {import("./types.js").Workspace} Workspace
 */

const SHELL = "shell";

/** @type {Record<string, string>} */
export const STATE_WORDS = {
  blocked: "Needs you",
  working: "Working",
  done: "Done",
  idle: "Idle",
  unknown: "Unclear",
};

/** @param {{ kind: string }} terminal */
export const isShell = (terminal) => terminal.kind === SHELL;

/**
 * @param {Pick<Agent, "pane_id" | "agent_status"> & Partial<Agent>} agent
 * @returns {Terminal}
 */
export function terminalOfAgent(agent) {
  return {
    pane_id: agent.pane_id,
    kind: agent.agent ?? "agent",
    status: agent.agent_status ?? null,
    workspace: { id: agent.workspace_id ?? null, label: null },
    tab: agent.tab ?? { id: null, label: null, number: null },
    cwd: agent.cwd ?? null,
    title: agent.terminal_title_stripped ?? null,
    ...(agent.state_change_seq !== undefined ? { state_change_seq: agent.state_change_seq } : {}),
    ...(agent.completion_seq !== undefined ? { completion_seq: agent.completion_seq } : {}),
    ...(agent.since !== undefined ? { since: agent.since } : {}),
    ...(agent.latest_line !== undefined ? { latest_line: agent.latest_line } : {}),
    ...(agent.latest_line_error !== undefined ? { latest_line_error: agent.latest_line_error } : {}),
  };
}

/** @param {Pick<Terminal, "pane_id" | "kind" | "cwd" | "title">} terminal */
export function describeTerminal(terminal) {
  const { folder, session } = describe({
    pane_id: terminal.pane_id,
    cwd: terminal.cwd ?? "",
    agent: terminal.kind,
    terminal_title_stripped: terminal.title ?? "",
  });
  return { folder, session: isShell(terminal) ? null : session };
}

// A tab's own name: its label, unless that is only a number. herdr labels an
// unnamed tab with a number (its place in the workspace), so that is no name.
/** @param {Terminal["tab"] | undefined} tab */
function tabName(tab) {
  const label = (tab?.label ?? "").trim();
  return label && !/^\d+$/.test(label) ? label : null;
}

/** @param {Pick<Terminal, "pane_id" | "kind" | "cwd" | "title" | "tab">} terminal */
export function terminalName(terminal) {
  const name = describeTerminal(terminal).session ?? tabName(terminal.tab);
  if (name) return name;
  const label = (terminal.tab?.label ?? "").trim();
  const number = label || terminal.tab?.number;
  return number ? `tab ${number}` : terminal.pane_id;
}

/**
 * @param {HTMLElement} element
 * @param {Pick<Terminal, "pane_id" | "kind" | "cwd" | "title" | "tab">} terminal
 */
export function showTerminalName(element, terminal) {
  element.textContent = terminalName(terminal);
  element.title = terminal.pane_id;
}

/** @param {Pick<Terminal, "pane_id" | "kind" | "cwd" | "title" | "tab">} terminal */
export function sendTarget(terminal) {
  const { folder } = describeTerminal(terminal);
  if (!isShell(terminal)) return folder;
  return tabName(terminal.tab) ?? `${folder} shell`;
}

/** @param {Pick<Terminal, "pane_id" | "kind" | "cwd" | "title" | "tab" | "status">} terminal */
export function kindLine(terminal) {
  /** @type {string[]} */
  const parts = [];
  if (terminalName(terminal) !== terminal.kind) parts.push(terminal.kind);
  if (terminal.status) parts.push(STATE_WORDS[terminal.status] ?? terminal.status);
  return parts.join(" · ");
}

/** @param {number} count */
export const terminalsLabel = (count) => `${count} terminals`;

/** @param {unknown[]} terminals */
export const hasSwitcher = (terminals) => terminals.length > 1;

/**
 * @param {Pick<Workspace, "id" | "label"> | null | undefined} workspace
 * @param {Terminal[]} terminals
 */
export function sheetTitle(workspace, terminals) {
  const label = workspace?.label ?? (terminals[0] ? describeTerminal(terminals[0]).folder : "Workspace");
  return `${label} · ${terminalsLabel(terminals.length)}`;
}

/**
 * One row of the switcher sheet.
 * @typedef {object} SwitcherRow
 * @property {string} pane_id
 * @property {boolean} shell
 * @property {string | null} status
 * @property {string} name
 * @property {string} kind
 * @property {string} line
 * @property {string} error
 * @property {boolean} here
 */

/**
 * @param {Terminal[]} terminals
 * @param {string | undefined} paneId
 * @returns {SwitcherRow[]}
 */
export function switcherRows(terminals, paneId) {
  return terminals.map((terminal) => ({
    pane_id: terminal.pane_id,
    shell: isShell(terminal),
    status: terminal.status,
    name: terminalName(terminal),
    kind: kindLine(terminal),
    line: terminal.latest_line ?? "",
    error: lineErrorText(terminal),
    here: terminal.pane_id === paneId,
  }));
}

/**
 * @param {SwitcherRow[]} rows
 * @param {(paneId: string) => string} hrefFor
 */
export function sheetRowsHtml(rows, hrefFor) {
  return rows
    .map((row) => {
      const mark = row.shell ? icon("i-shell", "shell-glyph") : `<span class="lamp" aria-hidden="true"></span>`;
      const status = row.status ? ` data-status="${escapeHtml(row.status)}"` : "";
      return `<li><a class="pane-row${row.here ? " is-here" : ""}" href="${escapeHtml(hrefFor(row.pane_id))}" data-pane="${escapeHtml(row.pane_id)}"${status}${row.here ? ' aria-current="true"' : ""}>
        ${mark}
        <span class="pane-text">
          <span class="pane-head"><span class="pane-name" title="${escapeHtml(row.pane_id)}">${escapeHtml(row.name)}</span>${row.kind ? ` <small class="pane-kind">${escapeHtml(row.kind)}</small>` : ""}</span>
          ${row.line ? `<span class="pane-line">${escapeHtml(row.line)}</span>` : row.error ? quietLineHtml(row.error) : ""}
        </span>
        ${row.here ? `<span class="pane-end">here</span>` : icon("i-chevron", "pane-end")}
      </a></li>`;
    })
    .join("");
}

/** @param {{ latest_line_error?: LineError }} row */
export function lineErrorText(row) {
  const error = row.latest_line_error;
  if (!error) return "";
  const why = error.code === "server_error" ? "The server hit an unexpected error." : errorMessage(error.code, error.message);
  return `Couldn't read its latest line. ${why}`;
}

/** @param {string} text */
const quietLineHtml = (text) => `<span class="row-meta">${escapeHtml(text)}</span>`;

/** @param {{ latest_line_error?: LineError }} row */
export const lineErrorHtml = (row) => {
  const text = lineErrorText(row);
  return text ? quietLineHtml(text) : "";
};

/** @param {Terminal[]} terminals */
export const shellTerminals = (terminals) => terminals.filter(isShell);

/**
 * @param {number} agents
 * @param {number} shells
 */
export function allCountLine(agents, shells) {
  const parts = [`${agents} agent${agents === 1 ? "" : "s"}`, `${shells} shell${shells === 1 ? "" : "s"}`];
  return `${parts.join(" · ")} · newest first`;
}

const SWIPE_CLOSE_PX = 72;
const FLICK_MIN_PX = 24;
const FLICK_PX_PER_MS = 0.5;

/** @param {{ dy: number, ms: number }} swipe */
export function closesOnSwipe({ dy, ms }) {
  if (dy >= SWIPE_CLOSE_PX) return true;
  return dy >= FLICK_MIN_PX && ms > 0 && dy / ms >= FLICK_PX_PER_MS;
}

/** @param {RequestError} error */
export function retryingText({ code, message }) {
  return `${code === "unreachable" || !message ? "Can't reach the laptop." : message} Retrying…`;
}
