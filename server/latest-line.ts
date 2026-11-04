// The home screen shows an agent's latest line: the last line of
// its recent output that the agent itself wrote. Atomic draws its own screen
// furniture below that line, and none of it may be shown as the agent's words.
import { FOOTER, PROMPT, isBoxTopRule, isUsage, proseEndingAt, readScreen } from "../web/screen.js";

const INTERRUPT = /^\s*esc to interrupt\b/;
// One spinner glyph (Atomic's ∀, a braille frame or a star), then a short
// message that ends in an ellipsis, e.g. "∀ Gestating..." or "⠋ Running... (esc Cancel)".
const SPINNER = /^\s*[∀\u2800-\u28ff✢✳✶✻✽]\s+\S.*?(?:\.\.\.|…)(?:\s+\([^)]*\))?\s*$/u;
// Atomic's background-run panel: ╭ BACKGROUND … ╮, │ … │, ╰───╯.
const PANEL = /^\s*[╭│╰].*[╮│╯]\s*$/;
// Atomic's key hints: transcript scroll, a question dialog's keys ("enter
// select · ↑/↓ navigate · esc cancel") and a tool row's expand hints ("(ctrl+o
// Expand)", "Press ctrl+o for live detail").
const HINT = /^\s*(?:↑↓ scroll\b|.*\benter select\b.*\besc cancel\b|.*\(.*\bExpand\)\s*$|Press \S+ for live detail\s*$)/;
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

// The last meaningful line of `herdr agent read` text, without surrounding
// whitespace, or null when the output has none.
export function latestLine(text: string): string | null {
  const { rows, chromeStart } = readScreen(text);
  for (let i = chromeStart - 1; i >= 0; i--) {
    if (isChrome(rows[i].text)) continue;
    return proseEndingAt(rows, i, (row) => isChrome(row.text))
      .runs.map((run) => run.text)
      .join("");
  }
  return null;
}

export function shellLatestLine(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i].trim();
  return null;
}
