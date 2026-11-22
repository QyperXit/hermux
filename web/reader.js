import { isTypingRole } from "./agent-question.js";
import { isBlank, leading, trimStart } from "./line.js";
import { readScreen, shellRows, wrappedParagraphs } from "./screen.js";
import { isPausedState, pausedHelpers, taskRows } from "./subagents.js";
import { MAX_INDENT_CH, escapeHtml } from "./html.js";
import { linkedRunsHtml } from "./links.js";
import { savedTableHtml } from "./history.js";
import { anchorOf, boxTable, boxTableHtml, savedRowsOf } from "./table.js";

/**
 * @typedef {import("./screen.js").Run} Run
 * @typedef {import("./screen.js").Line} Line
 * @typedef {import("./screen.js").Row} Row
 * @typedef {import("./screen.js").DialogRow} DialogRow
 * @typedef {import("./links.js").CopyMode} CopyMode
 * @typedef {import("./pipe-table.js").PipeTable} PipeTable
 * @typedef {import("./agent-question.js").Question} Question
 * @typedef {import("./agent-question.js").QuestionOption} QuestionOption
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
    `<span class="opt-mark">${row.selected ? hidden("selected") : ""}</span>` +
    (row.number === null ? "" : `<span class="opt-num">${row.number}.</span>`) +
    (row.ticked === null ? "" : `<span class="opt-box">${hidden(row.ticked ? "ticked" : "not ticked")}</span>`) +
    `<span class="opt-label">${label}</span></div>`
  );
}

/**
 * @param {string} className
 * @param {string} text
 */
const paragraphHtml = (className, text) => `<p class="${className}">${escapeHtml(text)}</p>`;

// A typing row Atomic draws empty while its field is open.
/** @type {Record<QuestionOption["role"], string>} */
const EMPTY_LABEL = { type: "Type something.", chat: "Chat about this", answer: "", commit: "" };

/** @param {QuestionOption} option */
function answerHtml(option) {
  const classes = ["ask-opt", isTypingRole(option.role) && "is-quiet", option.selected && "is-cursor", option.ticked === true && "is-ticked"].filter(Boolean).join(" ");
  const tick = option.ticked === null ? "" : `<span class="ask-tick" aria-hidden="true"></span>${hidden(option.ticked ? "ticked, " : "not ticked, ")}`;
  const marks = `${option.answered ? `<span class="ask-answered" aria-hidden="true">✔</span>${hidden(", your answer")}` : ""}${option.selected ? hidden(", Atomic's cursor") : ""}`;
  const description = option.description ? `<span class="ask-desc">${escapeHtml(option.description)}</span>` : "";
  const label = option.label || EMPTY_LABEL[option.role];
  return (
    `<button class="${classes}" type="button" data-answer="${option.number}">` +
    `<span class="ask-num">${option.number}</span>` +
    `<span class="ask-body">${tick}<span class="ask-label">${escapeHtml(label)}</span>${marks}${description}</span></button>`
  );
}

// Atomic 0.9.90's own question: its header small, the question large, and
// each option a row to tap.
/** @param {Question} question */
function questionHtml(question) {
  const step = question.step ? `Question ${question.step.at} of ${question.step.of}` : "";
  const title = question.title || step ? `<p class="ask-title"><span>${escapeHtml(question.title)}</span>${step ? `<span class="ask-step">${step}</span>` : ""}</p>` : "";
  const text = question.text.map((paragraph, index) => paragraphHtml(index === question.prompt ? "ask-text" : "ask-lead", paragraph)).join("");
  return (
    `<section class="ask" aria-label="${question.form === "trust" ? "Atomic is asking" : "The agent is asking"}">` +
    title +
    text +
    `<div class="ask-options" role="group" aria-label="Answers">${question.options.map(answerHtml).join("")}</div>` +
    question.after.map((paragraph) => paragraphHtml("ask-after", paragraph)).join("") +
    `</section>`
  );
}

// /tasks while it lists only paused helpers as working: each paused
// helper's row is a key that opens it, the other rows stay as drawn.
/**
 * @param {Row[]} rows
 * @param {{ start: number, end: number }} list
 * @param {import("./subagents.js").TaskRow[]} tasks
 */
function pausedTasksHtml(rows, list, tasks) {
  /** @type {string[]} */
  const html = [];
  /** @type {Line[]} */
  let block = [];
  const flush = () => {
    if (block.length) html.push(blockHtml(block));
    block = [];
  };
  for (let i = list.start; i < list.end; i++) {
    const index = tasks.findIndex((task) => task.at === i);
    const task = tasks[index];
    if (!task || !isPausedState(task.state)) {
      block.push(rows[i]);
      continue;
    }
    flush();
    html.push(
      `<button class="task-open${task.cursor ? " is-cursor" : ""}" type="button" data-task="${index}" data-task-name="${escapeHtml(task.name)}">` +
        `<span class="task-open-mark" aria-hidden="true">${escapeHtml(task.mark)}</span><span class="task-open-name">${escapeHtml(task.name)}</span>` +
        `<span class="task-open-what">${escapeHtml(task.task ?? "")}</span><span class="task-open-state">${escapeHtml(task.state ?? "")}</span>${hidden(`${task.cursor ? ", Atomic's cursor" : ""}, open it`)}</button>`,
    );
  }
  flush();
  return html;
}

/**
 * @param {Row} first
 * @param {Run[]} runs
 */
const bandParagraphHtml = (first, runs) => `<p class="p"${indentStyle(leading(first) - 1, "margin-left")}>${runsHtml(runs)}</p>`;

/** @param {string} text */
export function shellParts(text) {
  const lines = shellRows(text);
  while (lines.length && isBlank(lines[lines.length - 1])) lines.pop();
  return lines.map((line) => (isBlank(line) ? `<div class="gap"></div>` : monoLineHtml(line, "", null)));
}

/** @param {string} text */
export const shellHtml = (text) => shellParts(text).join("");

const LIST_ITEM = /^(?:[-•*]|\d+[.)])\s/;

/**
 * @param {string} text
 * @param {PipeTable[]} [savedTables]
 */
export const readerHtml = (text, savedTables) => readerParts(text, savedTables).join("");

/**
 * @param {string} text
 * @param {PipeTable[]} [savedTables]
 */
export const readerParts = (text, savedTables) => readLive(text, savedTables).parts;

/**
 * @param {Line[]} box
 * @param {PipeTable[]} savedTables
 * @param {string[]} anchors
 * @param {PipeTable[]} read
 */
function boxHtml(box, savedTables, anchors, read) {
  const table = boxTable(box);
  if (!table) return blockHtml(box);
  const saved = savedRowsOf(table, savedTables);
  if (saved) {
    read.push(saved.source);
    return savedTableHtml(saved.table, { continuesAbove: saved.continuesAbove });
  }
  const anchor = anchorOf(table);
  if (anchor !== null) anchors.push(anchor);
  return boxTableHtml(table);
}

/**
 * The Live screen's parts, the anchor of each box table in it that no saved
 * table reads, the saved tables its box tables are read from, and the screen
 * as read.
 * @param {string} text
 * @param {PipeTable[]} [savedTables] tables from the Agent's saved messages
 * @returns {{ parts: string[], anchors: string[], read: PipeTable[], screen: import("./screen.js").Screen }}
 */
export function readLive(text, savedTables = []) {
  /** @type {string[]} */
  const anchors = [];
  /** @type {PipeTable[]} */
  const read = [];
  const screen = readScreen(text);
  const { rows, options, question } = screen;
  const prose = new Map(screen.prose.map((paragraph) => [paragraph.start, paragraph]));
  const tasks = screen.list && pausedHelpers(screen) ? taskRows(screen) : null;
  /** @type {string[]} */
  const html = [];
  let i = 0;
  /** @param {number} at */
  const isContentRow = (at) => at < rows.length && !rows[at].chrome;
  while (i < rows.length) {
    const line = rows[i];
    if (question && i === question.start) {
      if (question.heading !== null) html.push(monoLineHtml(withoutColours(rows[question.heading]), " is-chrome", null));
      html.push(questionHtml(question));
      i = question.end;
      continue;
    }
    if (tasks && screen.list && i === screen.list.start) {
      html.push(...pausedTasksHtml(rows, screen.list, tasks));
      i = screen.list.end;
      continue;
    }
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
      const rowHtml = (row) => (line.band === "tool" ? monoLineHtml(row) : bandParagraphHtml(row, trimStart(row).runs));
      // Atomic 0.9.90 wraps the user's message to the pane; its rows join again.
      const joinedHtml = () => wrappedParagraphs(band).map((paragraph) => bandParagraphHtml(band[paragraph.start], paragraph.runs)).join("");
      html.push(`<div class="band band-${line.band}">${line.band === "you" && screen.atomic0990 ? joinedHtml() : band.map(rowHtml).join("")}</div>`);
    } else if (line.kind === "box") {
      /** @type {Row[]} */
      const box = [];
      while (isContentRow(i) && rows[i].kind === "box") box.push(rows[i++]);
      html.push(boxHtml(box, savedTables, anchors, read));
    } else if (paragraph) {
      const item = LIST_ITEM.test(line.text.trim()) ? " li" : "";
      html.push(`<p class="p${item}"${indentStyle(leading(line) - 1, "margin-left")}>${runsHtml(paragraph.runs)}</p>`);
      i = paragraph.end;
    } else {
      throw new Error(`Line ${i} continues a dialog option that has no first row.`);
    }
  }
  return { parts: html, anchors, read, screen };
}
