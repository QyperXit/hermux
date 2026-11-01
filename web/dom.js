// Typed lookups of the page's own elements. The page's markup is its own, so
// the selectors always match what it drew; the element type each lookup gives
// is HTMLElement unless the caller's variable says it is something else (an
// input, a button), as querySelector<E> does. Also the text boxes' fit to
// their text. No DOM is touched on import.

/**
 * The first element in `root` that matches `selector`, or null.
 * @template {Element} [E=HTMLElement]
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {E | null}
 */
export function find(root, selector) {
  return root.querySelector(selector);
}

/**
 * The first element in `root` that matches `selector`; the screen is always
 * drawn with it, so there is one.
 * @template {Element} [E=HTMLElement]
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {E}
 */
export function need(root, selector) {
  /** @type {E | null} */
  const found = root.querySelector(selector);
  if (!found) throw new Error(`The page has no ${selector}.`);
  return found;
}

/**
 * Every element in `root` that matches `selector`.
 * @template {Element} [E=HTMLElement]
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {E[]}
 */
export function findAll(root, selector) {
  /** @type {NodeListOf<E>} */
  const found = root.querySelectorAll(selector);
  return [...found];
}

// A text box grows with its text, up to 160px.
/** @param {{ style: { height: string }, scrollHeight: number }} textarea */
export function fitField(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
}
