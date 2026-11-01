// Live updates (D20): the server's event stream, and the switch between it and
// polling. No DOM here (the EventSource is passed in), so the tests can import it.
//
// The stream is healthy once the server says herdr's events reach it
// (`live` true). While it is healthy the page doesn't poll the list; when the
// stream errors, or the server says herdr's events stopped, the page polls
// again at once, and stops when the stream is healthy again. The browser
// reconnects a dropped stream by itself; a stream it gave up on (the server
// answered something else) is opened again after REOPEN_MS.

export const EVENTS_PATH = "api/events";
export const REOPEN_MS = 5000;
// EventSource.CLOSED: the browser won't reconnect this one.
const CLOSED = 2;

/**
 * The part of an EventSource the page uses.
 * @typedef {object} EventSourceLike
 * @property {(type: string, listener: (event: MessageEvent) => void) => void} addEventListener
 * @property {() => void} close
 * @property {number} readyState
 */

/**
 * A changed terminal as the server sends it: herdr's pane, status and kind.
 * @typedef {{ pane_id: string, agent_status: string, agent?: string | null }} ChangedTerminal
 * @typedef {{ changed?: ChangedTerminal[], refetch?: boolean, pane_id?: string }} StreamEvent
 */

/** @param {MessageEvent} event @returns {Record<string, unknown>} */
function dataOf(event) {
  try {
    const data = JSON.parse(String(event.data));
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

/**
 * @param {{
 *   open: (path: string) => EventSourceLike,
 *   onHealth: (healthy: boolean) => void,
 *   onEvent: (type: "change" | "output", data: StreamEvent) => void,
 *   reopenMs?: number,
 * }} options
 */
export function createLiveStream({ open, onHealth, onEvent, reopenMs = REOPEN_MS }) {
  /** @type {EventSourceLike | null} */
  let source = null;
  let healthy = false;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let timer = 0;

  /** @param {boolean} next */
  const setHealthy = (next) => {
    if (healthy === next) return;
    healthy = next;
    onHealth(next);
  };

  function start() {
    clearTimeout(timer);
    timer = 0;
    if (source) return;
    const current = open(EVENTS_PATH);
    source = current;
    current.addEventListener("live", (event) => {
      if (source === current) setHealthy(dataOf(event).live === true);
    });
    for (const type of /** @type {const} */ (["change", "output"])) {
      current.addEventListener(type, (event) => {
        if (source === current) onEvent(type, dataOf(event));
      });
    }
    current.addEventListener("error", () => {
      if (source !== current) return;
      setHealthy(false);
      if (current.readyState !== CLOSED) return;
      source = null;
      timer = setTimeout(start, reopenMs);
    });
  }

  // Closes the stream (a hidden page doesn't keep one open) until start().
  function stop() {
    clearTimeout(timer);
    timer = 0;
    source?.close();
    source = null;
    setHealthy(false);
  }

  return { start, stop, isHealthy: () => healthy };
}

// Home's freshness line: "Live" while the stream is healthy, otherwise the
// source and the time of the last refresh, as before.
/** @param {{ streaming: boolean, sample: boolean, time: string }} state */
export function freshnessText({ streaming, sample, time }) {
  if (streaming) return "Live";
  return `${sample ? "Sample data" : "Live"} · ${time}`;
}
