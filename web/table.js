import { escapeHtml } from "./html.js";
import { linkedRunsHtml } from "./links.js";
import { rowKey, savedCellKey, screenCellKey } from "./pipe-table.js";
import { sliceLine, trimEnd, trimStart } from "./screen.js";

/**
 * @typedef {import("./screen.js").Run} Run
 * @typedef {import("./screen.js").Line} Line
 * @typedef {{ label: string, html: string }} Pair a cell under its header cell's text
 * @typedef {{ html: string }} PlainLine a cell whose header cell is empty or off screen
 * @typedef {Pair | PlainLine} Field
 * @typedef {{ title: string, fields: Field[] }} StackedRow
 * @typedef {import("./pipe-table.js").PipeTable} PipeTable
 * @typedef {object} BoxTable
 * @property {Run[][] | null} header
 * @property {Run[][][]} rows
 * @property {string[][]} keys each drawn row's cell keys, the header's first when it is drawn
 * @property {boolean} closedBelow
 * @property {boolean} partialFirst the first drawn row may be only its lower lines
 * @property {boolean} partialLast the last drawn row may be only its upper lines
 */

/**
 * @param {string | undefined} headerText
 * @param {string} html
 * @returns {Field}
 */
export const fieldOf = (headerText, html) => (headerText ? { label: headerText, html } : { html });

/** @param {Field[]} fields */
function fieldsHtml(fields) {
  let html = "";
  let pairs = "";
  for (const field of fields) {
    if ("label" in field) {
      pairs += `<dt>${escapeHtml(field.label)}</dt><dd>${field.html}</dd>`;
      continue;
    }
    if (pairs) html += `<dl class="stacked-fields">${pairs}</dl>`;
    pairs = "";
    html += `<p class="stacked-line">${field.html}</p>`;
  }
  return pairs ? `${html}<dl class="stacked-fields">${pairs}</dl>` : html;
}

/**
 * @param {StackedRow[]} rows
 * @param {{ continuesAbove?: boolean }} [options]
 */
export function stackedHtml(rows, { continuesAbove = false } = {}) {
  const sections = rows.map(({ title, fields }) => {
    const shown = fields.filter((field) => field.html.trim());
    if (!title.trim() && !shown.length) return "";
    const body = fieldsHtml(shown);
    return `<section class="stacked-row">${title.trim() ? `<strong class="stacked-title">${title}</strong>` : ""}${body}</section>`;
  });
  return `<div class="stacked">${continuesAbove ? `<p class="stacked-note">Table continues above</p>` : ""}${sections.join("")}</div>`;
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
// with the rest on the next line.
const ENDS_IN_LETTER_OR_DIGIT = /[\p{L}\p{N}]$/u;
const ENDS_IN_CLOSING_MARK = /[.,;:!?)\]}"'`]$/;
const PATH_OR_ADDRESS = /^(?:https?:\/\/|~?\/)/;
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
    if (runs.length && !cutWordSoFar) runs.push(SPACE);
    runs.push(...piece.runs);
    const word = cutWordSoFar + piece.text;
    const oneWordFillsCell = slice.text.length > 2 && slice.text.at(-2) !== " " && !piece.text.includes(" ");
    const cutMidWord = oneWordFillsCell && (PATH_OR_ADDRESS.test(word) ? !ENDS_IN_CLOSING_MARK.test(piece.text) : ENDS_IN_LETTER_OR_DIGIT.test(piece.text));
    cutWordSoFar = cutMidWord ? word : "";
  }
  return mergedRuns(runs);
}

/**
 * @param {Line[]} lines a run of box rows
 * @returns {BoxTable | null}
 */
export function boxTable(lines) {
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
  const keys = groups.map((rowLines) => borders.slice(0, -1).map((from, column) => screenCellKey(rowLines.map((line) => line.text.slice(from + 1, borders[column + 1])).join(""))));
  const ends = { closedBelow: BOTTOM_RULE.test(texts[texts.length - 1]), partialFirst: !RULE_ROW.test(texts[0]), partialLast: !RULE_ROW.test(texts[texts.length - 1]) };
  return hasHeader ? { header: rows[0], rows: rows.slice(1), keys, ...ends } : { header: null, rows, keys, ...ends };
}

/** @param {Run[]} runs */
const withoutBold = (runs) =>
  runs.map((run) => ({ text: run.text, cls: run.cls.split(" ").filter((name) => name !== "a-b").join(" ") }));
/** @param {Run[]} runs */
const cellHtml = (runs) => linkedRunsHtml(runs, "key");

/**
 * @param {BoxTable} table
 * @returns {string}
 */
export function boxTableHtml({ header, rows }) {
  return stackedHtml(
    rows.map(([title, ...rest]) => ({
      title: cellHtml(withoutBold(title)),
      fields: rest.map((cell, index) => fieldOf(header?.[index + 1].map((run) => run.text).join(""), cellHtml(cell))),
    })),
    { continuesAbove: !header },
  );
}

/**
 * @param {BoxTable} table
 * @param {number} index
 */
const isWhole = ({ keys, partialFirst, partialLast }, index) => !(index === 0 && partialFirst) && !(index === keys.length - 1 && partialLast);

/**
 * The key of the first row drawn whole, which finds the table's saved copy.
 * @param {BoxTable} table
 */
export function anchorOf(table) {
  const index = table.keys.findIndex((_, at) => isWhole(table, at));
  return index < 0 ? null : rowKey(table.keys[index]);
}

/**
 * @param {BoxTable} table
 * @param {string[][]} saved the saved rows' cell keys, the header's first
 * @param {number} start
 */
function drawnFrom(table, saved, start) {
  const { header, keys, closedBelow } = table;
  if ((header && start > 0) || (closedBelow && start + keys.length !== saved.length)) return false;
  return keys.every((cells, index) => {
    const savedCells = saved[start + index];
    if (isWhole(table, index)) return cells.every((key, column) => key === savedCells[column]);
    if (index === 0) return cells.every((key, column) => savedCells[column].endsWith(key));
    return cells.every((key, column) => savedCells[column].startsWith(key));
  });
}

/**
 * The saved rows a drawn table shows, when exactly one way of reading the
 * saved tables fits every drawn row; null otherwise. `source` is the saved
 * table it was read from.
 * @param {BoxTable} table
 * @param {PipeTable[]} savedTables
 * @returns {{ table: PipeTable, continuesAbove: boolean, source: PipeTable } | null}
 */
export function savedRowsOf(table, savedTables) {
  if (anchorOf(table) === null) return null;
  /** @type {Map<string, { table: PipeTable, continuesAbove: boolean, source: PipeTable }>} */
  const found = new Map();
  for (const source of savedTables) {
    const { header, rows } = source;
    if (header.length !== table.keys[0].length) continue;
    const all = [header, ...rows];
    const saved = all.map((cells) => cells.map(savedCellKey));
    for (let start = 0; start + table.keys.length <= all.length; start++) {
      const shownRows = all.slice(Math.max(start, 1), start + table.keys.length);
      if (!shownRows.length || !drawnFrom(table, saved, start)) continue;
      const shown = { table: { header, rows: shownRows }, continuesAbove: start > 1 };
      const key = JSON.stringify(shown);
      if (!found.has(key)) found.set(key, { ...shown, source });
    }
  }
  return found.size === 1 ? [...found.values()][0] : null;
}
