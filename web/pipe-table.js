/**
 * @typedef {{ header: string[], rows: string[][] }} PipeTable a Markdown table's cells, its data rows as long as its header
 */

export const MAX_ANCHORS = 4;
export const MAX_ANCHOR_CHARS = 4000;

export const FENCE = /^\s*(```|~~~)/;
export const TABLE_ROW = /^\s*\|.*\|\s*$/;
const SEPARATOR_CELL = /^:?-+:?$/;

// The cells of a table row: split at every pipe that isn't escaped (\|) or inside a code span.
/** @param {string} row */
function cellsOf(row) {
  const inner = row.trim().slice(1);
  /** @type {string[]} */
  const cells = [];
  let cell = "";
  let closed = false;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    closed = false;
    if (char === "\\" && inner[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (char === "`") {
      const ticks = /^`+/.exec(inner.slice(i))?.[0] ?? "`";
      const end = new RegExp("(?<!`)" + ticks + "(?!`)").exec(inner.slice(i + ticks.length));
      const span = end ? inner.slice(i, i + ticks.length + end.index + ticks.length) : ticks;
      cell += span.replaceAll("\\|", "|");
      i += span.length - 1;
    } else if (char === "|") {
      cells.push(cell);
      cell = "";
      closed = true;
    } else {
      cell += char;
    }
  }
  if (!closed) cells.push(cell);
  return cells.map((each) => each.trim());
}

/**
 * A run of pipe rows as a table: a header, a separator row and at least one data row.
 * @param {string[]} rows
 * @returns {PipeTable | null}
 */
export function pipeTable(rows) {
  if (rows.length < 3) return null;
  const [header, separator, ...data] = rows.map(cellsOf);
  if (separator.length !== header.length || !separator.every((cell) => SEPARATOR_CELL.test(cell)) || data.some((cells) => cells.length > header.length)) return null;
  return { header, rows: data.map((cells) => header.map((_, index) => cells[index] ?? "")) };
}

/**
 * @param {string} text a message's Markdown
 * @returns {PipeTable[]}
 */
export function pipeTables(text) {
  /** @type {PipeTable[]} */
  const tables = [];
  const lines = text.split("\n");
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) fenced = !fenced;
    if (fenced || !TABLE_ROW.test(lines[i])) continue;
    const start = i;
    while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1])) i++;
    const table = pipeTable(lines.slice(start, i + 1).map((line) => line.trim()));
    if (table) tables.push(table);
  }
  return tables;
}

// A cell as Atomic draws it and as it is saved compare equal once whitespace
// and the inline marks Atomic draws as styles are gone.
const SPACE_AND_MARKS = /[\s*_`]/g;
const LINK = /\[([^\]]*)\]\([^)\s]*\)/g;
const ESCAPED_MARK = /\\([!-/:-@[-`{-~])/g;

// A markdown link shows its text on screen.
/** @param {string} text */
export const withoutLinkTargets = (text) => text.replace(LINK, "$1");
/** @param {string} text */
export const screenCellKey = (text) => text.normalize("NFC").replace(SPACE_AND_MARKS, "");
/** @param {string} cell */
export const savedCellKey = (cell) => screenCellKey(withoutLinkTargets(cell).replace(ESCAPED_MARK, "$1"));
/** @param {string[]} keys */
export const rowKey = (keys) => keys.join(" ");

/**
 * @param {PipeTable} table
 * @param {Set<string>} anchors
 */
export const holdsAnchor = ({ header, rows }, anchors) => [header, ...rows].some((cells) => anchors.has(rowKey(cells.map(savedCellKey))));
