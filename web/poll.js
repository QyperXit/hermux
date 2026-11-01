// One poll per target at a time. No DOM here, so the tests can import it.
//
// A call while the poll for the same target is in flight starts no second
// request: it asks for one more run once the current one ends (any number of
// calls make one more run). So requests never pile up on a slow laptop, a
// refresh asked for straight after a send still happens, and an older answer
// can never land after a newer one for the same target. A call for another
// target (another pane, another screen) starts at once; the page drops an
// answer for a target it has left.
//
// The poll answers the promise of the run it started or joined. It is null
// only for a call made from inside the task itself, before the run has begun.
/**
 * @param {() => Promise<void>} task
 * @param {() => string} [targetOf]
 * @returns {() => Promise<void> | null}
 */
export function serialPoll(task, targetOf = () => "") {
  /** @type {Map<string, { again: boolean, done: Promise<void> | null }>} */
  const running = new Map();
  return function poll() {
    const target = targetOf();
    const current = running.get(target);
    if (current) {
      current.again = true;
      return current.done;
    }
    /** @type {{ again: boolean, done: Promise<void> | null }} */
    const entry = { again: true, done: null };
    running.set(target, entry);
    entry.done = (async () => {
      try {
        while (entry.again) {
          entry.again = false;
          await task();
        }
      } finally {
        running.delete(target);
      }
    })();
    return entry.done;
  };
}
