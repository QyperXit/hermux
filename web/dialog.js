/**
 * @typedef {{ addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void, removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void }} KeyEvents
 * @typedef {{ addEventListener(type: "popstate", listener: () => void): void, removeEventListener(type: "popstate", listener: () => void): void }} BackEvents
 * @typedef {{ readonly state: unknown, pushState(data: unknown, unused: string): void, back(): void }} PageHistory
 */

export const COPIED_MS = 1500;

/** @param {string} path */
export const baseName = (path) => path.slice(path.lastIndexOf("/") + 1) || path;

/**
 * @param {number} at
 * @param {number} count
 * @param {boolean} backwards
 */
export function nextStop(at, count, backwards) {
  return backwards ? (at <= 0 ? count - 1 : at - 1) : at === count - 1 ? 0 : at + 1;
}

/**
 * What a modal dialog drawn in its own layer shares with the others: the page
 * it covers and the layer it is drawn in, each looked up only when used, and
 * Tab kept inside it.
 * @param {{ name: string, page: HTMLElement | null, root: HTMLElement | null, rootName: string }} options
 */
export function dialogLayer({ name, page: pageElement, root: rootElement, rootName }) {
  /** @param {string} what @returns {never} */
  const missing = (what) => {
    throw new Error(`The ${name} has no ${what}.`);
  };
  /** @returns {HTMLElement} */
  const page = () => pageElement ?? missing("page");
  /** @returns {HTMLElement} */
  const root = () => rootElement ?? missing(rootName);

  /**
   * Tab goes round `stops` and Shift+Tab back, and neither leaves the dialog.
   * @param {KeyboardEvent} event
   * @param {HTMLElement[]} stops
   * @returns {boolean} whether there was a stop to go to
   */
  function trapTab(event, stops) {
    event.preventDefault();
    const active = root().ownerDocument.activeElement;
    stops[nextStop(stops.findIndex((stop) => stop === active), stops.length, event.shiftKey)]?.focus();
    return stops.length > 0;
  }

  return { page, root, trapTab };
}
