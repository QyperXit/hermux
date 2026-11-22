import { movesTo } from "./agent-question.js";
import { AGENT_RULE, FOOTER, PROMPT, RUN_LIST_MORE, focusedRuns } from "./screen.js";

/**
 * @typedef {import("./screen.js").Screen} Screen
 * @typedef {{ cursor: boolean, nested: boolean, mark: string, name: string, task: string | null, state: string | null }} PanelRow
 * @typedef {{ focused: boolean, rows: PanelRow[] }} AgentPanel
 * @typedef {{ name: string, task: string | null, state: string | null }} ShownAgent
 * @typedef {{ name: string | null, task: string | null, question: string | null }} Waiting
 */

// Atomic 0.10's agent panel: one row per agent, "  ● main" first, then
// "  ◆ asker  ‹model›  ‹its task›  needs input · 12s" (no model column on a
// narrow pane), a subagent's shells indented under it ("    ⧗ shell  sleep 200
// 10s"); "∀ " before the selected row while the panel is focused. ◆ waits
// for an answer, ◯ runs (main's ◯ while a subagent is shown), ● is the one on
// screen or done, ‖ paused, ◌ waiting on a call, ✗ failed.
const PANEL_ROW = /^(∀ | {2})( {2})?([^\s\w]) (\S+)(?: {2,}(\S.*?))?\s*$/u;
const WAITS = "◆";
// The footer counts subagents waiting: "esc to pause · ↓ 2 agents · 1 needs input
// · ? keys" (0.9.90's count of runs had no "↓ N agents").
const NEEDS_INPUT = / · ↓ \d+ agents? · (\d+) needs input\b/;
// /tasks, drawn on its ▔ edge in the prompt box's place: " Tasks  1 needs
// input · 1 working · …" on top, a waiting row " ❯ ◆ asker  …".
const TASKS_TITLE = /^ Tasks {2}\S/;
const TASKS_WAITING = /^ [❯ ] ◆ (\S+)/;
// A subagent's call in the main chat while it waits: " ! Agent(asker · ‹task›)"
// over "   ⎿  Needs input · ‹its question›".
const AGENT_CALL = /^ ! Agent\((\S+) · /;
const NEEDS_INPUT_ROW = /^ {3}⎿ {2}Needs input · (\S.*?)\s*$/;
const LIST_CLOSED = "Atomic's list of agents changed while moving to that agent. Check the screen and try again.";
const DRAFT = "Atomic's prompt has a draft in it, so the arrow keys won't reach its list of agents. Send or clear it first.";
// The prompt with nothing typed: empty, or a placeholder naming the subagent on screen.
const EMPTY_PROMPT = /^\s*❯\s*(?:(?:Message|Answer) @\S+…|Message @\S+ to wake it…|Paused · send to continue|Stopped · send to resume)?\s*$/;

/**
 * @param {string} text
 * @returns {PanelRow | null}
 */
function panelRow(text) {
  if (RUN_LIST_MORE.test(text)) return null;
  const row = PANEL_ROW.exec(text);
  if (!row) return null;
  const [, cursor, nested, mark, name, rest] = row;
  const columns = rest ? rest.split(/ {2,}/) : [];
  return {
    cursor: cursor === "∀ ",
    nested: Boolean(nested),
    mark,
    name,
    task: columns.length >= 2 ? columns[columns.length - 2] : null,
    state: columns.length ? columns[columns.length - 1] : null,
  };
}

/** @param {string[]} texts */
function panelOf(texts) {
  const rows = texts.flatMap((text) => panelRow(text) ?? []);
  return rows.some((row) => row.name === "main" && !row.nested) ? rows : null;
}

/**
 * @param {Screen} screen
 * @returns {number}
 */
const footerAt = ({ rows }) => rows.reduce((found, row, i) => (row.chrome && FOOTER.test(row.text) ? i : found), -1);

// Atomic 0.10's agent panel: focused in the prompt box's place, or under the
// footer. Null when the screen shows none (an older Atomic's list of runs
// has no main row).
/**
 * @param {Screen} screen
 * @returns {AgentPanel | null}
 */
export function agentPanel(screen) {
  const focused = focusedRuns(screen);
  if (focused) {
    const rows = panelOf(focused);
    return rows && { focused: true, rows };
  }
  const footer = footerAt(screen);
  if (footer < 0) return null;
  const rows = panelOf(screen.rows.slice(footer + 1).map((row) => row.text));
  return rows && { focused: false, rows };
}

/** @param {PanelRow} row */
const waits = (row) => !row.nested && row.mark === WAITS;

// The subagent on the main screen, named by the prompt box's top rule
// ("asker · ‹task› · needs input"); null while it is main's.
/**
 * @param {Screen} screen
 * @returns {ShownAgent | null}
 */
export function shownAgent({ rows }) {
  const at = rows.findIndex((row, i) => row.chrome && AGENT_RULE.test(row.text) && PROMPT.test(rows[i + 1]?.text ?? ""));
  const rule = at < 0 ? null : AGENT_RULE.exec(rows[at].text);
  if (!rule) return null;
  const [, name, rest] = rule;
  const parts = rest.split(" · ");
  const panel = rows.slice(at).flatMap((row) => (row.chrome ? (panelRow(row.text) ?? []) : []));
  const listed = panel.filter((row) => !row.nested && row.name === name);
  if (listed.length === 1 && listed[0].state) return { name, task: listed[0].task ?? parts[0], state: listed[0].state };
  return { name, task: parts[0], state: parts.length > 1 ? parts[parts.length - 1] : null };
}

/**
 * @param {Screen} screen
 * @param {string} name
 */
function questionOf({ rows }, name) {
  let question = null;
  rows.forEach((row, i) => {
    const call = AGENT_CALL.exec(row.text);
    const asks = call && call[1] === name ? NEEDS_INPUT_ROW.exec(rows[i + 1]?.text ?? "") : null;
    if (asks) question = asks[1];
  });
  return question;
}

// A subagent waiting for an answer, as Atomic 0.10 shows it: the first ◆ row
// of its agent panel or of /tasks, or failing those only the footer's count
// (no name). Its question when the main chat shows it. Null when none waits.
/**
 * @param {Screen} screen
 * @returns {Waiting | null}
 */
export function waitingSubagent(screen) {
  const row = agentPanel(screen)?.rows.find(waits);
  if (row) return { name: row.name, task: row.task, question: questionOf(screen, row.name) };
  const tasks = screen.list && TASKS_TITLE.test(screen.rows[screen.list.start]?.text ?? "") ? screen.rows.slice(screen.list.start, screen.list.end) : [];
  const listed = tasks.map((each) => TASKS_WAITING.exec(each.text)).find(Boolean);
  if (listed) return { name: listed[1], task: null, question: questionOf(screen, listed[1]) };
  const footer = footerAt(screen);
  const count = footer < 0 ? null : NEEDS_INPUT.exec(screen.rows[footer].text);
  return count && Number(count[1]) > 0 ? { name: null, task: null, question: null } : null;
}

// What a waiting subagent's agent says on home and in a notification:
// "asker needs you: Which roof should the shed get?".
/** @param {Waiting} waiting */
export const waitingLine = ({ name, question }) => `${name ?? "A subagent"} needs you${question ? `: ${question}` : ""}`;

/**
 * @param {Screen} screen
 * @returns {"empty" | "draft" | null} the prompt's state, null when it isn't on screen
 */
export function promptState({ rows }) {
  const prompt = rows.find((row, i) => row.chrome && PROMPT.test(row.text) && i > 0 && /[─━═-]/.test(rows[i - 1].text));
  if (!prompt) return null;
  return EMPTY_PROMPT.test(prompt.text) ? "empty" : "draft";
}

/**
 * @typedef {{ sent: "down" | "moves" | "enter" | null, from?: number }} Progress what the steps sent so far
 * @typedef {{ keys: string[], then: Progress } | { done: true } | { wait: true } | { refused: string }} Step
 */

// The next send that brings `target` to the screen, main or the first
// subagent waiting for an answer, chosen from the screen read just before
// it: ↓ from an empty prompt, which focuses the panel; the ↑/↓ presses to
// the row; then ⏎ alone. Each is its own send, since ⏎ sent with the ↓
// that focuses the panel is lost, and each waits until the screen shows the
// one before it took, so nothing is pressed twice. Never Esc, which cancels
// a question. Nothing while a question box takes the arrows or the prompt
// holds a draft.
/**
 * @param {Screen} screen
 * @param {"main" | "waiting"} target
 * @param {Progress} [progress]
 * @returns {Step}
 */
export function stepTowards(screen, target, progress = { sent: null }) {
  const shown = shownAgent(screen);
  const panel = agentPanel(screen);
  const there = target === "main" ? !shown : Boolean(shown && (screen.question || /^needs input\b/.test(shown.state ?? "")));
  if (!panel?.focused) {
    if (there) return { done: true };
    if (progress.sent === "down" || progress.sent === "enter") return { wait: true };
    if (progress.sent === "moves") return { refused: LIST_CLOSED };
    if (screen.question) return { refused: "Answer the question on screen first: the arrow keys move its cursor." };
    const prompt = promptState(screen);
    if (prompt === "draft") return { refused: DRAFT };
    if (prompt === null || !panel) return { refused: "Atomic's list of agents isn't on screen." };
    return { keys: ["down"], then: { sent: "down" } };
  }
  if (progress.sent === "enter") return { wait: true };
  const from = panel.rows.findIndex((row) => row.cursor);
  if (progress.sent === "moves" && from === progress.from) return { wait: true };
  const to = panel.rows.findIndex((row) => !row.nested && (target === "main" ? row.name === "main" : row.mark === WAITS));
  if (from < 0 || to < 0) return { refused: "Atomic's list of agents doesn't show that agent." };
  if (from === to) return { keys: ["enter"], then: { sent: "enter" } };
  if (progress.sent === "moves") return { refused: LIST_CLOSED };
  return { keys: movesTo(from, to), then: { sent: "moves", from } };
}
