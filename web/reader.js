// The agent screen's output in Reader style. herdr's `--format ansi` text
// keeps Atomic's highlighting as SGR escape codes; they become a fixed set of
// classes, and every piece of text is HTML-escaped, so the output can never
// add markup. Plain text (the server's fallback) renders the same way, in ink.
// No DOM here, so the tests can import it.
import { leading, readScreen, shellRows, trimStart } from "./screen.js";
import { MAX_INDENT_CH, escapeHtml } from "./html.js";

/**
 * @typedef {import("./screen.js").Run} Run
 * @typedef {import("./screen.js").Line} Line
 * @typedef {import("./screen.js").Row} Row
 * @typedef {import("./screen.js").DialogRow} DialogRow
 */

/** @param {Run[]} runs */
const runsHtml = (runs) => runs.map(({ text, cls }) => (cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text))).join("");

/**
 * @param {number} ch
 * @param {string} [property]
 */
const indentStyle = (ch, property = "padding-left") => (ch > 0 ? ` style="${property}:${Math.min(ch, MAX_INDENT_CH)}ch"` : "");

// A mono line keeps its own spacing; its leading indent is capped.
/**
 * @param {Line} line
 * @param {string} [extraClass]
 */
const monoLineHtml = (line, extraClass = "") =>
  `<div class="line${extraClass}"${indentStyle(leading(line))}>${runsHtml(trimStart(line).runs) || " "}</div>`;

// A box-drawn region (a workflow graph, panel or table) keeps its terminal
// layout: one mono block with every line as drawn, scrolled sideways, never wrapped.
/**
 * @param {{ runs: Run[] }[]} rows
 * @param {string} [extraClass]
 */
const blockHtml = (rows, extraClass = "") => `<div class="block${extraClass}">${rows.map((row) => runsHtml(row.runs)).join("\n")}</div>`;
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

// The cursor row and a ticked box are told apart by the stylesheet, which draws
// the bar, the marker and the boxes; their state is also hidden text for screen readers.
/** @param {string} text */
const hidden = (text) => `<span class="visually-hidden">${text}</span>`;

/** @param {DialogRow} row */
function optionHtml(row) {
  // The cursor row and an answered row are in Atomic's orange and bold; that styling is dropped.
  const plain = row.selected || row.ticked === true;
  const label = plain
    ? escapeHtml(row.parts.map((part) => part.text.trim()).join(" "))
    : runsHtml(row.parts[0].runs);
  const classes = ["opt", row.selected && "is-selected", row.ticked === true && "is-ticked", row.ticked === false && "is-unticked"].filter(Boolean);
  return (
    `<div class="${classes.join(" ")}">` +
    `<span class="opt-mark">${row.selected ? hidden("selected") : ""}</span>` +
    (row.number === null ? "" : `<span class="opt-num">${row.number}.</span>`) +
    (row.ticked === null ? "" : `<span class="opt-box">${hidden(row.ticked ? "ticked" : "not ticked")}</span>`) +
    `<span class="opt-label">${label}</span></div>`
  );
}

// A plain shell's output. It isn't Atomic's layout, so nothing is joined,
// boxed or dimmed: every row stays one mono row as the shell printed it (a
// listing's columns, a long command), with the same colours and escaping.
/** @param {string} text */
export function shellHtml(text) {
  const lines = shellRows(text);
  while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
  return lines.map((line) => (isBlank(line) ? `<div class="gap"></div>` : monoLineHtml(line))).join("");
}

const LIST_ITEM = /^(?:[-•*]|\d+[.)])\s/;

// Reader HTML for herdr's output text (ANSI or plain), read by web/screen.js.
/** @param {string} text */
export function readerHtml(text) {
  const screen = readScreen(text);
  if (screen.graph) return graphHtml(screen.rows);
  const { rows, chromeStart, options } = screen;
  const prose = new Map(screen.prose.map((paragraph) => [paragraph.start, paragraph]));
  /** @type {string[]} */
  const html = [];
  let i = 0;
  while (i < chromeStart) {
    const line = rows[i];
    const option = options.get(i);
    const paragraph = prose.get(i);
    if (line.kind === "gap") {
      html.push(`<div class="gap"></div>`);
      i++;
    } else if (option) {
      html.push(optionHtml(option));
      i += option.more + 1;
    } else if (line.kind === "rule") {
      html.push(`<hr class="output-rule">`);
      i++;
    } else if (line.kind === "code") {
      html.push(monoLineHtml(line));
      i++;
    } else if (line.kind === "band") {
      // Consecutive rows on the same shade make one band; its rows stay unjoined.
      /** @type {Row[]} */
      const band = [];
      while (i < chromeStart && rows[i].kind === "band" && rows[i].band === line.band) band.push(rows[i++]);
      /** @param {Row} row */
      const rowHtml = (row) =>
        line.band === "tool"
          ? monoLineHtml(row)
          : `<p class="p"${indentStyle(leading(row) - 1, "margin-left")}>${runsHtml(trimStart(row).runs)}</p>`;
      html.push(`<div class="band band-${line.band}">${band.map(rowHtml).join("")}</div>`);
    } else if (line.kind === "box") {
      /** @type {Row[]} */
      const box = [];
      while (i < chromeStart && rows[i].kind === "box") box.push(rows[i++]);
      html.push(blockHtml(box));
    } else if (paragraph) {
      // Atomic's own wraps are joined into one paragraph.
      const item = LIST_ITEM.test(line.text.trim()) ? " li" : "";
      html.push(`<p class="p${item}"${indentStyle(leading(line) - 1, "margin-left")}>${runsHtml(paragraph.runs)}</p>`);
      i = paragraph.end;
    } else {
      throw new Error(`Line ${i} continues a dialog option that has no first row.`);
    }
  }
  // Atomic's chrome is dimmed mono, without colours.
  while (i < rows.length) {
    if (rows[i].kind === "rule") {
      html.push(`<hr class="output-rule is-chrome">`);
      i++;
    } else if (rows[i].kind === "box") {
      /** @type {Line[]} */
      const box = [];
      while (i < rows.length && rows[i].kind === "box") box.push(withoutColours(rows[i++]));
      html.push(blockHtml(box, " is-chrome"));
    } else {
      html.push(monoLineHtml(withoutColours(rows[i++]), " is-chrome"));
    }
  }
  return html.join("");
}
