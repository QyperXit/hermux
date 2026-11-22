import { CONTROL } from "./wrap.js";
import { askQuestion, isTrustTitle, trustQuestion } from "./agent-question.js";
import { isBlank, leading, sliceLine, trimEnd, trimStart } from "./line.js";

export { sliceLine, trimEnd, trimStart };

/**
 * @typedef {{ index?: number, rgb?: number[] }} Colour
 * @typedef {"code" | "accent" | "soft"} Foreground
 * @typedef {"you" | "tool"} Band
 * @typedef {{ bold: boolean, italic: boolean, underline: boolean, inverse: boolean, fg: Foreground | null, bg: Band | null }} Style
 * @typedef {{ text: string, cls: string }} Run
 * @typedef {{ text: string, runs: Run[], band: Band | null }} Line
 */

/**
 * @typedef {"gap" | "option" | "rule" | "code" | "band" | "box" | "prose" | "chrome" | "question"} Kind
 * @typedef {Line & { kind: Kind, chrome: boolean }} Row
 * @typedef {{ selected: boolean, number: string | null, ticked: boolean | null, start: number, end: number, numbered: boolean }} OptionRow
 */
/** @typedef {OptionRow & { index: number, continuationRows: number, labelLines: Line[] }} DialogRow */
/** @typedef {{ start: number, end: number, runs: Run[] }} Prose */
/** @typedef {import("./agent-question.js").Question} Question */
/** @typedef {{ rows: Row[], chromeStart: number, prose: Prose[], options: Map<number, DialogRow>, question: Question | null, atomic0990: boolean, list: { start: number, end: number } | null }} Screen */

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
// for its accent (commands, names, links), 256-colour greys 240-245 for thinking and secondary
// text. Any other colour is ink.
/**
 * @param {Colour} colour
 * @returns {Foreground | null}
 */
function foregroundRole({ rgb, index }) {
  if (same(rgb, 0, 255, 255)) return "code";
  if (same(rgb, 255, 102, 0)) return "accent";
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

/** @param {string} text */
export const plainText = (text) =>
  parseAnsi(text)
    .map((line) => line.text)
    .join("\n");

/** @param {Line[]} lines */
const indicesWithoutBlankRuns = (lines) => lines.flatMap((line, index) => (!isBlank(line) || (index > 0 && !isBlank(lines[index - 1])) ? [index] : []));

/**
 * @template {Line} T
 * @param {T[]} lines
 */
const withoutBlankRuns = (lines) => indicesWithoutBlankRuns(lines).map((index) => lines[index]);

/** @param {string} text */
export const shellRows = (text) => withoutBlankRuns(parseAnsi(text).map(trimEnd));

// Atomic draws a transcript scrollbar (│, with a ┃ or █ thumb) in the last
// column of every row while the transcript is longer than the pane. A panel or
// table row starts with its own box edge, so it isn't one; an empty row is.
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
// screen row, since 0.9.90 "↓ jump to bottom · ctrl+end" or "↓ 3 new messages
// · ctrl+end". In an unwrapped read a long row goes on past that edge, so the
// hint can sit mid-line; whatever follows it is the rest of the overdrawn row.
const JUMP_HINT = /(?:^|\s+)↓ (?:Jump to latest message|jump to bottom|\d+ new messages?)\b.*$/;
/** @param {Line} line */
const withoutJumpHint = (line) => {
  const hint = JUMP_HINT.exec(line.text);
  return hint ? sliceLine(line, 0, hint.index) : line;
};

// A rule: at least 8 of ─━═-, as Atomic draws the prompt box and a Markdown
// rule. Since Atomic 0.9.90 the prompt box's top rule may carry a name at its
// end, e.g. "──── yard ? ─".
const RULE = /^\s*[─━═-]{8,}\s*$/;
const RULE_NAME = String.raw` [^─━═]*[^\s─━═] ─`;
const BOX_TOP_RULE = new RegExp(String.raw`^\s*[─━═-]{8,}(?:${RULE_NAME})?\s*$`);
const NAMED_RULE = new RegExp(String.raw`^\s*[─━═-]{8,}${RULE_NAME}\s*$`);
// Atomic 0.10 names the agent on screen in that rule, "──── asker · ‹its task› ·
// needs input ─"; on a narrow pane with as few as two dashes and the state
// cut, on a long one cut at the pane's edge. It counts only over the prompt.
export const AGENT_RULE = /^\s*[─━═-]{2,} (\S+) · (\S.*?)(?: ─)?\s*$/;
// The top edge of Atomic 0.10's /tasks (0.9.90's /workflows), drawn in the
// prompt box's place, and its key hint ("· esc/← close · ? keys" in /tasks).
const LIST_EDGE = /^\s*▔{8,}\s*$/;
const LIST_HINT = /^\s*↑↓ \S.* · esc(?:\/←)? \S+(?: · \? keys)?\s*$/;
// Atomic 0.9.90's list of runs or 0.10's agent panel, focused with ↓ at the
// prompt, in the prompt box's place: ❯ (0.10: ∀) before the selected row, a
// shell row indented under its subagent, "  ↑ N more" over the rows and
// "  +N more" under them when rows are out of view, over its key hint, the
// hint a warning while a stop or dismiss waits for its second press.
const RUN_LIST_ROW = /^(?:[❯∀] | {2})(?: {2})?\S \S/;
export const RUN_LIST_MORE = /^ {2}(?:↑ \d+|\+\d+) more$/;
const RUN_LIST_HINT = /^(?: {0,2}(?:\S.* · )?esc\/← back to prompt\b| {2}(?:\S.* finished · \S+ to (?:acknowledge|dismiss)|Press \S+ again within 3s to stop \S.*)$)/;
/** @param {string} text */
export const isRule = (text) => RULE.test(text);
/** @param {string} text */
export const isBoxTopRule = (text) => BOX_TOP_RULE.test(text);
export const PROMPT = /^\s*❯/;
/**
 * @param {string[]} texts
 * @param {number} i
 */
const namesAgentOverPrompt = (texts, i) => AGENT_RULE.test(texts[i] ?? "") && PROMPT.test(texts[i + 1] ?? "");
/**
 * @param {string[]} texts
 * @param {number} i
 */
const isPromptTop = (texts, i) => BOX_TOP_RULE.test(texts[i] ?? "") || namesAgentOverPrompt(texts, i);
// Atomic's footer under the prompt box: "(provider) model level • ~/folder (branch)",
// or "provider/model  level • ~/folder (branch)". Atomic 0.9.90 ends every
// footer with "· ? keys", e.g. "esc to interrupt · ? keys" while it works.
const CLASSIC_FOOTER = /^(?:\(\S+\) )?\S+(?: +\S+)? • [~/]/;
const KEYS_FOOTER = /^\s*\S.* · \? keys\s*$/;
export const FOOTER = new RegExp(`${CLASSIC_FOOTER.source}|${KEYS_FOOTER.source}`);
// Atomic 0.9.90's line about the turn, straight over its usage line: while it
// works "∀ Biffing…", "∀ Biffing… (25s)", "∀ Biffing… (1m 3s · ↑ 55 tokens)" or
// "∀ Compacting… (3s · ctrl+c to cancel)", after it "∀ Emancipated for 5s" or
// "∀ Emancipated for 5s · ↓ 1.2m tokens", and since 0.10 its countdown to a
// retry, "∀ Retrying · response timed out · attempt 2/3 in 4s   esc cancel".
const ELAPSED = String.raw`\d+(?:s|m \d+s|h \d+m)`;
const TOKENS = String.raw`[↑↓] [\d.]+[kmbtKMB]? tokens`;
const TURN_META = String.raw`\(${ELAPSED}(?: · ${TOKENS})?(?: · [^()]+)?\)`;
const TURN = new RegExp(
  String.raw`^\s*∀ (?:\S.*?(?:(?:…|\.\.\.)(?: ${TURN_META})?| ${TURN_META})|\p{Lu}[\p{L}'-]* for ${ELAPSED}(?: · ${TOKENS})?|Retrying · \S.*)\s*$`,
  "u",
);
const TURN_ENDING_IN_TOKENS = new RegExp(String.raw`^\s*∀ \S.* · ${TOKENS}\)?\s*$`);

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

/**
 * @param {string[]} texts
 * @param {number} top
 * @returns {number | null}
 */
function listHintAt(texts, top) {
  const hint = texts.findIndex((text, i) => i > top && LIST_HINT.test(text));
  return hint < 0 ? null : hint;
}

/**
 * @param {string[]} texts
 * @param {number} usage
 * @returns {number | null}
 */
function runListHint(texts, usage) {
  let i = usage + 1;
  while (i < texts.length && (RUN_LIST_ROW.test(texts[i]) || RUN_LIST_MORE.test(texts[i]))) i++;
  return i > usage + 1 && i < texts.length && RUN_LIST_HINT.test(texts[i]) ? i : null;
}

/**
 * @param {string[]} texts
 * @param {number} usage
 */
const drawnBy0990 = (texts, usage) => NAMED_RULE.test(texts[usage + 1]) || AGENT_RULE.test(texts[usage + 1]) || texts.slice(usage + 2).some((text) => KEYS_FOOTER.test(text));

/**
 * @param {string[]} texts
 * @param {number} usage
 */
function startsAtTurnLine(texts, usage) {
  if (usage === 0) return false;
  const turn = texts[usage - 1];
  return TURN_ENDING_IN_TOKENS.test(turn) || (TURN.test(turn) && drawnBy0990(texts, usage));
}

/**
 * @param {string[]} texts
 * @param {number} top
 * @returns {number | null}
 */
function rowAfterBox(texts, top) {
  if (!/^\s*╭/.test(texts[top])) return null;
  const bottom = texts.findIndex((text, i) => i > top && /^\s*╰/.test(text));
  return bottom < 0 ? null : bottom + 1;
}

// Atomic's own chrome starts at its usage line, drawn straight above the
// prompt box or the focused agent panel (0.9.90: list of runs), or at the turn
// line over it, and runs to the end: usage line, prompt box, footer, 'esc to
// interrupt', task line, agent panel and hints. A box Atomic draws in the
// prompt box's place, or a list under a ▔ edge (/tasks, 0.9.90's
// /workflows), sits straight under the usage line instead,
// with Atomic's footer somewhere below it or, under a box with the turn line
// over the usage line, nothing at all: that box or list, up to the list's key
// hint, is the screen's content.
/**
 * @param {string[]} texts
 * @returns {{ start: number, inPromptPlace: { start: number, end: number, underEdge: boolean } | null }}
 */
function chromeOf(texts) {
  for (let i = texts.length - 2; i >= 0; i--) {
    if (!isUsage(texts[i])) continue;
    const turnLine = startsAtTurnLine(texts, i);
    const start = turnLine ? i - 1 : i;
    if (isPromptTop(texts, i + 1) || runListHint(texts, i) !== null) return { start, inPromptPlace: null };
    const underEdge = LIST_EDGE.test(texts[i + 1]);
    const end = underEdge ? listHintAt(texts, i + 1) : rowAfterBox(texts, i + 1);
    if (end === null) continue;
    const below = texts.slice(end);
    const closed = below.some((text) => FOOTER.test(text)) || (!underEdge && turnLine && below.every((text) => !text.trim()));
    if (closed) return { start, inPromptPlace: { start: underEdge ? i + 2 : i + 1, end, underEdge } };
  }
  return { start: chromeStartIndex(texts), inPromptPlace: null };
}

// Without a usage line, chrome starts at the last prompt box (a rule, a line
// starting with ❯, any further lines of a draft, and a closing rule) that has
// Atomic's footer under it. Anything of the agent's own above that, rules and ❯
// included, is not chrome.
/** @param {string[]} texts */
function chromeStartIndex(texts) {
  for (let i = texts.length - 1; i > 0; i--) {
    if (!PROMPT.test(texts[i]) || !isPromptTop(texts, i - 1)) continue;
    let end = i + 1;
    while (end < texts.length && !BOX_TOP_RULE.test(texts[end])) end++;
    const below = texts.slice(end + 1).find((text) => text.trim());
    return below && FOOTER.test(below) ? i - 1 : texts.length;
  }
  return texts.length;
}

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

/**
 * @param {boolean[]} chrome
 * @param {number} i
 */
const isContentRow = (chrome, i) => i < chrome.length && !chrome[i];

/**
 * @param {Line[]} lines
 * @param {boolean[]} chrome
 */
function dialogOptions(lines, chrome) {
  /** @type {DialogRow[]} */
  const found = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (chrome[i]) continue;
    if (isFence(lines[i].text)) inFence = !inFence;
    const row = !inFence && optionRowOf(lines[i]);
    if (row) found.push({ index: i, ...row, continuationRows: 0, labelLines: [] });
  }
  /** @type {Map<number, DialogRow>} */
  const options = new Map();
  /** @type {DialogRow[]} */
  let cluster = [];
  const flush = () => {
    if (cluster.filter((row) => row.numbered).length >= 2 && cluster.some((row) => row.selected)) {
      for (const row of cluster) {
        row.labelLines = [sliceLine(lines[row.index], row.start, row.end), ...lines.slice(row.index + 1, row.index + 1 + row.continuationRows).map(trimStart)];
        options.set(row.index, row);
      }
    }
    cluster = [];
  };
  for (const row of found) {
    const last = cluster.at(-1);
    const between = last ? lines.slice(last.index + 1 + last.continuationRows, row.index) : [];
    const joined = between.length <= MAX_DIALOG_GAP && between.every((line) => isBlank(line) || leading(line) >= 2);
    if (!joined) flush();
    if (row.selected) {
      while (
        isContentRow(chrome, row.index + 1 + row.continuationRows) &&
        !isBlank(lines[row.index + 1 + row.continuationRows]) &&
        !optionRowOf(lines[row.index + 1 + row.continuationRows]) &&
        lines[row.index + 1 + row.continuationRows].runs.every((run) => !run.text.trim() || run.cls.split(" ").includes("a-b"))
      ) {
        row.continuationRows++;
      }
    }
    cluster.push(row);
  }
  flush();
  return options;
}

/**
 * @param {Line[]} lines
 * @param {boolean[]} chrome
 * @param {Map<number, DialogRow>} options
 * @param {boolean[]} drawn rows of a list Atomic draws in the prompt box's place, kept as drawn
 * @returns {Kind[]}
 */
function kindsOf(lines, chrome, options, drawn) {
  const optionLines = new Set([...options.values()].flatMap((row) => Array.from({ length: row.continuationRows + 1 }, (_, n) => row.index + n)));
  let inFence = false;
  return lines.map((line, index) => {
    if (chrome[index]) return isRule(line.text) || NAMED_RULE.test(line.text) || AGENT_RULE.test(line.text) || LIST_EDGE.test(line.text) ? "rule" : isBoxLine(line.text) ? "box" : "chrome";
    if (optionLines.has(index)) return "option";
    if (isBlank(line)) return "gap";
    if (drawn[index]) return "box";
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

/**
 * @param {Row[]} rows
 * @param {number} start
 * @param {(row: Row) => boolean} joins
 */
function paragraphEnd(rows, start, joins) {
  let end = start + 1;
  while (end < rows.length && end - start < MAX_JOINED_LINES && joins(rows[end]) && wrapsOnto(rows[end - 1].text.trim(), rows[end].text.trim())) end++;
  return end;
}

/** @param {Row[]} rows */
function proseOf(rows) {
  /** @type {Prose[]} */
  const prose = [];
  for (let start = 0; start < rows.length; ) {
    if (rows[start].kind !== "prose") {
      start++;
      continue;
    }
    const end = paragraphEnd(rows, start, (row) => row.kind === "prose");
    prose.push(joined(rows, start, end));
    start = end;
  }
  return prose;
}

// `rows` as paragraphs, joined where Atomic wrapped them by the same rule.
/**
 * @param {Row[]} rows
 * @returns {Prose[]}
 */
export function wrappedParagraphs(rows) {
  /** @type {Prose[]} */
  const paragraphs = [];
  for (let start = 0; start < rows.length; ) {
    const end = paragraphEnd(rows, start, () => true);
    paragraphs.push(joined(rows, start, end));
    start = end;
  }
  return paragraphs;
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

// The rows of Atomic 0.10's focused agent panel (0.9.90: list of runs),
// above its key hint, or null when it isn't focused.
/**
 * @param {Screen} screen
 * @returns {string[] | null}
 */
export function focusedRuns({ rows, chromeStart }) {
  const texts = rows.map((row) => row.text);
  const usage = texts.findIndex((text, i) => i >= chromeStart && isUsage(text));
  const hint = usage < 0 ? null : runListHint(texts, usage);
  return hint === null ? null : texts.slice(usage + 1, hint);
}

// Atomic 0.9.90 shades the user's own messages with 45,45,48, the shade older
// Atomic gave tool rows, and draws its tool rows unshaded: a "● Bash(…)" row
// (✗ when it failed, ∀ while it runs), then its output under "  ⎿  " and on
// six-space rows. Its "⚛ Context cleared" notice keeps that shade too.
const TOOL_HEAD = /^ [●✗∀] \S/;
const TOOL_CALL = /^ [●✗∀] [\p{L}_][\w-]*\(.*\)(?: · .*)?$/u;
const TOOL_OUTPUT = /^ {3}⎿ /;
const TOOL_MORE = /^ {6}/;
const NOTICE = /^ ⚛ /;

/**
 * @param {Question | null} question
 * @param {number} index
 */
const inQuestion = (question, index) => question !== null && index >= question.start && index < question.end;

/**
 * @param {Line[]} lines
 * @param {boolean[]} chrome
 * @param {Question | null} question
 * @returns {Line[]}
 */
function bandsOf0990(lines, chrome, question) {
  let tool = false;
  return lines.map((line, i) => {
    if (chrome[i] || inQuestion(question, i)) {
      tool = false;
      return line;
    }
    if (line.band) {
      tool = false;
      return line.band === "tool" && !NOTICE.test(line.text) ? { ...line, band: "you" } : line;
    }
    if (TOOL_HEAD.test(line.text)) tool = TOOL_CALL.test(line.text) || TOOL_OUTPUT.test(lines[i + 1]?.text ?? "");
    else if (tool) tool = TOOL_OUTPUT.test(line.text) || (TOOL_MORE.test(line.text) && !isBlank(line));
    return tool ? { ...line, band: "tool" } : line;
  });
}

// Atomic 0.9.90 drew a screen with its question box, or chrome with its
// named rule, "· ? keys" footer, ▔ edge or turn line.
/**
 * @param {Line[]} lines
 * @param {boolean[]} chrome
 * @param {number} chromeStart
 * @param {Question | null} question
 */
const drawnByAtomic0990 = (lines, chrome, chromeStart, question) =>
  question?.form === "ask" ||
  [TURN, TURN_ENDING_IN_TOKENS].some((turn) => turn.test(lines[chromeStart]?.text ?? "")) ||
  lines.some((line, i) => chrome[i] && (NAMED_RULE.test(line.text) || AGENT_RULE.test(line.text) || KEYS_FOOTER.test(line.text) || LIST_EDGE.test(line.text)));

/** @param {Line} line */
const showsCaret = (line) => line.runs.some((run) => run.cls.split(" ").includes("a-inv"));

// Atomic 0.10 keeps its prompt box, footer and agent panel under a
// subagent's question, so while the prompt box names a subagent its question
// box is read at the foot of the rows over the chrome.
/**
 * @param {Line[]} lines
 * @param {boolean[]} caret
 * @param {number} chromeStart
 */
function subagentQuestion(lines, caret, chromeStart) {
  const texts = lines.map((line) => line.text);
  const named = texts.some((_, i) => i >= chromeStart && namesAgentOverPrompt(texts, i));
  return named ? askQuestion(lines.slice(0, chromeStart), caret.slice(0, chromeStart)) : null;
}

// Where Atomic's trust prompt may start: the chrome, or without chrome (as
// `atomic --session …` draws it, with no usage line or footer) the rule over its title.
/**
 * @param {Line[]} lines
 * @param {number} chromeStart
 */
function trustFrom(lines, chromeStart) {
  if (chromeStart < lines.length) return chromeStart;
  for (let i = lines.length - 2; i >= 0; i--) if (isRule(lines[i].text) && isTrustTitle(lines[i + 1].text)) return i;
  return lines.length;
}

// The screen in `text` (herdr's ANSI or plain read). `rows` are styled, each
// end trimmed, without the scrollbar and jump hint, with one blank row in a
// row. A row is `chrome` when it is Atomic's own; `chromeStart` is the first
// such row (rows.length when there is none). `prose` is every paragraph
// outside the chrome, `options` the rows of a question dialog by index,
// `question` Atomic's own question box (0.9.90 on) or trust prompt,
// `atomic0990` whether Atomic 0.9.90 or later drew the screen (its user's
// messages are then the Message Band and its tool rows the Tool Band), and
// `list` the rows of a list Atomic draws on a ▔ edge in the prompt box's
// place (/tasks), up to its key hint.
/**
 * @param {string} text
 * @returns {Screen}
 */
export function readScreen(text) {
  const drawnLines = withoutScrollbar(parseAnsi(text)).map(withoutJumpHint);
  const trimmed = drawnLines.map(trimEnd);
  const kept = indicesWithoutBlankRuns(trimmed);
  const read = kept.map((index) => trimmed[index]);
  const caret = kept.map((index) => showsCaret(drawnLines[index]));
  const { start: chromeStart, inPromptPlace } = chromeOf(read.map((line) => line.text));
  const chrome = read.map((_, index) => index >= chromeStart && !(inPromptPlace && index >= inPromptPlace.start && index < inPromptPlace.end));
  const question = askQuestion(read, caret) ?? subagentQuestion(read, caret, chromeStart) ?? trustQuestion(read, trustFrom(read, chromeStart));
  const atomic0990 = drawnByAtomic0990(read, chrome, chromeStart, question);
  const lines = atomic0990 ? bandsOf0990(read, chrome, question) : read;
  const options = dialogOptions(lines, chrome);
  const list = inPromptPlace?.underEdge ? { start: inPromptPlace.start, end: inPromptPlace.end } : null;
  const drawn = lines.map((_, index) => Boolean(list && index >= list.start && index < list.end));
  const kinds = kindsOf(lines, chrome, options, drawn);
  /** @type {Row[]} */
  const rows = lines.map((line, index) => ({ ...line, kind: inQuestion(question, index) ? "question" : kinds[index], chrome: chrome[index] }));
  return { rows, chromeStart, prose: proseOf(rows), options, question, atomic0990, list };
}
