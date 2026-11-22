import { movesTo } from "./agent-question.js";
import { AGENT_RULE, FOOTER, PROMPT, RUN_LIST_MORE, focusedRuns } from "./screen.js";

/**
 * @typedef {import("./screen.js").Screen} Screen
 * @typedef {{ cursor: boolean, nested: boolean, mark: string, name: string, task: string | null, state: string | null }} PanelRow
 * @typedef {{ focused: boolean, rows: PanelRow[] }} AgentPanel
 * @typedef {{ name: string, task: string | null, state: string | null }} ShownAgent
 * @typedef {{ name: string | null, task: string | null, question: string | null }} Waiting
 * @typedef {{ names: string[] }} Paused
 * @typedef {{ cursor: boolean, mark: string, name: string, task: string | null, state: string | null, at: number }} TaskRow
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
// Main's turn over, "∀ Snorkeled for 1s · ↓ 35 tokens", and its footer at rest
// ("esc to interrupt · …" while it works); with no panel rows left the footer
// ends "· /tasks to see subagents · ? keys".
const ENDED_TURN = /^\s*∀ \p{Lu}[\p{L}'-]* for \d+(?:s|m \d+s|h \d+m)(?: · [↑↓] [\d.]+[kmbtKMB]? tokens)?\s*$/u;
const BUSY_FOOTER = /^\s*esc to /;
const SEE_SUBAGENTS = / · \/tasks to see subagents · \? keys\s*$/;
const PAUSED = /^paused\b/;
const ENDED = /^(?:done|failed|stopped)\b/;
// A /tasks row, " ❯ ‖ asker  ‹model›  ‹task›  paused · 25s", and its title's counts.
const TASKS_ROW = /^ ([❯ ]) (\S) (\S+)(?: {2,}(\S.*?))?\s*$/u;
const TASKS_COUNTS = /^ Tasks {2}(\S.*?)\s*$/;
const TASKS_GONE = "Atomic's /tasks list isn't on screen. Tap Show helpers first.";
const TASKS_CHANGED = "Atomic's /tasks list changed. Check it and tap the helper again.";

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
  const list = tasksList(screen);
  const tasks = list ? screen.rows.slice(list.start, list.end) : [];
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

/** @param {Screen} screen */
const tasksList = ({ rows, list }) => (list && TASKS_TITLE.test(rows[list.start]?.text ?? "") ? list : null);

// The rows of /tasks where Atomic draws it, or null.
/**
 * @param {Screen} screen
 * @returns {TaskRow[] | null}
 */
export function taskRows(screen) {
  const list = tasksList(screen);
  if (!list) return null;
  return screen.rows.slice(list.start, list.end).flatMap((row, i) => {
    const found = TASKS_ROW.exec(row.text);
    if (!found) return [];
    const columns = found[4] ? found[4].split(/ {2,}/) : [];
    return [{ cursor: found[1] === "❯", mark: found[2], name: found[3], task: columns.length >= 2 ? columns[columns.length - 2] : null, state: columns.length > 1 ? columns[columns.length - 1] : null, at: list.start + i }];
  });
}

/** @param {string | null} state a helper row's state column */
export const isPausedState = (state) => PAUSED.test(state ?? "");

/**
 * @param {{ name: string, state: string | null }[]} rows the helpers' rows
 * @returns {Paused | null}
 */
function onlyPaused(rows) {
  const paused = rows.filter((row) => isPausedState(row.state));
  const rest = rows.every((row) => isPausedState(row.state) || ENDED.test(row.state ?? ""));
  return paused.length && rest ? { names: paused.map((row) => row.name) } : null;
}

/** @param {Screen} screen */
const turnEnded = (screen) => ENDED_TURN.test(screen.rows[screen.chromeStart]?.text ?? "");

/** @param {Screen} screen */
function tasksPaused(screen) {
  const list = tasksList(screen);
  const rows = taskRows(screen);
  const counts = list && TASKS_COUNTS.exec(screen.rows[list.start].text);
  if (!rows || !counts) return null;
  const working = counts[1].split(" · ").map((part) => /^(\d+) (.+)$/.exec(part));
  if (working.some((part) => !part || (part[2] !== "working" && part[2] !== "done"))) return null;
  const paused = onlyPaused(rows);
  const count = working.find((part) => part?.[2] === "working");
  return paused && count && Number(count[1]) === paused.names.length ? paused : null;
}

// Main's turn over, its prompt free, no question and no helper waiting, as
// main's own screen shows it (a helper on screen hides main's turn), with
// what is under its footer; null otherwise.
/** @param {Screen} screen */
function mainAtRest(screen) {
  if (screen.question || screen.list || waitingSubagent(screen) || !turnEnded(screen)) return null;
  const footer = footerAt(screen);
  if (footer < 0 || BUSY_FOOTER.test(screen.rows[footer].text) || shownAgent(screen) || promptState(screen) === null) return null;
  return { footer: screen.rows[footer].text, below: screen.rows.slice(footer + 1).map((row) => row.text), panel: agentPanel(screen) };
}

// Helpers Atomic 0.10 paused (Esc on a shown subagent) and nothing else of
// its left at work, as the screen proves it: main at rest with the agent
// panel holding only paused (‖) and finished rows, or /tasks, after main's
// turn, counting only paused helpers as working. Atomic still tells herdr
// it works then. Null in any doubt: a running, waiting or queued row, a
// shell, a row out of view, a question.
/**
 * @param {Screen} screen
 * @returns {Paused | null}
 */
export function pausedHelpers(screen) {
  if (screen.list) return !screen.question && turnEnded(screen) ? tasksPaused(screen) : null;
  const rest = mainAtRest(screen);
  if (!rest?.panel || rest.panel.focused || rest.below.some((text) => RUN_LIST_MORE.test(text)) || rest.panel.rows.some((row) => row.nested)) return null;
  return onlyPaused(rest.panel.rows.filter((row) => row.name !== "main"));
}

// Main at rest with no agent panel and the footer's "/tasks to see
// subagents": Atomic lists a paused helper only while something else is
// active, so a paused one may be what keeps herdr's working, but so may a
// finished helper's own shell, which Atomic lists nowhere. Only Atomic's
// saved session can tell.
/** @param {Screen} screen */
export function mayHidePaused(screen) {
  const rest = mainAtRest(screen);
  return Boolean(rest && !rest.panel && SEE_SUBAGENTS.test(rest.footer) && rest.below.every((text) => !text.trim()));
}

// What a paused helper's agent says on home: "asker is paused · send to continue".
/** @param {Paused} paused */
export const pausedLine = ({ names }) => `${names.length === 1 ? `${names[0]} is` : names.length > 1 ? `${names.length} helpers are` : "A helper is"} paused · send to continue`;

// Show helpers: /tasks typed into Atomic's empty main prompt (a paste runs
// it), done once /tasks is on screen.
/**
 * @param {Screen} screen
 * @returns {{ text: string } | { done: true } | { refused: string }}
 */
export function showHelpersStep(screen) {
  if (taskRows(screen)) return { done: true };
  if (screen.question) return { refused: "Answer the question on screen first." };
  if (shownAgent(screen)) return { refused: "A helper is on Atomic's screen. Tap Back to main first." };
  const prompt = promptState(screen);
  if (prompt === "draft") return { refused: "Atomic's prompt has a draft in it. Send or clear it first." };
  if (prompt === null) return { refused: "Atomic's prompt isn't on screen." };
  return { text: "/tasks" };
}

// The next send that opens the helper on /tasks row `target.row` (counting
// task rows only, as Atomic's ↑/↓ do), chosen from the screen read just
// before it: the ↑/↓ presses to it, then ⏎ alone, each waiting until a fresh
// read shows the last took. Nothing if that row is no longer that paused helper.
/**
 * @param {Screen} screen
 * @param {{ name: string, row: number }} target
 * @param {Progress} [progress]
 * @returns {Step}
 */
export function stepToTask(screen, target, progress = { sent: null }) {
  const rows = taskRows(screen);
  if (!rows) {
    if (progress.sent === "enter") return shownAgent(screen)?.name === target.name ? { done: true } : { wait: true };
    return { refused: progress.sent === "moves" ? TASKS_CHANGED : TASKS_GONE };
  }
  if (progress.sent === "enter") return { wait: true };
  const row = rows[target.row];
  if (!row || row.name !== target.name || !isPausedState(row.state)) return { refused: TASKS_CHANGED };
  const from = rows.findIndex((each) => each.cursor);
  if (from < 0) return { refused: TASKS_CHANGED };
  if (from === target.row) return { keys: ["enter"], then: { sent: "enter" } };
  if (progress.sent === "moves") return from === progress.from ? { wait: true } : { refused: TASKS_CHANGED };
  return { keys: movesTo(from, target.row), then: { sent: "moves", from } };
}

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
