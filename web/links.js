import { escapeHtml, icon } from "./html.js";

/** @typedef {import("./screen.js").Run} Run */

/** @typedef {"key" | "press"} CopyMode */

const TARGET = /\bhttps?:\/\/[^\s<>"'`]+|(?<![\w.~/-])(?:~|\/tmp|\/home)\/[^\s<>"'`|]*/g;
const TRAILING = /[.,;:!?]/;
/** @type {Record<string, string>} */
const OPENER = { ")": "(", "]": "[", "}": "{" };

/**
 * @param {string} text
 * @param {string} char
 */
const count = (text, char) => text.split(char).length - 1;

/** @param {string} found */
function withoutTrailing(found) {
  let end = found.length;
  for (;;) {
    const char = found[end - 1];
    const kept = found.slice(0, end);
    if (TRAILING.test(char)) end--;
    else if (OPENER[char] && count(kept, char) > count(kept, OPENER[char])) end--;
    else return kept;
  }
}

/**
 * @typedef {{ start: number, end: number, text: string, kind: "url" | "path" }} Target
 */

/**
 * @param {string} text
 * @returns {Target[]}
 */
export function targetsIn(text) {
  /** @type {Target[]} */
  const found = [];
  for (const match of text.matchAll(TARGET)) {
    const kept = withoutTrailing(match[0]);
    const kind = kept.startsWith("http") ? "url" : "path";
    if (kind === "url" ? !/^https?:\/\/[^/]/.test(kept) : !/\/./.test(kept)) continue;
    found.push({ start: match.index, end: match.index + kept.length, text: kept, kind });
  }
  return found;
}

/** @param {string} url */
const linkOpen = (url) => `<a class="a-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">`;

/** @param {string} path */
export const copyKeyHtml = (path) => `<button class="copy-key" type="button" data-copy="${escapeHtml(path)}" aria-label="Copy ${escapeHtml(path)}">copy</button>`;

// The laptop never shows a picture through a hidden folder, so such a path
// gets no way to view it.
/** @param {string} path */
const canView = (path) => /\.(?:png|jpe?g|webp|gif)$/i.test(path) && !/\/\./.test(path);

/** @param {string} path */
const viewKeyHtml = (path) => `<button class="view-key" type="button" data-view="${escapeHtml(path)}" aria-label="View ${escapeHtml(path)}">${icon("i-picture")}view</button>`;

/** @param {string} path */
const pathViewAttributes = (path) => ` data-view="${escapeHtml(path)}" role="button" tabindex="0" aria-label="View ${escapeHtml(path)}"`;

/** @param {string} cls */
const isCode = (cls) => cls.split(" ").includes("a-code");

/**
 * @param {Run[]} runs
 * @param {CopyMode} copy
 */
export function linkedRunsHtml(runs, copy) {
  const text = runs.map((run) => run.text).join("");
  /** @type {[number, number][]} */
  const code = [];
  let offset = 0;
  for (const run of runs) {
    if (isCode(run.cls)) code.push([offset, offset + run.text.length]);
    offset += run.text.length;
  }
  const targets = targetsIn(text).filter((target) => target.kind === "path" || code.every(([from, to]) => to <= target.start || from >= target.end));
  let html = "";
  offset = 0;
  for (const { text: runText, cls } of runs) {
    const runEnd = offset + runText.length;
    const open = cls ? `<span class="${cls}">` : "";
    const close = cls ? "</span>" : "";
    let inner = "";
    let at = offset;
    while (at < runEnd) {
      const target = targets.find((each) => each.end > at && each.start < runEnd);
      const inTarget = target && target.start <= at;
      const pieceEnd = target ? Math.min(runEnd, inTarget ? target.end : target.start) : runEnd;
      const piece = escapeHtml(text.slice(at, pieceEnd));
      if (!target || !inTarget) inner += piece;
      else if (target.kind === "url") inner += `${linkOpen(target.text)}${piece}</a>`;
      else if (copy === "press") inner += `<span class="path" data-copy="${escapeHtml(target.text)}"${canView(target.text) ? pathViewAttributes(target.text) : ""}>${piece}</span>`;
      else inner += piece;
      at = pieceEnd;
      if (inTarget && target.kind === "path" && copy === "key" && target.end === at) {
        html += `${open}${inner}${close}${copyKeyHtml(target.text)}${canView(target.text) ? viewKeyHtml(target.text) : ""}`;
        inner = "";
      }
    }
    if (inner) html += `${open}${inner}${close}`;
    offset = runEnd;
  }
  return html;
}

/**
 * @param {string} text
 * @param {CopyMode} [copy]
 */
export const linkedTextHtml = (text, copy = "key") => linkedRunsHtml([{ text, cls: "" }], copy);

/**
 * @param {HTMLElement} root
 * @param {{ writeText: (text: string) => Promise<void>, announce: (message: string, options?: { error?: boolean }) => void }} options
 */
export function bindCopy(root, { writeText, announce }) {
  /** @param {string} path */
  const copy = (path) =>
    writeText(path).then(
      () => announce(`Copied ${path}`),
      () => announce(`Couldn't copy ${path}.`, { error: true }),
    );
  /**
   * @param {Event} event
   * @param {string} selector
   */
  const pathAt = (event, selector) => /** @type {Element | null} */ (event.target)?.closest(selector)?.getAttribute("data-copy");
  root.addEventListener("click", (event) => {
    const path = pathAt(event, ".copy-key");
    if (path) copy(path);
  });
  root.addEventListener("contextmenu", (event) => {
    const path = pathAt(event, ".path[data-copy]");
    if (!path) return;
    event.preventDefault();
    copy(path);
  });
}

/**
 * The distinct picture paths in `root`, in the order they first appear.
 * @param {ParentNode} root
 */
export const picturePaths = (root) => [...new Set([...root.querySelectorAll("[data-view]")].map((element) => element.getAttribute("data-view") ?? ""))];

const CLICK_AFTER_LONG_PRESS_MS = 1000;

/**
 * @param {HTMLElement} root
 * @param {(trigger: HTMLElement, paths: string[]) => void} open
 */
export function bindView(root, open) {
  /** @param {Event} event */
  const triggerOf = (event) => /** @type {HTMLElement | null | undefined} */ (/** @type {Element | null} */ (event.target)?.closest("[data-view]"));
  /** @type {{ trigger: HTMLElement, at: number } | null} */
  let pressed = null;
  root.addEventListener("contextmenu", (event) => {
    const trigger = triggerOf(event);
    pressed = trigger?.matches(".path") ? { trigger, at: event.timeStamp } : null;
  });
  root.addEventListener("pointerdown", () => {
    pressed = null;
  });
  root.addEventListener("click", (event) => {
    const trigger = triggerOf(event);
    const afterPress = pressed !== null && pressed.trigger === trigger && event.timeStamp - pressed.at < CLICK_AFTER_LONG_PRESS_MS;
    pressed = null;
    if (trigger && !afterPress) open(trigger, picturePaths(root));
  });
  root.addEventListener("keydown", (event) => {
    const trigger = triggerOf(event);
    if (!trigger?.matches(".path") || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    open(trigger, picturePaths(root));
  });
}
