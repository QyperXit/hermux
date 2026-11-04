/** @typedef {{ scrollTop: number, scrollHeight: number, clientHeight: number }} Scroller */

const BOTTOM_SLACK_PX = 32;

/** @param {Scroller} el */
export const isAtBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX;

// With `fromTop` it moves from the scrollTop measured now rather than the
// current one, for when removing content can already have clamped scrollTop.
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
