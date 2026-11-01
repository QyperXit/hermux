// Earlier messages from Atomic's session store, drawn in the Reader's
// style above the live screen. The server sends each message as text blocks
// (the agent's markdown, or the user's own words) and one-line tool calls. Every
// piece of text is HTML-escaped, so a message can never add markup. Drawing
// only: when they load is web/earlier.js. No DOM here, so the tests can import it.
import { MAX_INDENT_CH, escapeHtml } from "./html.js";

/**
 * @typedef {import("../server/history").Message} Message
 * @typedef {import("../server/history").Block} Block
 */

const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|(\d+[.)]))\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

// Inline markdown: code spans become chips, **bold**, *italic* and _italic_
// keep their emphasis, and a [link](url) shows its text as a link does on the
// live screen. Anything else is plain text.
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|\b_([^_\s][^_]*)_\b|\[([^\]]+)\]\(([^)\s]*)\)/g;

/** @param {string} text */
function inlineHtml(text) {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    html += escapeHtml(text.slice(last, match.index));
    const [, code, bold, bold2, italic, italic2, linkText] = match;
    if (code !== undefined) html += `<span class="a-code">${escapeHtml(code)}</span>`;
    else if (bold !== undefined || bold2 !== undefined) html += `<span class="a-b">${escapeHtml(bold ?? bold2)}</span>`;
    else if (italic !== undefined || italic2 !== undefined) html += `<span class="a-i">${escapeHtml(italic ?? italic2)}</span>`;
    else html += `<span class="a-link">${escapeHtml(linkText)}</span>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

/** @param {number} ch */
const indentStyle = (ch) => (ch > 0 ? ` style="margin-left:${Math.min(ch, MAX_INDENT_CH)}ch"` : "");
/** @param {string[]} rows */
const monoBlock = (rows) => `<div class="block">${rows.map(escapeHtml).join("\n")}</div>`;

// The agent's markdown as Reader prose: paragraphs (its soft wraps joined),
// hanging list items, bold headings, 1px rules, and code blocks and tables in
// one mono block that scrolls sideways.
/** @param {string} text */
export function markdownHtml(text) {
  const lines = text.split("\n");
  /** @type {string[]} */
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heading = HEADING.exec(line);
    const item = LIST_ITEM.exec(line);
    if (FENCE.test(line)) {
      const rows = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) rows.push(lines[i++]);
      i++;
      html.push(monoBlock(rows));
    } else if (TABLE_ROW.test(line)) {
      const rows = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(lines[i++].trim());
      html.push(monoBlock(rows));
    } else if (!line.trim()) {
      if (html.length && html.at(-1) !== `<div class="gap"></div>`) html.push(`<div class="gap"></div>`);
      i++;
    } else if (RULE.test(line)) {
      html.push(`<hr class="output-rule">`);
      i++;
    } else if (heading) {
      html.push(`<p class="p"><span class="a-b">${inlineHtml(heading[1])}</span></p>`);
      i++;
    } else if (item) {
      const [, indent, number, rest] = item;
      html.push(`<p class="p li"${indentStyle(indent.length)}>${escapeHtml(number ?? "•")} ${inlineHtml(rest)}</p>`);
      i++;
    } else {
      // A paragraph runs until a blank line or a line that starts something else.
      const joined = [line.match(QUOTE)?.[1] ?? line.trim()];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        ![FENCE, TABLE_ROW, RULE, HEADING, LIST_ITEM].some((pattern) => pattern.test(lines[i]))
      ) {
        joined.push(lines[i].match(QUOTE)?.[1] ?? lines[i].trim());
        i++;
      }
      html.push(`<p class="p">${inlineHtml(joined.join(" "))}</p>`);
    }
  }
  return html.join("");
}

// The user's own words keep their line breaks, on the "you" band.
/** @param {string} text */
const userHtml = (text) =>
  text
    .split("\n")
    .map((line) => (line.trim() ? `<p class="p">${escapeHtml(line)}</p>` : ""))
    .join("");

/** @param {{ name: string, summary: string }} block */
const toolRowHtml = ({ name, summary }) =>
  `<div class="line"><span class="a-b">${escapeHtml(name)}</span>${summary ? ` ${escapeHtml(summary)}` : ""}</div>`;

// One message: the user's on the "you" band, the agent's as prose with its tool
// calls on the tool band, one line each.
/** @param {Message} message */
export function messageHtml({ seq, role, blocks }) {
  /** @type {string[]} */
  const html = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind === "tool") {
      /** @type {string[]} */
      const rows = [];
      let tool = blocks[i];
      while (tool?.kind === "tool") {
        rows.push(toolRowHtml(tool));
        tool = blocks[++i];
      }
      i--;
      html.push(`<div class="band band-tool">${rows.join("")}</div>`);
    } else if (role === "user") {
      html.push(`<div class="band band-you">${userHtml(block.text)}</div>`);
    } else {
      html.push(markdownHtml(block.text));
    }
  }
  return `<div class="h-msg" data-seq="${Number(seq)}">${html.join("")}</div>`;
}

/** @param {Message[]} messages */
export const historyHtml = (messages) => messages.map(messageHtml).join("");

/**
 * @typedef {"idle" | "done" | "capped" | "error" | "none"} HistoryStatus
 */

// What the line at the top of the earlier messages says.
/**
 * @param {{ status: HistoryStatus | "loading", reason?: string | null, error?: string | null, count: number, cap: number }} note
 */
export function historyNote({ status, reason, error, count, cap }) {
  if (status === "loading") return "Loading earlier messages…";
  if (status === "done") return count ? "Start of the conversation" : "No earlier messages";
  if (status === "capped") return `Showing the ${cap} earlier messages nearest the screen`;
  if (status === "error") return `Earlier messages not loaded. ${error} Scroll up to try again.`;
  if (status === "none") {
    // With messages already shown, a no-match on an older page doesn't mean there are none.
    const lead = count ? "Earlier messages unavailable" : "No earlier messages";
    return reason === "unavailable" ? `${lead}: the laptop can't read Atomic's sessions.` : `${lead}: this pane's Atomic session wasn't found.`;
  }
  return "Scroll up for earlier messages";
}
