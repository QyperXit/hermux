import { need } from "./dom.js";
import { escapeHtml } from "./html.js";
import { OPEN_KEY } from "./workflow-question.js";

/** @typedef {import("./workflow-question.js").WorkflowAsk} WorkflowAsk */

const OPEN_LABEL = "Open the question";

const cardHtml = () => `
      <section class="question-card" aria-labelledby="question-card-title" hidden>
        <p class="question-card-title" id="question-card-title"><span class="lamp" data-status="blocked" aria-hidden="true"></span><span class="question-card-heading"></span></p>
        <p class="question-card-text"></p>
        <p class="question-card-crowded">More than one workflow is running, so this opens the newest one, which may not be the one asking.</p>
        <button class="act act-dark question-card-open" type="button" aria-busy="false">${OPEN_LABEL}<span class="visually-hidden question-card-target"></span></button>
      </section>`;

/**
 * @param {HTMLElement} screen the Terminal screen, its controls drawn
 * @param {(key: string, label: string) => Promise<unknown>} sendKey
 */
export function attachQuestionCard(screen, sendKey) {
  need(screen, ".controls").insertAdjacentHTML("afterbegin", cardHtml());
  /** @type {HTMLButtonElement} */
  const open = need(screen, ".question-card-open");
  let pressing = false;
  const showPressing = (/** @type {boolean} */ on) => {
    pressing = on;
    open.disabled = on;
    open.setAttribute("aria-busy", String(on));
  };
  open.addEventListener("click", async () => {
    if (pressing) return;
    showPressing(true);
    try {
      await sendKey(OPEN_KEY, OPEN_LABEL);
    } finally {
      showPressing(false);
    }
  });
}

/**
 * @param {HTMLElement} screen the Terminal screen holding the card
 * @param {WorkflowAsk | null} ask
 * @param {{ target: string }} state
 */
export function drawQuestionCard(screen, ask, { target }) {
  const card = need(screen, ".question-card");
  card.hidden = !ask;
  if (!ask) return;
  need(card, ".question-card-heading").innerHTML = ask.name ? `<strong>A workflow is asking</strong> (${escapeHtml(ask.name)})` : "<strong>A workflow needs you</strong>";
  const text = need(card, ".question-card-text");
  text.textContent = ask.question ?? "";
  text.hidden = !ask.question;
  need(card, ".question-card-crowded").hidden = !ask.crowded;
  need(card, ".question-card-target").textContent = ` in ${target}`;
}
