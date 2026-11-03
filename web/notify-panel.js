// The notifications panel (D33) the bell key opens: the state in words, Turn on
// or Turn off, Send test and the last result. It is a modal dialog on the
// switcher sheet's layer: the page behind it is inert, focus stays inside it and
// returns to the bell when it closes. A tap outside or Esc closes it. No DOM is
// touched on import, so the tests can import it.
import { find, findAll, need } from "./dom.js";
import { keysHtml, statusLine } from "./notifications.js";
import { nextRow } from "./sheet.js";

/**
 * @typedef {ReturnType<typeof import("./notifications.js").createNotifications>} Notifications
 * @typedef {{ addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void, removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void }} KeyEvents
 */

const PANEL = `
    <button class="switcher-dim" type="button" tabindex="-1" aria-label="Close notifications"></button>
    <section class="switcher notify-panel" id="notify-panel" role="dialog" aria-modal="true" aria-labelledby="notify-title" tabindex="-1">
      <div class="switcher-head">
        <h2 class="switcher-title" id="notify-title">Notifications</h2>
      </div>
      <div class="notify-body">
        <p class="notify-line"></p>
        <div class="notify-keys"></div>
        <p class="notify-note" role="status" aria-live="polite"></p>
      </div>
    </section>`;

// `page` is the app and `root` the layer the panel is drawn in; both are touched
// only once the panel opens. `keys` is where key presses are heard (the page's
// document).
/**
 * @param {{ page: HTMLElement | null, root: HTMLElement | null, keys: KeyEvents, notifications: Notifications }} options
 */
export function createNotifyPanel({ page: pageElement, root: rootElement, keys, notifications }) {
  /** @returns {HTMLElement} */
  const page = () => pageElement ?? missing("page");
  /** @returns {HTMLElement} */
  const root = () => rootElement ?? missing("notifications root");
  /** @param {string} what @returns {never} */
  const missing = (what) => {
    throw new Error(`The notifications panel has no ${what}.`);
  };

  // The panel while it is open: the bell that opened it, the keys last drawn,
  // and whether focus was on a key that has since been redrawn.
  /** @type {{ trigger: HTMLElement, keys: string, refocus: boolean } | null} */
  let panel = null;

  /** @param {HTMLElement} trigger */
  function open(trigger) {
    if (panel) return;
    panel = { trigger, keys: "", refocus: false };
    trigger.setAttribute("aria-expanded", "true");
    root().hidden = false;
    root().classList.add("is-open");
    root().innerHTML = PANEL;
    page().inert = true;
    need(root(), ".switcher-dim").addEventListener("click", () => close());
    keys.addEventListener("keydown", onKey);
    draw();
    (find(root(), ".act:not(:disabled)") ?? need(root(), ".notify-panel")).focus();
  }

  /** @param {{ restoreFocus?: boolean }} [options] */
  function close({ restoreFocus = true } = {}) {
    const closing = panel;
    if (!closing) return;
    panel = null;
    keys.removeEventListener("keydown", onKey);
    page().inert = false;
    // The header may have been redrawn while the panel was open: the bell on the page now is the one to update.
    const bell = find(page(), ".bell-key") ?? closing.trigger;
    bell.setAttribute("aria-expanded", "false");
    root().hidden = true;
    root().classList.remove("is-open");
    root().replaceChildren();
    if (restoreFocus) bell.focus();
  }

  // The words and the note are changed in place, so the note stays one live
  // region; the keys are redrawn only when they changed, and focus that was on
  // one goes to the key that works, once one does.
  function draw() {
    if (!panel) return;
    const view = notifications.view();
    const line = need(root(), ".notify-line");
    const words = statusLine(view);
    if (line.textContent !== words) line.textContent = words;
    const note = need(root(), ".notify-note");
    if (note.textContent !== view.message) note.textContent = view.message;
    note.classList.toggle("is-error", view.error);
    const keysElement = need(root(), ".notify-keys");
    const html = keysHtml(view);
    if (html !== panel.keys) {
      if (keysElement.contains(root().ownerDocument.activeElement)) panel.refocus = true;
      keysElement.innerHTML = html;
      panel.keys = html;
      for (const key of findAll(keysElement, ".act")) key.addEventListener("click", () => act(key.dataset.action));
    }
    if (panel.refocus) {
      const key = find(keysElement, ".act:not(:disabled)");
      (key ?? need(root(), ".notify-panel")).focus();
      if (key) panel.refocus = false;
    }
  }

  /** @param {string | undefined} action */
  function act(action) {
    if (action === "enable") notifications.enable();
    else if (action === "disable") notifications.disable();
    else if (action === "test") notifications.test();
  }

  // Tab and Shift+Tab go round the keys that work, or stay on the panel.
  /** @param {KeyboardEvent} event */
  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    const enabled = findAll(root(), ".act:not(:disabled)");
    if (!enabled.length) {
      need(root(), ".notify-panel").focus();
      return;
    }
    enabled[nextRow(enabled.findIndex((key) => key === root().ownerDocument.activeElement), enabled.length, event.shiftKey)].focus();
  }

  notifications.subscribe(draw);

  return { open, close, isOpen: () => panel !== null };
}
