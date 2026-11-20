// The home screen shows an agent's latest line: the last line of
// its recent output that the agent itself wrote. Atomic draws its own screen
// furniture below that line, and none of it may be shown as the agent's words.
import { questionLine } from "../web/agent-question.js";
import { FOOTER, PROMPT, isBoxTopRule, isRule, isUsage, proseEndingAt, readScreen, type Row } from "../web/screen.js";

const INTERRUPT = /^\s*esc to interrupt\b/;
// One spinner glyph (Atomic's ∀, a braille frame or a star), then a short
// message that ends in an ellipsis, e.g. "∀ Gestating..." or "⠋ Running... (esc Cancel)".
const SPINNER = /^\s*[∀\u2800-\u28ff✢✳✶✻✽]\s+\S.*?(?:\.\.\.|…)(?:\s+\([^)]*\))?\s*$/u;
// Atomic's background-run panel: ╭ BACKGROUND … ╮, │ … │, ╰───╯.
const PANEL = /^\s*[╭│╰].*[╮│╯]\s*$/;
// Atomic's key hints: transcript scroll, a question dialog's keys ("enter
// select · ↑/↓ navigate · esc cancel", or since 0.9.90 "↑↓ select · enter
// choose · esc cancel") and a tool row's expand hints ("(ctrl+o Expand)",
// "Press ctrl+o for live detail").
const HINT = /^\s*(?:↑↓ scroll\b|↑↓ select · .*· esc \S+\s*$|.*\benter select\b.*\besc cancel\b|.*\(.*\bExpand\)\s*$|Press \S+ for live detail\s*$)/;
// The rows Atomic adds to every question dialog itself.
const DIALOG_ROW = /^\s*(?:❯\s*)?\d+\.\s+(?:Type something\.|Chat about this)\s*$/;
// The timer Atomic prints under a finished tool row: "Elapsed 6.0s", "Took 7.8s", "Observed for 10.0s".
const TOOL_TIMER = /^\s*(?:Elapsed|Took|Observed for)\s+\d+(?:\.\d+)?\s*(?:ms|s|m)\s*$/;

const isChrome = (line: string) =>
  !line.trim() ||
  isBoxTopRule(line) ||
  PROMPT.test(line) ||
  INTERRUPT.test(line) ||
  SPINNER.test(line) ||
  FOOTER.test(line) ||
  PANEL.test(line) ||
  HINT.test(line) ||
  DIALOG_ROW.test(line) ||
  TOOL_TIMER.test(line) ||
  isUsage(line);

// Atomic 0.9.90's own notices: the model switched, the context cleared.
const NOTICE = /^\s*(?:Model: \S+\/\S+(?: {2}\S+)?|⚛ Context cleared\b.*)$/;
// Its start banner, from the top of its logo ("… Atomic v0.9.90"): the logo,
// lists such as [Skills], warnings, the update notice and its rules.
const LOGO = /[█░▙▟▛▜]/;
const LOGO_TOP = /[█▙▟] .*\bAtomic v\d+\.\d+\.\d+$/;
const BANNER_LIST = /^\[\w[\w ]*\]$/;
const BANNER_ROW = /^(?:Update Available|New version \S+ is available\b.*|Changelog: .*|Warning: .*)$/;
// A running tool's ticking time, and the expand hint after a row.
const RUNNING_TOOL = /^(\s*∀ \S.*\)) · \d+(?:s|m \d+s|h \d+m)$/;
const EXPAND = /\s+\(ctrl\+o to expand\)$/;

function afterBanner(rows: Row[]): number {
  const top = rows.findIndex((row) => LOGO_TOP.test(row.text));
  if (top < 0) return 0;
  let list = false;
  let i = top;
  for (; i < rows.length; i++) {
    const text = rows[i].text.trim();
    if (!text) list = false;
    else if (BANNER_LIST.test(text)) list = true;
    else if (!list && !LOGO.test(text) && !isRule(text) && !BANNER_ROW.test(text)) break;
  }
  return i;
}

const tidied = (line: string) => line.replace(EXPAND, "").replace(RUNNING_TOOL, "$1");

// The last meaningful line of `herdr agent read` text, without surrounding
// whitespace, or null when the output has none. While Atomic 0.9.90 asks a
// question of its own, the line is that question. On a screen Atomic 0.9.90
// drew its banner and notices are skipped, a tool row is never joined to
// another row, and the expand hint and a running tool's time are dropped.
export function latestLine(text: string): string | null {
  const { rows, chromeStart, question, atomic0990 } = readScreen(text);
  if (question) return questionLine(question);
  const skipped = (row: Row) => isChrome(row.text) || (atomic0990 && NOTICE.test(row.text));
  const stops = (row: Row) => skipped(row) || (atomic0990 && row.band === "tool");
  const first = atomic0990 ? afterBanner(rows) : 0;
  for (let i = chromeStart - 1; i >= first; i--) {
    if (skipped(rows[i])) continue;
    const line = proseEndingAt(rows, i, stops)
      .runs.map((run) => run.text)
      .join("");
    return atomic0990 ? tidied(line) : line;
  }
  return null;
}

export function shellLatestLine(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i].trim();
  return null;
}
