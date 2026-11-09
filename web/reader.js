import { leading, readScreen, shellRows, trimStart } from "./screen.js";
import { MAX_INDENT_CH, escapeHtml } from "./html.js";
import { linkedRunsHtml } from "./links.js";

/**
 * @typedef {import("./screen.js").Run} Run
 * @typedef {import("./screen.js").Line} Line
 * @typedef {import("./screen.js").Row} Row
 * @typedef {import("./screen.js").DialogRow} DialogRow
 * @typedef {import("./links.js").CopyMode} CopyMode
 */

/**
 * @param {Run[]} runs
 * @param {CopyMode | null} [copy]
 */
const runsHtml = (runs, copy = "key") =>
  copy ? linkedRunsHtml(runs, copy) : runs.map(({ text, cls }) => (cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text))).join("");

/**
 * @param {number} ch
 * @param {string} [property]
 */
const indentStyle = (ch, property = "padding-left") => (ch > 0 ? ` style="${property}:${Math.min(ch, MAX_INDENT_CH)}ch"` : "");

/**
 * @param {Line} line
 * @param {string} [extraClass]
 * @param {CopyMode | null} [copy]
 */
const monoLineHtml = (line, extraClass = "", copy = "key") =>
  `<div class="line${extraClass}"${indentStyle(leading(line))}>${runsHtml(trimStart(line).runs, copy) || " "}</div>`;

/**
 * @param {{ runs: Run[] }[]} rows
 * @param {string} [extraClass]
 * @param {CopyMode | null} [copy]
 */
const blockHtml = (rows, extraClass = "", copy = "press") => `<div class="block${extraClass}">${rows.map((row) => runsHtml(row.runs, copy)).join("\n")}</div>`;
/**
 * @param {Line} line
 * @returns {Line}
 */
const withoutColours = (line) => ({ ...line, runs: [{ text: line.text, cls: "" }] });

// Atomic's full-screen workflow graph is all Atomic's drawing: one block, blank
// and connector rows included. Atomic pins its GRAPH pill to the bottom of the
// screen, so a small graph sits over many blank rows; that filler is screen
// space, not layout, so a blank run keeps at most MAX_GRAPH_GAP rows.
const MAX_GRAPH_GAP = 3;

/** @param {Line} line */
const isBlank = (line) => !line.text.trim();

/** @param {Line[]} rows */
function graphHtml(rows) {
  let end = rows.length;
  while (end > 0 && isBlank(rows[end - 1])) end--;
  const drawn = rows.slice(rows.findIndex((row) => !isBlank(row)), end);
  let gap = 0;
  return blockHtml(drawn.filter((row) => (isBlank(row) ? ++gap <= MAX_GRAPH_GAP : ((gap = 0), true))));
}

/** @param {string} text */
const hidden = (text) => `<span class="visually-hidden">${text}</span>`;

/** @param {DialogRow} row */
function optionHtml(row) {
  // The cursor row and an answered row are in Atomic's orange and bold; that styling is dropped.
  const plain = row.selected || row.ticked === true;
  const label = plain
    ? escapeHtml(row.labelLines.map((part) => part.text.trim()).join(" "))
    : row.labelLines.map((part) => runsHtml(part.runs)).join(" ");
  const classes = ["opt", row.selected && "is-selected", row.ticked === true && "is-ticked", row.ticked === false && "is-unticked"].filter(Boolean);
  return (
    `<div class="${classes.join(" ")}">` +
    (row.inBox ? `<span class="opt-edge"></span>` : "") +
    `<span class="opt-mark">${row.selected ? hidden("selected") : ""}</span>` +
    (row.number === null ? "" : `<span class="opt-num">${row.number}.</span>`) +
    (row.ticked === null ? "" : `<span class="opt-box">${hidden(row.ticked ? "ticked" : "not ticked")}</span>`) +
    `<span class="opt-label">${label}</span></div>`
  );
}

/** @param {string} text */
export function shellParts(text) {
  const lines = shellRows(text);
  while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
  return lines.map((line) => (isBlank(line) ? `<div class="gap"></div>` : monoLineHtml(line, "", null)));
}

/** @param {string} text */
export const shellHtml = (text) => shellParts(text).join("");

const LIST_ITEM = /^(?:[-•*]|\d+[.)])\s/;

/** @param {string} text */
export const readerHtml = (text) => readerParts(text).join("");

/**
 * @param {string} text
 * @returns {string[]}
 */
export function readerParts(text) {
  const screen = readScreen(text);
  if (screen.graph) return [graphHtml(screen.rows)];
  const { rows, options } = screen;
  const prose = new Map(screen.prose.map((paragraph) => [paragraph.start, paragraph]));
  /** @type {string[]} */
  const html = [];
  let i = 0;
  /** @param {number} at */
  const isContentRow = (at) => at < rows.length && !rows[at].chrome;
  while (i < rows.length) {
    const line = rows[i];
    if (line.chrome) {
      if (line.kind === "rule") {
        html.push(`<hr class="output-rule is-chrome">`);
        i++;
      } else if (line.kind === "box") {
        /** @type {Line[]} */
        const box = [];
        while (i < rows.length && rows[i].chrome && rows[i].kind === "box") box.push(withoutColours(rows[i++]));
        html.push(blockHtml(box, " is-chrome", null));
      } else {
        html.push(monoLineHtml(withoutColours(rows[i++]), " is-chrome", null));
      }
      continue;
    }
    const option = options.get(i);
    const paragraph = prose.get(i);
    if (line.kind === "gap") {
      html.push(`<div class="gap"></div>`);
      i++;
    } else if (option) {
      html.push(optionHtml(option));
      i += option.continuationRows + 1;
    } else if (line.kind === "rule") {
      html.push(`<hr class="output-rule">`);
      i++;
    } else if (line.kind === "code") {
      html.push(monoLineHtml(line));
      i++;
    } else if (line.kind === "band") {
      /** @type {Row[]} */
      const band = [];
      while (isContentRow(i) && rows[i].kind === "band" && rows[i].band === line.band) band.push(rows[i++]);
      /** @param {Row} row */
      const rowHtml = (row) =>
        line.band === "tool"
          ? monoLineHtml(row)
          : `<p class="p"${indentStyle(leading(row) - 1, "margin-left")}>${runsHtml(trimStart(row).runs)}</p>`;
      html.push(`<div class="band band-${line.band}">${band.map(rowHtml).join("")}</div>`);
    } else if (line.kind === "box") {
      /** @type {Row[]} */
      const box = [];
      while (isContentRow(i) && rows[i].kind === "box") box.push(rows[i++]);
      html.push(blockHtml(box));
    } else if (paragraph) {
      const item = LIST_ITEM.test(line.text.trim()) ? " li" : "";
      html.push(`<p class="p${item}"${indentStyle(leading(line) - 1, "margin-left")}>${runsHtml(paragraph.runs)}</p>`);
      i = paragraph.end;
    } else {
      throw new Error(`Line ${i} continues a dialog option that has no first row.`);
    }
  }
  return html;
}
