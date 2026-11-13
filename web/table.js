import { escapeHtml } from "./html.js";
import { linkedRunsHtml } from "./links.js";
import { sliceLine, trimEnd, trimStart } from "./screen.js";

/**
 * @typedef {import("./screen.js").Run} Run
 * @typedef {import("./screen.js").Line} Line
 * @typedef {{ label: string | null, html: string }} Field
 * @typedef {{ title: string, fields: Field[] }} StackedRow
 */

/**
 * A field with a label is a `label: text` pair; one without (its header cell is
 * empty, or the header is off screen) is a plain line of its own.
 * @param {Field[]} fields
 */
function fieldsHtml(fields) {
  let html = "";
  let pairs = "";
  for (const { label, html: value } of fields) {
    if (label) {
      pairs += `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`;
      continue;
    }
    if (pairs) html += `<dl class="stacked-fields">${pairs}</dl>`;
    pairs = "";
    html += `<p class="stacked-line">${value}</p>`;
  }
  return pairs ? `${html}<dl class="stacked-fields">${pairs}</dl>` : html;
}

/**
 * @param {StackedRow[]} rows
 * @param {boolean} [continued] the table's header is above what is shown
 */
export function stackedHtml(rows, continued = false) {
  const sections = rows.map(({ title, fields }) => {
    const shown = fields.filter((field) => field.html.trim());
    if (!title.trim() && !shown.length) return "";
    const body = fieldsHtml(shown);
    return `<section class="stacked-row">${title.trim() ? `<strong class="stacked-title">${title}</strong>` : ""}${body}</section>`;
  });
  return `<div class="stacked">${continued ? `<p class="stacked-note">Table continues above</p>` : ""}${sections.join("")}</div>`;
}

// Atomic's box-drawn table: rule rows (┌┬┐, ├┼┤, └┴┘ or the rounded corners)
// whose ┬┼┴ junctions sit over the │ borders of the rows between them. The rows
// between two rules are one table row, each of its lines holding a slice of
// every cell.
const RULE_ROW = /^ *[┌├└╭╰][─┬┼┴]*[┐┤┘╮╯]$/;
const TOP_RULE = /^ *[┌╭]/;
const BOTTOM_RULE = /^ *[└╰]/;
const JUNCTION = /[┬┼┴]/g;
// Atomic cuts a word longer than the cell at the cell's full width and goes on
// with the rest on the next line. A line that fills the cell with one unbroken
// word is only taken as such a cut when it doesn't end in a closing mark and
// what follows could be the rest of the word: a short tail, or any tail when
// the word is a path or address. Otherwise the word was whole and a space
// follows.
const CLOSED_WORD = /[.,;:!?)\]}"'`]$/;
const LONG_WORD = /^(?:https?:\/\/|~?\/)/;
const MAX_TAIL = 3;
const SPACE = { text: " ", cls: "" };

/** @param {string} text */
const bordersOf = (text) => [text.search(/\S/), ...[...text.matchAll(JUNCTION)].map((match) => match.index), text.length - 1];

/**
 * @param {Run[]} runs
 * @returns {Run[]}
 */
function mergedRuns(runs) {
  /** @type {Run[]} */
  const merged = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && last.cls === run.cls) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

/**
 * The lines of one cell: pieces of its text, Atomic's wrap of it.
 * @param {Line[]} slices the cell's slice of each line of the table row
 * @returns {Run[]}
 */
function cellRuns(slices) {
  /** @type {Run[]} */
  const runs = [];
  let cutWordSoFar = "";
  for (const slice of slices) {
    const piece = trimEnd(trimStart(slice));
    if (!piece.text) continue;
    const tail = piece.text.split(" ")[0].replace(/[^\p{L}\p{N}]+$/u, "");
    const glued = cutWordSoFar !== "" && (LONG_WORD.test(cutWordSoFar) || tail.length <= MAX_TAIL);
    if (runs.length && !glued) runs.push(SPACE);
    runs.push(...piece.runs);
    const filled = slice.text.length > 2 && slice.text.at(-2) !== " " && !piece.text.includes(" ") && !CLOSED_WORD.test(piece.text);
    cutWordSoFar = filled ? (glued ? cutWordSoFar : "") + piece.text : "";
  }
  return mergedRuns(runs);
}

/**
 * @param {Line[]} lines a run of box rows
 * @returns {{ header: Run[][] | null, rows: Run[][][] } | null}
 */
function boxTable(lines) {
  const texts = lines.map((line) => line.text);
  const rules = texts.filter((text) => RULE_ROW.test(text));
  if (!rules.length) return null;
  const borders = bordersOf(rules[0]);
  if (borders.length < 3 || rules.some((text) => bordersOf(text).join() !== borders.join())) return null;
  /** @type {Line[][]} */
  const groups = [];
  /** @type {Line[]} */
  let group = [];
  for (const [index, line] of lines.entries()) {
    if (RULE_ROW.test(line.text)) {
      if (!group.length && index > 0 && RULE_ROW.test(texts[index - 1])) return null;
      if (group.length) groups.push(group);
      group = [];
    } else if (line.text.length === borders[borders.length - 1] + 1 && !line.text.slice(0, borders[0]).trim() && borders.every((at) => line.text[at] === "│")) {
      group.push(line);
    } else {
      return null;
    }
  }
  if (group.length) groups.push(group);
  const hasHeader = TOP_RULE.test(texts[0]);
  if (groups.length < (hasHeader ? 2 : 1) || texts.some((text, index) => (index > 0 && TOP_RULE.test(text)) || (index < texts.length - 1 && BOTTOM_RULE.test(text)))) return null;
  const cells = (/** @type {Line[]} */ rowLines) => borders.slice(0, -1).map((from, column) => cellRuns(rowLines.map((line) => sliceLine(line, from + 1, borders[column + 1]))));
  const rows = groups.map(cells);
  return hasHeader ? { header: rows[0], rows: rows.slice(1) } : { header: null, rows };
}

/** @param {Run[]} runs */
const withoutBold = (runs) =>
  runs.map((run) => ({ text: run.text, cls: run.cls.split(" ").filter((name) => name !== "a-b").join(" ") }));
/** @param {Run[]} runs */
const cellHtml = (runs) => linkedRunsHtml(runs, "key");

/**
 * The stacked rows for a run of box rows, or null when it isn't clearly a table.
 * @param {Line[]} lines
 * @returns {string | null}
 */
export function boxTableHtml(lines) {
  const table = boxTable(lines);
  if (!table) return null;
  const { header, rows } = table;
  return stackedHtml(
    rows.map(([title, ...rest]) => ({
      title: cellHtml(withoutBold(title)),
      fields: rest.map((cell, index) => ({ label: header ? header[index + 1].map((run) => run.text).join("") : null, html: cellHtml(cell) })),
    })),
    !header,
  );
}
