// The rows and sections of the home and All screens, as HTML. Every value
// from the server goes through escapeHtml. No DOM here, so the tests can
// import it.
import { escapeHtml, icon } from "./html.js";
import { calmLine, describe, olderKeyLabel } from "./home.js";
import { STATE_WORDS, describeTerminal, lineErrorHtml, terminalName } from "./terminals.js";

/**
 * @typedef {import("./types.js").Agent} Agent
 * @typedef {import("./types.js").Terminal} Terminal
 * @typedef {import("./home.js").Home} Home
 */

/** @param {unknown} since when the server saw the change, in ms since the epoch */
export function duration(since) {
  if (typeof since !== "number" || !since) return "";
  const minutes = Math.floor((Date.now() - since) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/** @param {string} paneId */
export function terminalHref(paneId) {
  return `#/agent/${encodeURIComponent(paneId)}`;
}

// One agent row: lamp, folder with its session (or pane), a second line, and a
// time only when the server saw the change (`since`). Idle rows show it only
// in Activity, where a just-stopped agent says how long ago it stopped.
/**
 * @param {Agent} agent
 * @param {{ lamp?: string, line?: string, inbox?: boolean, idleTime?: boolean, older?: boolean }} options
 */
export function rowHtml(agent, { lamp = agent.agent_status, line = "", inbox = false, idleTime = false, older = false }) {
  const { folder, session } = describe(agent);
  const time = agent.agent_status === "idle" && !idleTime ? "" : duration(agent.since);
  return `
    <a class="row ${inbox ? "row-inbox" : ""} ${older ? "is-older" : ""}" href="${terminalHref(agent.pane_id)}" data-status="${escapeHtml(lamp)}">
      <span class="lamp" aria-hidden="true"></span>
      <span class="row-text">
        <span class="row-title"><span class="row-folder">${escapeHtml(folder)}</span> <small class="row-tag">${escapeHtml(session ?? agent.pane_id)}</small></span>
        ${line}
      </span>
      ${time ? `<span class="row-time ${inbox ? "is-key" : ""}">${escapeHtml(time)}</span>` : ""}
    </a>`;
}

/** @param {string | null | undefined} text */
export const inboxLine = (text) => (text ? `<span class="row-line">${escapeHtml(text)}</span>` : "");
/** @param {{ latest_line?: string | null }} agent */
export const latestLineHtml = (agent) => (agent.latest_line ? `<span class="row-tick">${escapeHtml(agent.latest_line)}</span>` : "");

/**
 * @param {string} title
 * @param {string[]} rows
 * @param {{ count?: boolean }} [options]
 */
export function sectionHtml(title, rows, { count = true } = {}) {
  return `
    <section class="section" aria-label="${title}">
      <h2 class="section-title"><span>${title}</span>${count ? `<span class="count">${rows.length}</span>` : ""}</h2>
      <div class="section-body">${rows.join("")}</div>
    </section>`;
}

// A working or unclear agent's line stays in mono on one line; a stopped
// agent's line is quieter, on up to two lines. The rows from the first older
// one down sit under an "Older" label, and older rows fade.
/** @param {Home["activity"]} activity */
export function activityRowsHtml(activity) {
  const firstOlder = activity.findIndex(({ older }) => older);
  return activity.map(({ agent, older }, index) => {
    const active = agent.agent_status === "working" || agent.agent_status === "unknown";
    const line = active ? latestLineHtml(agent) || lineErrorHtml(agent) : agent.latest_line ? `<span class="row-line is-quiet">${escapeHtml(agent.latest_line)}</span>` : lineErrorHtml(agent);
    const fold = index === firstOlder ? `<div class="fold">Older</div>` : "";
    return fold + rowHtml(agent, { line, idleTime: true, older });
  });
}

/** @param {Home} home */
export function homeBodyHtml(home) {
  const inbox = [
    ...home.blocked.map((agent) => rowHtml(agent, { line: inboxLine(agent.latest_line) || lineErrorHtml(agent), inbox: true })),
    ...home.finished.map((agent) =>
      rowHtml(agent, { lamp: "done", line: inboxLine(agent.latest_line ? `Finished: ${agent.latest_line}` : "Finished"), inbox: true }),
    ),
  ];
  return `
    ${inbox.length ? sectionHtml("Inbox", inbox) : `<p class="calm">${calmLine(home)}</p>`}
    ${home.activity.length ? sectionHtml("Activity", activityRowsHtml(home.activity), { count: false }) : ""}
    <div class="all-key-wrap">
      <a class="all-key" href="#/all"><span>${olderKeyLabel(home.olderCount)}</span>${icon("i-chevron")}</a>
    </div>`;
}

// An agent's row on the All screen: its latest line, or why it couldn't be
// read, or its state in words.
/** @param {Agent} agent */
export const allRowHtml = (agent) =>
  rowHtml(agent, { line: latestLineHtml(agent) || lineErrorHtml(agent) || `<span class="row-meta">${escapeHtml(STATE_WORDS[agent.agent_status] ?? agent.agent_status)}</span>` });

// A plain shell's row: the shell glyph where an agent has its lamp, the
// folder and its tab's name (or the pane), and the last thing it printed.
/** @param {Terminal} terminal */
export function shellRowHtml(terminal) {
  const { folder } = describeTerminal(terminal);
  const name = terminalName(terminal);
  const line = terminal.latest_line ? `<span class="row-tick">${escapeHtml(terminal.latest_line)}</span>` : lineErrorHtml(terminal) || `<span class="row-meta">Shell</span>`;
  return `
    <a class="row row-shell" href="${terminalHref(terminal.pane_id)}">
      ${icon("i-shell", " shell-glyph")}
      <span class="row-text">
        <span class="visually-hidden">Shell. </span>
        <span class="row-title"><span class="row-folder">${escapeHtml(folder)}</span> <small class="row-tag">${escapeHtml(name === terminal.kind ? terminal.pane_id : name)}</small></span>
        ${line}
      </span>
    </a>`;
}
