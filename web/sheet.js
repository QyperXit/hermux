import { find, findAll, need } from "./dom.js";
import { closesOnSwipe, hasSwitcher, sheetRowsHtml, sheetTitle, switcherRows } from "./terminals.js";

/**
 * @typedef {import("./types.js").Terminal} Terminal
 * @typedef {import("./types.js").Workspace} Workspace
 */

// The sheet slides out for this long before it is taken off the page.
const SHEET_EXIT_MS = 200;

/**
 * @param {Pick<Terminal, "pane_id">[]} terminals
 * @param {string | undefined} paneId
 */
export function sheetFits(terminals, paneId) {
  return hasSwitcher(terminals) && terminals.some((terminal) => terminal.pane_id === paneId);
}

/**
 * @param {number} at
 * @param {number} count
 * @param {boolean} backwards
 */
export function nextRow(at, count, backwards) {
  return backwards ? (at <= 0 ? count - 1 : at - 1) : at === count - 1 ? 0 : at + 1;
}

/**
 * @param {{
 *   app: HTMLElement | null,
 *   root: HTMLElement | null,
 *   hrefOf: (paneId: string) => string,
 *   onSwap: (paneId: string) => void,
 * }} options
 */
export function createSheet({ app, root: rootElement, hrefOf, onSwap }) {
  /** @returns {HTMLElement} */
  const page = () => app ?? missing("page");
  /** @returns {HTMLElement} */
  const root = () => rootElement ?? missing("switcher root");
  /** @param {string} what @returns {never} */
  const missing = (what) => {
    throw new Error(`The switcher has no ${what}.`);
  };

  /** @type {{ trigger: HTMLElement, html: string } | null} */
  let sheet = null;
  /** @type {Workspace | null} */
  let workspace = null;
  /** @type {string | undefined} */
  let paneId;

  /**
   * @param {Workspace | null} openWorkspace
   * @param {string | undefined} openPaneId
   */
  function open(openWorkspace, openPaneId) {
    workspace = openWorkspace;
    paneId = openPaneId;
    const terminals = workspace?.terminals ?? [];
    if (sheet || !hasSwitcher(terminals)) return;
    const trigger = need(page(), ".terminals-key");
    sheet = { trigger, html: "" };
    trigger.setAttribute("aria-expanded", "true");
    root().classList.remove("is-open", "is-closing");
    root().hidden = false;
    root().innerHTML = `
    <button class="switcher-dim" type="button" tabindex="-1" aria-label="Close terminal list"></button>
    <section class="switcher" id="terminal-switcher" role="dialog" aria-modal="true" aria-labelledby="switcher-title">
      <div class="switcher-head">
        <div class="switcher-grab" aria-hidden="true"></div>
        <h2 class="switcher-title" id="switcher-title"></h2>
      </div>
      <ul class="switcher-list"></ul>
      <p class="switcher-more" aria-hidden="true" hidden></p>
    </section>`;
    page().inert = true;
    draw();
    need(root(), ".switcher-dim").addEventListener("click", () => close());
    need(root(), ".switcher-list").addEventListener("scroll", updateMore, { passive: true });
    need(root(), ".switcher-list").addEventListener("click", onRowClick);
    bindDrag(need(root(), ".switcher"), need(root(), ".switcher-head"), need(root(), ".switcher-list"));
    document.addEventListener("keydown", onKey);
    // One frame after it is in the page, so it slides up from below.
    requestAnimationFrame(() => root().classList.add("is-open"));
    (find(root(), ".pane-row.is-here") ?? find(root(), ".pane-row"))?.focus();
  }

  /** @param {{ restoreFocus?: boolean }} [options] */
  function close({ restoreFocus = true } = {}) {
    const closing = sheet;
    if (!closing) return;
    sheet = null;
    document.removeEventListener("keydown", onKey);
    page().inert = false;
    closing.trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) (find(page(), ".terminals-key") ?? closing.trigger).focus();
    root().classList.remove("is-open");
    root().classList.add("is-closing");
    const done = () => {
      if (sheet) return;
      root().hidden = true;
      root().replaceChildren();
      root().classList.remove("is-closing");
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) done();
    else setTimeout(done, SHEET_EXIT_MS);
  }

  /**
   * @param {Workspace | null} nextWorkspace
   * @param {string | undefined} nextPaneId
   */
  function render(nextWorkspace, nextPaneId) {
    workspace = nextWorkspace;
    paneId = nextPaneId;
    draw();
  }

  function draw() {
    const terminals = workspace?.terminals ?? [];
    if (!sheet) return;
    if (!sheetFits(terminals, paneId)) {
      close();
      return;
    }
    need(root(), ".switcher-title").textContent = sheetTitle(workspace, terminals);
    const list = need(root(), ".switcher-list");
    const html = sheetRowsHtml(switcherRows(terminals, paneId), hrefOf);
    if (html !== sheet.html) {
      const focusedRow = document.activeElement?.closest?.(".pane-row");
      const focused = focusedRow instanceof HTMLElement ? focusedRow.dataset.pane : undefined;
      const top = list.scrollTop;
      list.innerHTML = html;
      list.scrollTop = top;
      sheet.html = html;
      if (focused) find(list, `[data-pane="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    }
    updateMore();
  }

  function updateMore() {
    const list = find(root(), ".switcher-list");
    const more = find(root(), ".switcher-more");
    if (!list || !more) return;
    const bottom = list.getBoundingClientRect().bottom;
    const hidden = findAll(list, ".pane-row").filter((row) => row.getBoundingClientRect().bottom > bottom + 1).length;
    more.hidden = hidden === 0;
    more.textContent = `${hidden} more · scroll`;
  }

  /** @param {Event} event */
  function onRowClick(event) {
    const row = event.target instanceof Element ? event.target.closest(".pane-row") : null;
    if (!(row instanceof HTMLElement)) return;
    event.preventDefault();
    const rowPane = row.dataset.pane;
    if (rowPane === paneId) close();
    else if (rowPane !== undefined) swapTo(rowPane);
  }

  /** @param {string} otherPane */
  function swapTo(otherPane) {
    close({ restoreFocus: false });
    onSwap(otherPane);
  }

  /** @param {KeyboardEvent} event */
  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const rows = findAll(root(), ".pane-row");
    if (!rows.length) return;
    const next = nextRow(rows.findIndex((row) => row === document.activeElement), rows.length, event.shiftKey);
    event.preventDefault();
    rows[next].focus();
  }

  /**
   * @param {HTMLElement} panel
   * @param {HTMLElement} head
   * @param {HTMLElement} list
   */
  function bindDrag(panel, head, list) {
    /** @type {{ y: number, at: number, dy: number } | null} */
    let drag = null;
    /** @param {number} y */
    const begin = (y) => {
      drag = { y, at: performance.now(), dy: 0 };
      panel.classList.add("is-dragging");
    };
    /** @param {number} y */
    const move = (y) => {
      if (!drag) return;
      drag.dy = Math.max(0, y - drag.y);
      panel.style.transform = drag.dy ? `translateY(${drag.dy}px)` : "";
    };
    /** @param {boolean} cancelled */
    const end = (cancelled) => {
      if (!drag) return;
      const shut = !cancelled && closesOnSwipe({ dy: drag.dy, ms: performance.now() - drag.at });
      drag = null;
      panel.classList.remove("is-dragging");
      panel.style.transform = "";
      if (shut) close();
    };
    head.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      head.setPointerCapture(event.pointerId);
      begin(event.clientY);
    });
    head.addEventListener("pointermove", (event) => drag && move(event.clientY));
    head.addEventListener("pointerup", () => end(false));
    head.addEventListener("pointercancel", () => end(true));
    list.addEventListener("touchstart", (event) => {
      if (list.scrollTop <= 0) begin(event.touches[0].clientY);
    }, { passive: true });
    list.addEventListener("touchmove", (event) => {
      if (!drag) return;
      if (event.touches[0].clientY <= drag.y) {
        end(true);
        return;
      }
      event.preventDefault();
      move(event.touches[0].clientY);
    }, { passive: false });
    list.addEventListener("touchend", () => end(false));
    list.addEventListener("touchcancel", () => end(true));
  }

  return { open, close, render };
}
