import { allAgents, summaryLine } from "./home.js";
import { escapeHtml, icon } from "./html.js";
import { allRowHtml, homeBodyHtml, sectionHtml, shellRowHtml } from "./rows.js";
import { allCountLine, retryingText, shellTerminals } from "./terminals.js";

/**
 * @typedef {import("./session.js").Snapshot} Snapshot
 * @typedef {import("./home.js").Home} Home
 */

/** @param {Snapshot} view */
function emptyListHtml(view) {
  if (!view.loaded && !view.listError) return `<p class="empty">Looking for agents…</p>`;
  if (view.agents.length) return "";
  return view.listError
    ? `<p class="empty">No agent list yet. This page retries every few seconds.</p>`
    : `<p class="empty">No agents are running. Start one in Herdr on the laptop and it shows up here.</p>`;
}

export const FRESHNESS_SLOT = `<span class="freshness"></span>`;

/**
 * @param {{ view: Snapshot, home: Home, freshness: string, keys: string }} screen
 */
export function homeScreenHtml({ view, home, freshness, keys }) {
  const anyBlocked = view.agents.some((agent) => agent.agent_status === "blocked");
  return `
    <header class="masthead">
      <div class="masthead-row">
        <span class="lamp lamp-master" data-status="${anyBlocked ? "blocked" : "idle"}" aria-hidden="true"></span>
        <h1 class="masthead-title">Agents</h1>
        ${freshness}
        ${keys}
      </div>
      <p class="summary">${view.loaded ? summaryLine(home) : "&nbsp;"}</p>
    </header>
    <div class="list ${view.listError && view.agents.length ? "is-stale" : ""}">${emptyListHtml(view) || homeBodyHtml(home)}</div>`;
}

/**
 * @param {{ view: Snapshot, keys: string }} screen
 */
export function allScreenHtml({ view, keys }) {
  const rows = allAgents(view.agents).map(allRowHtml);
  const shells = shellTerminals(view.terminals).map(shellRowHtml);
  const body = shells.length ? sectionHtml("Agents", rows) + sectionHtml("Shells", shells) : `<div class="section-body">${rows.join("")}</div>`;
  const count = view.terminalsLoaded ? allCountLine(view.agents.length, shells.length) : `${view.agents.length} agents · newest activity first`;
  return `
    <header class="bar">
      <a class="back" href="#/" aria-label="Back to agents">${icon("i-back")}</a>
      <div class="identity">
        <h1 class="identity-folder">All terminals</h1>
        <p class="identity-meta">${view.listError ? escapeHtml(retryingText(view.listError)) : view.loaded ? count : "&nbsp;"}</p>
      </div>
      <div class="bar-keys">${keys}</div>
    </header>
    <div class="list ${view.listError && view.agents.length ? "is-stale" : ""}">${emptyListHtml(view) || body}</div>`;
}
