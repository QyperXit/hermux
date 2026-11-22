import { need } from "./dom.js";
import { escapeHtml } from "./html.js";

/** @typedef {import("./subagents.js").Waiting} Waiting */

const cardHtml = () => `
      <section class="question-card" aria-labelledby="question-card-title" hidden>
        <p class="question-card-title" id="question-card-title"><span class="lamp" data-status="blocked" aria-hidden="true"></span><span class="question-card-heading"></span></p>
        <p class="question-card-text"></p>
        <p class="question-card-note"></p>
        <button class="act act-dark question-card-open" type="button" aria-busy="false"><span class="question-card-label"></span><span class="visually-hidden question-card-target"></span></button>
      </section>`;

/**
 * @param {HTMLElement} screen the Terminal screen, its controls drawn
 * @param {() => Promise<unknown>} open opens the waiting subagent's chat
 */
export function attachQuestionCard(screen, open) {
  need(screen, ".controls").insertAdjacentHTML("afterbegin", cardHtml());
  /** @type {HTMLButtonElement} */
  const button = need(screen, ".question-card-open");
  let opening = false;
  const showOpening = (/** @type {boolean} */ on) => {
    opening = on;
    button.disabled = on || button.dataset.draft === "1";
    button.setAttribute("aria-busy", String(on));
  };
  button.addEventListener("click", async () => {
    if (opening || button.dataset.draft === "1") return;
    showOpening(true);
    try {
      await open();
    } finally {
      showOpening(false);
    }
  });
}

// The card while a subagent waits for an answer and no question is on the
// screen: "‹name› is asking · ‹its task›", its question when the main chat
// shows it, and one button that opens its chat. While Atomic's prompt holds
// a draft the button can't reach the list of agents, and the card says so.
/**
 * @param {HTMLElement} screen the Terminal screen holding the card
 * @param {Waiting | null} waiting
 * @param {{ target: string, draft: boolean }} state
 */
export function drawQuestionCard(screen, waiting, { target, draft }) {
  const card = need(screen, ".question-card");
  card.hidden = !waiting;
  if (!waiting) return;
  const { name, task, question } = waiting;
  need(card, ".question-card-heading").innerHTML = `<strong>${name ? `${escapeHtml(name)} is asking` : "A subagent is asking"}</strong>${task ? ` · ${escapeHtml(task)}` : ""}`;
  need(card, ".question-card-text").textContent = question ?? "A helper needs your answer before it can carry on.";
  const note = need(card, ".question-card-note");
  note.textContent = draft ? "Atomic's prompt has a draft in it, so this can't reach its list of agents. Send or clear the draft first." : "";
  note.hidden = !draft;
  need(card, ".question-card-label").textContent = name ? `Open ${name}'s question` : "Open the question";
  need(card, ".question-card-target").textContent = ` in ${target}`;
  /** @type {HTMLButtonElement} */
  const button = need(card, ".question-card-open");
  button.dataset.draft = draft ? "1" : "";
  if (button.getAttribute("aria-busy") !== "true") button.disabled = draft;
}
