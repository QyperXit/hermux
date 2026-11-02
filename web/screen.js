// Reads an Atomic screen, from herdr's `--format ansi` text or plain text,
// once: its rows without the scrollbar and jump hint, where Atomic's own
// screen furniture (chrome) starts, whether it shows a workflow graph, and
// the prose with Atomic's wraps joined. The server's latest lines and the
// agent screen's Reader both read it from here. No DOM here.
import { CONTROL } from "./wrap.js";

/**
 * A colour a code set: a 256-colour index, or an RGB triple.
 * @typedef {{ index?: number, rgb?: number[] }} Colour
 * @typedef {"code" | "link" | "soft"} Foreground
 * @typedef {"you" | "tool"} Band
 * @typedef {{ bold: boolean, italic: boolean, underline: boolean, inverse: boolean, fg: Foreground | null, bg: Band | null }} Style
 * @typedef {{ text: string, cls: string }} Run
 * @typedef {{ text: string, runs: Run[], band: Band | null }} Line
 */

// What a row is. Above the chrome: a blank "gap", a dialog "option" (or a
// wrapped label of one), a "rule", "code" (in or at a ``` fence), a shaded
// "band" row, a "box" row (box drawing or a Markdown table), or "prose". In
// the chrome: a "rule", a "box" row, or any other "chrome" row.
/**
 * @typedef {"gap" | "option" | "rule" | "code" | "band" | "box" | "prose" | "chrome"} Kind
 * @typedef {Line & { kind: Kind }} Row
 * @typedef {{ selected: boolean, number: string | null, ticked: boolean | null, start: number, end: number, numbered: boolean }} OptionRow
 */
// A dialog row; `parts` is its label, then each of the label's continuation
// lines with its indent dropped.
/** @typedef {OptionRow & { index: number, more: number, parts: Line[] }} DialogRow */
// Rows [start, end) joined into one paragraph; `runs` has a " " between rows.
/** @typedef {{ start: number, end: number, runs: Run[] }} Prose */
/** @typedef {{ rows: Row[], chromeStart: number, graph: boolean, prose: Prose[], options: Map<number, DialogRow> }} Screen */

// Any escape sequence: CSI (an SGR ends in "m"), OSC up to BEL or ST, a string
// command (DCS, SOS, PM, APC) up to ST, or a two-character escape. A broken
// one is dropped up to where it stops, never shown.
const ESCAPE = /\x1b\[([0-?]*)[ -/]*([@-~])?|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\?)?|\x1b[PX^_][^\x1b]*(?:\x1b\\?)?|\x1b[ -/]*[0-~]?/g;

/**
 * @param {number[] | undefined} rgb
 * @param {number} r
 * @param {number} g
 * @param {number} b
 */
const same = (rgb, r, g, b) => rgb && rgb[0] === r && rgb[1] === g && rgb[2] === b;

// Atomic's palette, checked on real panes: cyan for code and file names, orange
// for links and commands, 256-colour greys 240-245 for thinking and secondary
// text. Any other colour is ink. Orange never reaches the page.
/**
 * @param {Colour} colour
 * @returns {Foreground | null}
 */
function foregroundRole({ rgb, index }) {
  if (same(rgb, 0, 255, 255)) return "code";
  if (same(rgb, 255, 102, 0)) return "link";
  if (index !== undefined && index >= 240 && index <= 245) return "soft";
  return null;
}

// Atomic shades whole rows with these two backgrounds.
/**
 * @param {Colour} colour
 * @returns {Band | null}
 */
function backgroundRole({ rgb }) {
  if (same(rgb, 30, 46, 30)) return "you";
  if (same(rgb, 45, 45, 48)) return "tool";
  return null;
}

/** @returns {Style} */
const plainStyle = () => ({ bold: false, italic: false, underline: false, inverse: false, fg: null, bg: null });

// One extended colour (38, 48 or 58), in either the ";" or the ":" form.
// Returns the colour and how many extra ";" parameters it used.
/**
 * @param {string[][]} codes
 * @param {number} i
 * @returns {[Colour, number]}
 */
function extendedColour(codes, i) {
  const [, ...sub] = codes[i];
  if (sub.length) {
    if (sub[0] === "5") return [{ index: Number(sub[1]) }, 0];
    if (sub[0] === "2") return [{ rgb: sub.slice(-3).map(Number) }, 0];
    return [{}, 0];
  }
  const mode = codes[i + 1]?.[0];
  if (mode === "5") return [{ index: Number(codes[i + 2]?.[0]) }, 2];
  if (mode === "2") return [{ rgb: [2, 3, 4].map((offset) => Number(codes[i + offset]?.[0])) }, 4];
  return [{}, 0];
}

/**
 * @param {Style} style
 * @param {string} params
 */
function applySgr(style, params) {
  const codes = (params === "" ? "0" : params).split(";").map((code) => code.split(":"));
  for (let i = 0; i < codes.length; i++) {
    const code = Number(codes[i][0] || 0);
    if (code === 38 || code === 48 || code === 58) {
      const [colour, used] = extendedColour(codes, i);
      i += used;
      if (code === 38) style.fg = foregroundRole(colour);
      if (code === 48) style.bg = backgroundRole(colour);
      continue;
    }
    if (code === 0) Object.assign(style, plainStyle());
    else if (code === 1) style.bold = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = codes[i][1] !== "0";
    else if (code === 7) style.inverse = true;
    else if (code === 22) style.bold = false;
    else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code === 27) style.inverse = false;
    else if (code === 39 || (code >= 30 && code <= 37) || (code >= 90 && code <= 97)) style.fg = null;
    else if (code === 49 || (code >= 40 && code <= 47) || (code >= 100 && code <= 107)) style.bg = null;
  }
}

/** @param {Style} style */
function classesOf(style) {
  /** @type {string[]} */
  const classes = [];
  if (style.bold) classes.push("a-b");
  if (style.italic) classes.push("a-i");
  if (style.underline) classes.push("a-u");
  if (style.inverse) classes.push("a-inv");
  if (style.fg) classes.push(`a-${style.fg}`);
  return classes.join(" ");
}

// Lines of styled runs: { text, runs: [{ text, cls }], band }. `band` is the
// background role of the line's first cell ("you", "tool" or null). The style
// carries over line ends, as in a terminal. Control characters other than tab
// are dropped.
/** @param {string} text */
function parseAnsi(text) {
  /** @typedef {{ text: string, runs: Run[], band: Band | null | undefined }} OpenLine */
  /** @type {OpenLine[]} */
  const lines = [];
  /** @type {OpenLine} */
  let line = { text: "", runs: [], band: undefined };
  const style = plainStyle();
  /** @param {string} chunk */
  const add = (chunk) => {
    const parts = chunk.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) {
        lines.push(line);
        line = { text: "", runs: [], band: undefined };
      }
      const clean = part.replace(CONTROL, "");
      if (!clean) return;
      if (line.band === undefined) line.band = style.bg;
      const cls = classesOf(style);
      const last = line.runs.at(-1);
      if (last && last.cls === cls) last.text += clean;
      else line.runs.push({ text: clean, cls });
      line.text += clean;
    });
  };
  let at = 0;
  for (const match of text.matchAll(ESCAPE)) {
    add(text.slice(at, match.index));
    at = match.index + match[0].length;
    const [sequence, params, final] = match;
    if (sequence.startsWith("\x1b[") && final === "m" && /^[\d;:]*$/.test(params)) applySgr(style, params);
  }
  add(text.slice(at));
  lines.push(line);
  return lines.map((each) => ({ ...each, band: each.band ?? null }));
}

// The text without its escape codes and control characters: what the page
// compares when it matches screen lines.
/** @param {string} text */
export const plainText = (text) =>
  parseAnsi(text)
    .map((line) => line.text)
    .join("\n");

// Keeps the line's runs for characters [start, end) of its text.
/**
 * @param {Line} line
 * @param {number} start
 * @param {number} [end]
 * @returns {Line}
 */
function sliceLine(line, start, end = line.text.length) {
  /** @type {Run[]} */
  const runs = [];
  let offset = 0;
  for (const run of line.runs) {
    const from = Math.max(start - offset, 0);
    const to = Math.min(end - offset, run.text.length);
    if (to > from) runs.push({ text: run.text.slice(from, to), cls: run.cls });
    offset += run.text.length;
  }
  return { text: line.text.slice(start, end), runs, band: line.band };
}

/** @param {Line} line */
const trimEnd = (line) => sliceLine(line, 0, line.text.trimEnd().length);
/** @param {Line} line */
export const leading = (line) => line.text.length - line.text.trimStart().length;
/** @param {Line} line */
export const trimStart = (line) => sliceLine(line, leading(line));
/** @param {Line} line */
const isBlank = (line) => !line.text.trim();

// Only one blank line in a row is kept.
/**
 * @template {Line} T
 * @param {T[]} lines
 */
const withoutBlankRuns = (lines) => lines.filter((line, index) => !isBlank(line) || (index > 0 && !isBlank(lines[index - 1])));

// A plain shell's rows: styled, each end trimmed, one blank row in a row.
// Nothing of Atomic's is looked for.
/** @param {string} text */
export const shellRows = (text) => withoutBlankRuns(parseAnsi(text).map(trimEnd));

// Atomic draws a transcript scrollbar (│, with a ┃ or █ thumb) in the last
// column of every row while the transcript is longer than the pane. A panel or
// table row starts with its own box edge, so it isn't one; an empty row is.
// The rows' length is the scrollbar's width, found from the │ and ┃ rows; a row
// of exactly that width ending in █ is a thumb cell. The width is 0 when there
// is no scrollbar.
/** @param {string} text */
const isScrollbarRow = (text) => /[│┃]$/.test(text) && !/^\s*[│┃╭╰├┌└╞](?!$)/.test(text);

/** @param {Line[]} lines */
function withoutScrollbar(lines) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const { text } of lines) if (isScrollbarRow(text)) counts.set(text.length, (counts.get(text.length) ?? 0) + 1);
  const [width, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  if (count < 3) return lines;
  return lines.map((line) => (line.text.length === width && (isScrollbarRow(line.text) || line.text.endsWith("█")) ? sliceLine(line, 0, width - 1) : line));
}

// Atomic draws "↓ Jump to latest message · ctrl+end" over the right end of a
// screen row. In an unwrapped read a long row goes on past that edge, so the
// hint can sit mid-line; whatever follows it is the rest of the overdrawn row.
// A row that is only the hint is left blank.
const JUMP_HINT = /(?:^|\s+)↓ Jump to latest message\b.*$/;
/** @param {Line} line */
const withoutJumpHint = (line) => {
  const hint = JUMP_HINT.exec(line.text);
  return hint ? sliceLine(line, 0, hint.index) : line;
};

// Atomic's full-screen workflow graph has its "│ GRAPH │" status pill among
// the last lines on screen; every line of that screen is Atomic's drawing, so
// it is found on the rows as drawn and nothing is removed from them.
const GRAPH_PILL = /^\s*│ GRAPH │/;
/** @param {Line[]} lines */
const showsWorkflowGraph = (lines) =>
  lines
    .filter((line) => !isBlank(line))
    .slice(-3)
    .some((line) => GRAPH_PILL.test(line.text));

// A rule: at least 8 of ─━═-, as Atomic draws the prompt box and a Markdown
// rule. The prompt box's top rule may carry a label, e.g. "[stage: orchestrator-1] ────".
const RULE = /^\s*[─━═-]{8,}\s*$/;
const BOX_TOP_RULE = /^\s*(?:\[[^\]]*\]\s*)?[─━═-]{8,}\s*$/;
/** @param {string} text */
export const isRule = (text) => RULE.test(text);
/** @param {string} text */
export const isBoxTopRule = (text) => BOX_TOP_RULE.test(text);
export const PROMPT = /^\s*❯/;
// Atomic's footer under the prompt box: "(provider) model level • ~/folder (branch)".
export const FOOTER = /^(?:\(\S+\) )?\S+(?: \S+)? • [~/]/;

// The right-aligned usage line: "↑72M • ↓2.8M • R2408M • W7.8M • CH99.4% • $1027.186 (sub) • 36.3%/1.0M (auto)".
// On a narrow pane Atomic cuts it short with "...".
const USAGE_PART = /^(?:[↑↓RW][\d.]+[kMB]?|CH[\d.]+%|\$[\d.]+(?: \(sub\))?)$/;
const CONTEXT_PART = /^(?:[\d.]+%|\?)\/[\d.]+[kMB]?(?: \(auto\))?$/;

/** @param {string} line */
export function isUsage(line) {
  const trimmed = line.trim();
  if (trimmed.endsWith("...")) {
    const parts = trimmed.slice(0, -3).trimEnd().split(" • ");
    return parts.length > 1 && parts.slice(0, -1).every((part) => USAGE_PART.test(part));
  }
  const parts = trimmed.split(" • ");
  return CONTEXT_PART.test(parts[parts.length - 1]) && parts.slice(0, -1).every((part) => USAGE_PART.test(part));
}

// Atomic's own chrome starts at its usage line, drawn straight above the
// prompt box, and runs to the end: usage line, prompt box, footer, 'esc to
// interrupt', task line, background panel and hints. Without a usage line, it
// starts at the last prompt box (a rule, a line starting with ❯, any further
// lines of a draft, and a closing rule) that has Atomic's footer under it.
// Anything of the agent's own above that, rules and ❯ included, is not chrome.
// lines.length when there is none.
/** @param {string[]} texts */
function chromeStartIndex(texts) {
  for (let i = texts.length - 2; i >= 0; i--) {
    if (isUsage(texts[i]) && BOX_TOP_RULE.test(texts[i + 1])) return i;
  }
  for (let i = texts.length - 1; i > 0; i--) {
    if (!PROMPT.test(texts[i]) || !BOX_TOP_RULE.test(texts[i - 1])) continue;
    let end = i + 1;
    while (end < texts.length && !BOX_TOP_RULE.test(texts[end])) end++;
    const below = texts.slice(end + 1).find((text) => text.trim());
    return below && FOOTER.test(below) ? i - 1 : texts.length;
  }
  return texts.length;
}

// Box drawing (panels, tables) or a Markdown table row.
/** @param {string} text */
const isBoxLine = (text) => /[\u2500-\u257f]/.test(text) || /^\s*\|.*\|\s*$/.test(text);
/** @param {string} text */
const isFence = (text) => /^\s*```/.test(text);

// Atomic's question dialogs. The row under the cursor is "❯ 1. Label" and
// a multi-select row is "  2. [✔] Label" or "  3. [ ] Label"; the pointer slot
// is two characters wide, so the other rows start with two spaces. Atomic draws
// the cursor row in its accent colour (orange, which the Reader maps to a link)
// and bold. Rows are found by their shape, not their colour, and only in a
// cluster of at least two numbered rows that has a cursor row, so a numbered
// list in the agent's own prose is left alone. A "Next" or "Submit" row under a
// multi-select sits in the cluster too.
const OPTION_ROW = /^\s*?(❯ |  )\s*(\d+)\. (?:(\[✔\]|\[ \]) )?(\S.*)$/;
const OPTION_END_ROW = /^\s*?(❯ |  )(Next|Submit)$/;
const CONFIRMED_MARK = / ✔$/;
const MAX_DIALOG_GAP = 8;

/**
 * @param {Line} line
 * @returns {OptionRow | null}
 */
const optionRowOf = (line) => {
  const row = line.text.match(OPTION_ROW);
  if (row) {
    const [, pointer, number, box, label] = row;
    const confirmed = !box && CONFIRMED_MARK.test(label);
    return {
      selected: pointer === "❯ ",
      number,
      ticked: box ? box === "[✔]" : confirmed ? true : null,
      start: line.text.length - label.length,
      end: line.text.length - (confirmed ? 2 : 0),
      numbered: true,
    };
  }
  const end = line.text.match(OPTION_END_ROW);
  if (!end) return null;
  return { selected: end[1] === "❯ ", number: null, ticked: null, start: line.text.length - end[2].length, end: line.text.length, numbered: false };
};

// Atomic's `/workflow connect` picker: a ╭── Connect to workflow run ──╮ box.
// Each run in it is its id row (" ● <id>", wrapped on "   " rows when the
// box is narrow), then its name row ("   <name>   <elapsed>   <n/m> stages");
// an "ACTIVE" or "TERMINAL" row heads each group. Atomic draws the run under
// its cursor on its accent shade in bold across the whole inner width, and the
// others never bold, so a run whose rows are all bold is the selected one.
// Every run becomes a dialog row whose parts are its rows inside the borders;
// nothing is changed unless one run is selected.
const PICKER_TITLE = /^\s*╭── Connect to workflow run ─/;
const PICKER_ID_ROW = /^ \S \S/;
const PICKER_SECTION_ROW = /^ {3}(?:ACTIVE|TERMINAL)$/;

// The row's text inside the box's two │ edges, or null for a row that isn't a box row.
/** @param {Line} line */
const insideBorders = (line) => {
  const match = /^(\s*│)(.*)│$/.exec(line.text);
  return match ? trimEnd(sliceLine(line, match[1].length, line.text.length - 1)) : null;
};

/** @param {Line} line */
const allBold = (line) => line.runs.every((run) => !run.text.trim() || run.cls.split(" ").includes("a-b"));

/**
 * @param {Line[]} lines
 * @param {number} limit
 * @param {Map<number, DialogRow>} options
 */
function pickerOptions(lines, limit, options) {
  for (let top = 0; top < limit; top++) {
    if (!PICKER_TITLE.test(lines[top].text)) continue;
    /** @type {DialogRow[]} */
    const runs = [];
    let i = top + 1;
    for (; i < limit; i++) {
      const inner = insideBorders(lines[i]);
      if (!inner) break;
      const next = i + 1 < limit ? insideBorders(lines[i + 1]) : null;
      const last = runs.at(-1);
      if (PICKER_ID_ROW.test(inner.text)) {
        runs.push({ index: i, selected: allBold(inner), number: null, ticked: null, start: 0, end: 0, numbered: false, more: 0, parts: [inner] });
      } else if (last && last.index + last.more + 1 === i && /^ {3}\S/.test(inner.text) && !(PICKER_SECTION_ROW.test(inner.text) && next && PICKER_ID_ROW.test(next.text))) {
        last.more++;
        last.parts.push(inner);
        last.selected = last.selected && allBold(inner);
      }
    }
    if (runs.filter((run) => run.selected).length === 1) {
      for (const run of runs) options.set(run.index, { ...run, parts: run.parts.map(trimStart) });
    }
    top = i;
  }
}

// Rows of a dialog by line index, each with the label's continuation lines. A
// wrapped label of the cursor row is bold on every line. The picker's runs are
// dialog rows too.
/**
 * @param {Line[]} lines
 * @param {number} limit
 */
function dialogOptions(lines, limit) {
  /** @type {DialogRow[]} */
  const found = [];
  let inFence = false;
  for (let i = 0; i < limit; i++) {
    if (isFence(lines[i].text)) inFence = !inFence;
    const row = !inFence && optionRowOf(lines[i]);
    if (row) found.push({ index: i, ...row, more: 0, parts: [] });
  }
  /** @type {Map<number, DialogRow>} */
  const options = new Map();
  /** @type {DialogRow[]} */
  let cluster = [];
  const flush = () => {
    if (cluster.filter((row) => row.numbered).length >= 2 && cluster.some((row) => row.selected)) {
      for (const row of cluster) {
        row.parts = [sliceLine(lines[row.index], row.start, row.end), ...lines.slice(row.index + 1, row.index + 1 + row.more).map(trimStart)];
        options.set(row.index, row);
      }
    }
    cluster = [];
  };
  for (const row of found) {
    const last = cluster.at(-1);
    const between = last ? lines.slice(last.index + 1 + last.more, row.index) : [];
    const joined = between.length <= MAX_DIALOG_GAP && between.every((line) => isBlank(line) || leading(line) >= 2);
    if (!joined) flush();
    if (row.selected) {
      while (
        row.index + 1 + row.more < limit &&
        !isBlank(lines[row.index + 1 + row.more]) &&
        !optionRowOf(lines[row.index + 1 + row.more]) &&
        lines[row.index + 1 + row.more].runs.every((run) => !run.text.trim() || run.cls.split(" ").includes("a-b"))
      ) {
        row.more++;
      }
    }
    cluster.push(row);
  }
  flush();
  pickerOptions(lines, limit, options);
  return options;
}

/**
 * @param {Line[]} lines
 * @param {number} chromeStart
 * @param {Map<number, DialogRow>} options
 * @returns {Kind[]}
 */
function kindsOf(lines, chromeStart, options) {
  const optionLines = new Set([...options.values()].flatMap((row) => Array.from({ length: row.more + 1 }, (_, n) => row.index + n)));
  let inFence = false;
  return lines.map((line, index) => {
    if (index >= chromeStart) return isRule(line.text) ? "rule" : isBoxLine(line.text) ? "box" : "chrome";
    if (optionLines.has(index)) return "option";
    if (isBlank(line)) return "gap";
    if (isRule(line.text)) return "rule";
    if (inFence || isFence(line.text)) {
      if (isFence(line.text)) inFence = !inFence;
      return "code";
    }
    if (line.band) return "band";
    if (isBoxLine(line.text)) return "box";
    return "prose";
  });
}

// Atomic wraps prose to the pane width itself, so one sentence can span several
// lines. A line continues onto the next when it is about as long as a wrapped
// line and doesn't end a sentence; a list item or command starts its own line.
// At most MAX_JOINED_LINES lines join into one paragraph.
const WRAP_MIN_LENGTH = 60;
const MAX_JOINED_LINES = 8;
const ENDS_SENTENCE = /[.!?:;)\]"'`]$/;
const STARTS_ITEM = /^(?:[-•*$>]|\d+[.)])\s/;

/**
 * `line` and `next` are trimmed.
 * @param {string} line
 * @param {string} next
 */
const wrapsOnto = (line, next) => line.length >= WRAP_MIN_LENGTH && !ENDS_SENTENCE.test(line) && !STARTS_ITEM.test(next);

// The rows [start, end) joined into one paragraph.
/**
 * @param {Row[]} rows
 * @param {number} start
 * @param {number} end
 * @returns {Prose}
 */
const joined = (rows, start, end) => ({
  start,
  end,
  runs: rows.slice(start, end).flatMap((part, index) => [...(index ? [{ text: " ", cls: "" }] : []), ...trimStart(part).runs]),
});

/** @param {Row[]} rows */
function proseOf(rows) {
  /** @type {Prose[]} */
  const prose = [];
  for (let start = 0; start < rows.length; ) {
    if (rows[start].kind !== "prose") {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < rows.length && end - start < MAX_JOINED_LINES && rows[end].kind === "prose" && wrapsOnto(rows[end - 1].text.trim(), rows[end].text.trim())) end++;
    prose.push(joined(rows, start, end));
    start = end;
  }
  return prose;
}

// The same wrap rule walked back from the end: row `last` with the rows it
// wraps on from, at most MAX_JOINED_LINES in all. A row of any kind may join;
// the walk stops at a row `stops` says is not to be joined. The Reader reads
// paragraphs forward (`prose`); the Latest line reads the one ending at its
// line, so a long paragraph gives its last rows and a wrap cut by the top of
// the screen still joins.
/**
 * @param {Row[]} rows
 * @param {number} last
 * @param {(row: Row) => boolean} stops
 * @returns {Prose}
 */
export function proseEndingAt(rows, last, stops) {
  let start = last;
  while (start > 0 && last - start < MAX_JOINED_LINES - 1 && !stops(rows[start - 1]) && wrapsOnto(rows[start - 1].text.trim(), rows[start].text.trim())) start--;
  return joined(rows, start, last + 1);
}

// The screen in `text` (herdr's ANSI or plain read). `rows` are styled, each
// end trimmed, without the scrollbar and jump hint, with one blank row in a
// row; on a workflow graph screen they are the rows as drawn. `chromeStart`
// is the first row of Atomic's chrome (rows.length when there is none; 0 on a
// graph screen, which is all Atomic's drawing). `prose` is every paragraph
// above the chrome, and `options` the rows of a question dialog by index.
/**
 * @param {string} text
 * @returns {Screen}
 */
export function readScreen(text) {
  const parsed = parseAnsi(text);
  const graph = showsWorkflowGraph(parsed);
  const lines = graph ? parsed.map(trimEnd) : withoutBlankRuns(withoutScrollbar(parsed).map(withoutJumpHint).map(trimEnd));
  const chromeStart = graph ? 0 : chromeStartIndex(lines.map((line) => line.text));
  const options = dialogOptions(lines, chromeStart);
  const kinds = kindsOf(lines, chromeStart, options);
  const rows = lines.map((line, index) => ({ ...line, kind: kinds[index] }));
  return { rows, chromeStart, graph, prose: proseOf(rows.slice(0, chromeStart)), options };
}
