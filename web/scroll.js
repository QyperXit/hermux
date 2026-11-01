// Scroll arithmetic of the terminal screen's output. Each function takes the
// scrolling element (anything with scrollTop, scrollHeight and clientHeight),
// so the tests pass plain objects. No DOM is touched on import.

/** @typedef {{ scrollTop: number, scrollHeight: number, clientHeight: number }} Scroller */

// Within this many pixels of the end, the view is following the output.
const BOTTOM_SLACK_PX = 32;

/** @param {Scroller} el */
export const isAtBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX;

// Measures the element's height now. The function it returns, called after
// content above the view was added or removed, moves the view by the change,
// so what is on screen stays where it is. With `fromTop` it moves from the
// scrollTop measured now rather than the current one, for when removing
// content can already have clamped scrollTop.
/**
 * @param {Scroller} el
 * @param {{ fromTop?: boolean }} [options]
 * @returns {() => number}
 */
export function keepView(el, { fromTop = false } = {}) {
  const height = el.scrollHeight;
  if (fromTop) {
    const top = el.scrollTop;
    return () => (el.scrollTop = top + el.scrollHeight - height);
  }
  return () => (el.scrollTop += el.scrollHeight - height);
}
