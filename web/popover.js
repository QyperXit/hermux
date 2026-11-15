import { find, need } from "./dom.js";

/**
 * A popover over the message box and the button that opens it. A second tap on
 * the button, Esc or a tap outside closes it, with the focus back on the
 * button unless the tap took the focus somewhere else.
 * @param {object} options
 * @param {() => HTMLElement} options.page the Terminal screen it is on
 * @param {string} options.buttonSelector
 * @param {string} options.popoverSelector
 * @param {(popover: HTMLElement) => HTMLElement} options.first what takes the focus when it opens
 * @param {() => boolean} [options.opening] called before it opens; false keeps it closed
 */
export function createPopover({ page, buttonSelector, popoverSelector, first, opening = () => true }) {
  let isOpen = false;
  /** @type {HTMLElement | null} */
  let outsideTapTarget = null;

  function open() {
    if (!opening()) return;
    const opener = need(page(), buttonSelector);
    const box = need(page(), popoverSelector);
    isOpen = true;
    box.hidden = false;
    opener.setAttribute("aria-expanded", "true");
    first(box).focus();
  }

  /** @param {{ focus?: boolean }} [options] */
  function close({ focus = true } = {}) {
    if (!isOpen) return;
    const opener = need(page(), buttonSelector);
    const box = need(page(), popoverSelector);
    isOpen = false;
    box.hidden = true;
    opener.setAttribute("aria-expanded", "false");
    if (focus) opener.focus();
  }

  /** @param {Event} event */
  function closeOnOutsideTap(event) {
    if (!isOpen) return;
    const opener = find(page(), buttonSelector);
    const box = find(page(), popoverSelector);
    const screenGone = !opener || !box;
    if (screenGone) {
      isOpen = false;
      return;
    }
    const target = /** @type {Element | null} */ (event.target);
    if (box.contains(target) || opener.contains(target)) return;
    close({ focus: false });
    const doc = page().ownerDocument;
    const active = doc.activeElement;
    if (!active || active === doc.body || box.contains(active)) opener.focus();
  }

  return {
    /** Binds it to a newly drawn Terminal screen, closed. */
    attach() {
      const drawn = page();
      isOpen = false;
      if (outsideTapTarget !== drawn) {
        drawn.addEventListener("click", closeOnOutsideTap);
        outsideTapTarget = drawn;
      }
      need(drawn, buttonSelector).addEventListener("click", () => (isOpen ? close() : open()));
      need(drawn, ".composer").addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !isOpen) return;
        event.preventDefault();
        close();
      });
    },
    close,
  };
}
