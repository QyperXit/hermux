import { MAX_ANCHOR_CHARS, MAX_ANCHORS } from "./pipe-table.js";

/**
 * @typedef {import("./types.js").Client} Client
 * @typedef {import("./pipe-table.js").PipeTable} PipeTable
 * @typedef {{ setTimeout: (run: () => void, ms: number) => number, clearTimeout: (id: number) => void }} Timeouts
 */

const SETTLE_MS = 1500;
const MAX_TABLES = 20;
/** @type {PipeTable[]} */
const NONE = [];

/** @param {PipeTable} table */
const tableKey = (table) => JSON.stringify(table);

// The saved copies of an Agent's live box tables. It asks at once for the
// screen a Terminal opens on, and after that only once the Live screen has
// stayed the same for SETTLE_MS, since Atomic saves a message when it ends. An
// anchor asked about is asked about again only after the screen has changed,
// and only while a drawn table still has no saved reading.
//   open(paneId, kind)    this Terminal is open, as an "agent" or a "shell"
//   live(text, anchors, read)  its Live screen shows `text`, these anchors of
//                         drawn tables no saved table reads yet, and the saved
//                         tables its drawn tables are read from
//   tables()              the saved tables found so far, newest first (the
//                         laptop answers newest first), keeping any a drawn
//                         table reads; a new array when more are found
//   leave()               the screen is left; an answer on its way is dropped
/**
 * @param {{ client: Pick<Client, "readSavedTables">, timers: Timeouts, onFound: () => void }} options
 */
export function createSavedTables({ client, timers, onFound }) {
  /** @type {string | null} */
  let paneId = null;
  /** @type {{ text: string, anchors: string[], read: PipeTable[] } | null} */
  let shown = null;
  let found = NONE;
  /** @type {Map<string, string>} */
  let askedOn = new Map();
  let askedBefore = false;
  let asking = false;
  let opening = 0;
  /** @type {number | null} */
  let timer = null;

  const unasked = () =>
    shown ? [...new Set(shown.anchors)].filter((anchor) => anchor.length <= MAX_ANCHOR_CHARS && askedOn.get(anchor) !== shown?.text) : [];

  function cancelSettle() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    cancelSettle();
    if (!paneId || !unasked().length) return;
    if (askedBefore) timer = timers.setTimeout(ask, SETTLE_MS);
    else ask();
  }

  async function ask() {
    timer = null;
    if (asking) {
      schedule();
      return;
    }
    const pane = paneId;
    const asked = opening;
    const text = shown?.text;
    const anchors = unasked()
      .sort((a, b) => Number(askedOn.has(a)) - Number(askedOn.has(b)))
      .slice(0, MAX_ANCHORS);
    if (!pane || text === undefined || !anchors.length) return;
    askedBefore = true;
    asking = true;
    /** @type {PipeTable[]} */
    let answer;
    try {
      answer = (await client.readSavedTables(pane, anchors)).tables;
    } catch {
      answer = [];
    } finally {
      if (asked === opening) asking = false;
    }
    if (asked !== opening) return;
    const known = new Set(found.map(tableKey));
    const answered = new Set(answer.map(tableKey));
    for (const anchor of anchors) askedOn.set(anchor, text);
    if (answer.every((table) => known.has(tableKey(table)))) return;
    const reading = new Set(shown?.read.map(tableKey));
    found = [...answer, ...found.filter((table) => !answered.has(tableKey(table)))].filter(
      (table, index) => index < MAX_TABLES || reading.has(tableKey(table)),
    );
    onFound();
  }

  function leave() {
    cancelSettle();
    opening++;
    paneId = null;
    shown = null;
    found = NONE;
    askedOn = new Map();
    askedBefore = false;
    asking = false;
  }

  return {
    /**
     * @param {string} pane
     * @param {"agent" | "shell"} kind
     */
    open(pane, kind) {
      if (kind === "shell" || (paneId !== null && pane !== paneId)) leave();
      if (kind === "shell" || paneId === pane) return;
      paneId = pane;
      schedule();
    },

    /**
     * @param {string} text
     * @param {string[]} anchors
     * @param {PipeTable[]} [read]
     */
    live(text, anchors, read = []) {
      shown = { text, anchors, read };
      schedule();
    },

    tables: () => found,
    leave,
  };
}
