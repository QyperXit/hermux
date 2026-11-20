import { FOOTER, RUN_LIST_MORE, focusedRuns, promptBoxFree, readScreen } from "./screen.js";

/**
 * @typedef {import("./screen.js").Screen} Screen
 * @typedef {{ name: string, question: string, crowded: boolean } | { name: null, question: null, crowded: boolean }} WorkflowAsk
 */

// Atomic's BACKGROUND panel shows a run with exactly one pending question as
// its id row (？), its name row ("name · single · 0/1 · 9m"), the question
// quoted on one row and "Answer: /workflow connect <full id>", the id wrapped
// onto 6-space rows when the panel is narrow. Otherwise it only counts them in
// its title: "？ ↵ 2 needs attention (attach to workflow with `/workflow connect`)".
const ANSWER_ROW = /^ {5}Answer: \/workflow connect (\S+)$/;
const ID_PART = /^ {6}([0-9a-f-]+)$/;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUOTED_ROW = /^ {5}(".+)$/;
const TITLE = /^BACKGROUND\b/;
const RUNNING = /● (\d+) running/;
const WAITING = /？ ↵ (\d+)/;
const WAITING_RUN = /^ {3}？ /;
const RUN_ROW = /^ {3}(\S) {2}[0-9a-f]{8}-/;
const ENDED = new Set(["✓", "✗"]);
// Atomic 0.9.90 has no BACKGROUND panel: under its footer it lists each run on
// one row, "  ◆ lamp-check  ‹the question, cut with ...›  needs input · 9s" for a
// run waiting on one question, "‹…›  stage select  needs input · 42s" for one
// waiting on several, "  ∀ slow-walk  35s" for one still going. ↓ at the
// prompt moves the list into the prompt box's place, ❯ before its selected
// row; it then takes every key, F2 too, until Esc or ←, and ⏎ opens the
// selected run's graph.
const RUN_LIST_RUN = /^(?:❯ | {2})(\S) (\S+)(?: {2,}(\S.*?))? {2,}(\S.*)$/;
const RUN_LIST_WAITING = /^needs input\b/;
const RUN_LIST_STAGE = /^stage \S+$/;

/**
 * @param {string[]} lines
 * @param {number} at
 */
function runIdAt(lines, at) {
  let id = ANSWER_ROW.exec(lines[at])?.[1] ?? "";
  for (let next = at + 1; next < lines.length; next++) {
    const part = ID_PART.exec(lines[next]);
    if (!part) break;
    id += part[1];
  }
  return id;
}

// What the panel says a workflow is waiting for: one question, with its
// workflow's name, or only that something needs attention. `crowded` when
// more than one run hasn't ended, so Atomic's F2, which opens the newest of
// those, may open another one: the title's "● N running" counts waiting runs
// too, and the visible run rows are counted beside it. A panel scrolled past
// its title may hide runs, so it gives only general guidance, crowded.
// Without a panel it reads Atomic 0.9.90's list of runs instead. Null when
// nothing shown is waiting.
/**
 * @param {Screen} screen
 * @returns {WorkflowAsk | null}
 */
export function workflowAsk(screen) {
  if (!screen.panel) return runListAsk(screen);
  const lines = screen.panel.lines;
  const answers = lines.flatMap((line, at) => (ANSWER_ROW.test(line) ? [at] : []));
  const title = lines.length && TITLE.test(lines[0]) ? lines[0] : null;
  const waiting = title ? WAITING.exec(title) : null;
  if (!answers.length && !waiting && !lines.some((line) => WAITING_RUN.test(line))) return null;
  if (!title) return { name: null, question: null, crowded: true };
  const unended = lines.filter((line) => {
    const glyph = RUN_ROW.exec(line)?.[1];
    return glyph !== undefined && !ENDED.has(glyph);
  });
  const crowded = Math.max(Number(RUNNING.exec(title)?.[1] ?? 0), unended.length) > 1;
  if (answers.length === 1 && (!waiting || waiting[1] === "1")) {
    const at = answers[0];
    const question = QUOTED_ROW.exec(lines[at - 1] ?? "")?.[1];
    const name = lines[at - 2]?.trim().split(" · ")[0];
    if (RUN_ID.test(runIdAt(lines, at)) && question && name) return { name, question, crowded };
  }
  return { name: null, question: null, crowded };
}

// The same from Atomic 0.9.90's rows under its footer, or its focused list:
// one question when exactly one run waits on exactly one. `crowded` under the
// footer when more than one run hasn't ended; on the focused list, where the
// card's F2 moves to the first run waiting, when not exactly one run waits or
// the list hides runs out of view.
/**
 * @param {Screen} screen
 * @returns {WorkflowAsk | null}
 */
function runListAsk(screen) {
  const focused = focusedRuns(screen);
  const rows = focused ?? rowsUnderFooter(screen);
  if (!rows) return null;
  const runs = rows.flatMap((text) => runListRun(text) ?? []);
  const waiting = runs.filter(isWaiting);
  if (!waiting.length) return null;
  const crowded = focused ? waiting.length !== 1 || focused.some((text) => RUN_LIST_MORE.test(text)) : runs.filter((run) => !ENDED.has(run.glyph)).length > 1;
  const [only] = waiting;
  if (waiting.length === 1 && only.text && !RUN_LIST_STAGE.test(only.text)) return { name: only.name, question: only.text, crowded };
  return { name: null, question: null, crowded };
}

/**
 * @param {Screen} screen
 * @returns {string[] | null}
 */
function rowsUnderFooter(screen) {
  const { rows } = screen;
  const footer = rows.reduce((found, row, i) => (row.chrome && FOOTER.test(row.text) ? i : found), -1);
  return footer < 0 ? null : rows.slice(footer + 1).map((row) => row.text);
}

/** @param {string} text */
function runListRun(text) {
  const match = RUN_LIST_RUN.exec(text);
  return match ? { glyph: match[1], name: match[2], text: match[3] ?? "", status: match[4] } : null;
}

/** @param {{ glyph: string, status: string } | null} run */
const isWaiting = (run) => run?.glyph === "◆" && RUN_LIST_WAITING.test(run.status);

/**
 * @param {number} from
 * @param {number} to
 */
const movesTo = (from, to) => [...Array.from({ length: Math.abs(to - from) }, () => (to > from ? "down" : "up")), "enter"];

// The card shows when the block is a workflow's: Atomic's prompt box free on
// the screen (no question of the screen's own) or its focused list of runs,
// and the BACKGROUND panel or the list showing a workflow waiting.
/**
 * @param {string | null | undefined} status
 * @param {Screen | null} screen
 * @returns {WorkflowAsk | null}
 */
export const blockedWorkflowAsk = (status, screen) =>
  status === "blocked" && screen && (promptBoxFree(screen) || focusedRuns(screen)) ? workflowAsk(screen) : null;

// Atomic's F2 opens the graph of its newest workflow that hasn't ended.
export const OPEN_KEY = "f2";

// With Atomic 0.9.90's list of runs focused, F2 does nothing (and Esc or ←
// sent with it lose it), so the card's F2 becomes the ↑/↓ presses from the
// selected row to the first run waiting for input, then ⏎. Null when the list
// isn't focused or no run in view waits.
/**
 * @param {Screen} screen
 * @returns {string[] | null}
 */
export function openKeys(screen) {
  const rows = focusedRuns(screen)?.filter((text) => !RUN_LIST_MORE.test(text));
  if (!rows) return null;
  const from = rows.findIndex((text) => text.startsWith("❯ "));
  const to = rows.findIndex((text) => isWaiting(runListRun(text)));
  return from < 0 || to < 0 ? null : movesTo(from, to);
}

// A workflow stage's select takes no digits, so number key N becomes the
// cursor moves from the selected option to the Nth, then Enter. Null when the
// screen shows no such select or it has no Nth option.
/**
 * @param {string} key
 * @param {Screen} screen
 * @returns {string[] | null}
 */
export function choiceKeys(key, screen) {
  const choices = [...screen.options.values()].filter((row) => row.cursorOnly).sort((a, b) => a.index - b.index);
  const target = /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
  const from = choices.findIndex((row) => row.selected);
  if (target < 0 || target >= choices.length || from < 0) return null;
  return movesTo(from, target);
}

// When `key` answers a workflow stage's select on the screen as last read,
// it chooses its keys again from the screen read just before they are sent.
/**
 * @param {string} key
 * @param {Screen | null} screen
 * @returns {((text: string) => string[] | null) | undefined}
 */
export const choiceChooser = (key, screen) => (screen && choiceKeys(key, screen) ? (text) => choiceKeys(key, readScreen(text)) : undefined);

// When the card's F2 meets a focused list of runs on the screen as last read,
// it chooses its keys again from the screen read just before they are sent.
/**
 * @param {Screen | null} screen
 * @returns {((text: string) => string[] | null) | undefined}
 */
export const openChooser = (screen) => (screen && openKeys(screen) ? (text) => openKeys(readScreen(text)) : undefined);
