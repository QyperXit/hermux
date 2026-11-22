import { need } from "./dom.js";
import { escapeHtml } from "./html.js";

/** @typedef {import("./subagents.js").ShownAgent} ShownAgent */

export const stripHtml = () => `
    <div class="subagent-strip" role="group" aria-label="Agent on screen" hidden>
      <p class="subagent-strip-text"><span class="lamp" aria-hidden="true"></span><span class="subagent-strip-words"></span></p>
      <button class="act subagent-strip-back" type="button" aria-busy="false">Back to main</button>
    </div>`;

// What the subagent on screen is doing, from its state in Atomic's panel or
// rule ("needs input · 34s", "paused", "done · 23s", "17s · ↓ 16.6k tokens").
/** @type {[RegExp, string, string][]} */
const STATES = [
  [/^needs input\b/, "is asking", "blocked"],
  [/^paused\b/, "is paused", "idle"],
  [/^stopped\b/, "is stopped", "idle"],
  [/^done\b/, "is done", "done"],
  [/^failed\b/, "failed", "idle"],
  [/^(waiting on \S+)/, "is $1", "idle"],
  [/^\d/, "is working", "working"],
];

/** @param {string | null} state */
function stateOf(state) {
  for (const [pattern, words, lamp] of STATES) {
    const match = state === null ? null : pattern.exec(state);
    if (match) return { words: words.replace("$1", match[1] ?? ""), lamp };
  }
  return { words: "is on screen", lamp: "unknown" };
}

/**
 * @param {HTMLElement} screen the Terminal screen, the strip drawn
 * @param {() => Promise<unknown>} back brings main back to the screen
 */
export function attachSubagentStrip(screen, back) {
  /** @type {HTMLButtonElement} */
  const button = need(screen, ".subagent-strip-back");
  let going = false;
  button.addEventListener("click", async () => {
    if (going) return;
    going = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      await back();
    } finally {
      going = false;
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
    }
  });
}

// While a subagent is on Atomic's main screen: "‹name› is asking · ‹its
// task›" (or its state), and a Back to main key.
/**
 * @param {HTMLElement} screen
 * @param {ShownAgent | null} shown
 */
export function drawSubagentStrip(screen, shown) {
  const strip = need(screen, ".subagent-strip");
  strip.hidden = !shown;
  if (!shown) return;
  const { words, lamp } = stateOf(shown.state);
  need(strip, ".lamp").dataset.status = lamp;
  need(strip, ".subagent-strip-words").innerHTML = `<strong>${escapeHtml(shown.name)}</strong> ${words}${shown.task ? ` · ${escapeHtml(shown.task)}` : ""}`;
}
