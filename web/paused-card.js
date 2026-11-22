import { need } from "./dom.js";

const cardHtml = () => `
      <section class="paused-card" aria-labelledby="paused-card-title" hidden>
        <p class="paused-card-title" id="paused-card-title"><span class="paused-card-heading"><strong>A helper is paused</strong> · send it a message to carry on</span></p>
        <p class="paused-card-note"></p>
        <button class="act act-dark paused-card-open" type="button" aria-busy="false">Show helpers</button>
      </section>`;

const DRAFT = "Atomic's prompt has a draft in it, so Show helpers can't type /tasks. Send or clear the draft first.";
const LISTED = "Tap the paused helper in the list to open it.";

/**
 * @param {HTMLElement} screen the Terminal screen, its controls drawn
 * @param {() => Promise<unknown>} show opens Atomic's /tasks list
 */
export function attachPausedCard(screen, show) {
  need(screen, ".controls").insertAdjacentHTML("afterbegin", cardHtml());
  /** @type {HTMLButtonElement} */
  const button = need(screen, ".paused-card-open");
  let showing = false;
  const busy = (/** @type {boolean} */ on) => {
    showing = on;
    button.disabled = on || button.dataset.draft === "1";
    button.setAttribute("aria-busy", String(on));
  };
  button.addEventListener("click", async () => {
    if (showing || button.dataset.draft === "1") return;
    busy(true);
    try {
      await show();
    } finally {
      busy(false);
    }
  });
}

// The card while only paused helpers are left: "A helper is paused ·
// send it a message to carry on" and Show helpers, which opens /tasks; with
// /tasks on screen its rows are the keys, and with a draft in Atomic's prompt
// the key can't type /tasks, and the card says so.
/**
 * @param {HTMLElement} screen the Terminal screen holding the card
 * @param {{ shown: boolean, listed: boolean, draft: boolean }} state
 */
export function drawPausedCard(screen, { shown, listed, draft }) {
  const card = need(screen, ".paused-card");
  card.hidden = !shown;
  if (!shown) return;
  const note = need(card, ".paused-card-note");
  note.textContent = listed ? LISTED : draft ? DRAFT : "";
  note.hidden = !listed && !draft;
  /** @type {HTMLButtonElement} */
  const button = need(card, ".paused-card-open");
  button.hidden = listed;
  button.dataset.draft = draft ? "1" : "";
  if (button.getAttribute("aria-busy") !== "true") button.disabled = draft;
}
