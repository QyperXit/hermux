// Earlier messages above a Terminal's Live screen (Agents only), and the one
// owner of their state. The page tells it three things: a Terminal is open
// (`open`), its Live screen changed (`live`), and it was left (`leave`).
// Behind them: the pages read on a scroll near the top, what scrolls off the
// Live screen added under them (the gap filler, which keeps them joined at the
// Join), the cap, the note, and dropping any answer for a screen that was left
// or reopened. No DOM is touched on import, so the tests can import it.
import { historyHtml, historyNote, messageHtml } from "./history.js";
import { isAtBottom, keepView } from "./scroll.js";
import { describeError } from "./api.js";
import { plainText } from "./screen.js";
import { matchKey } from "./wrap.js";

/**
 * @typedef {import("./history.js").HistoryStatus} HistoryStatus
 * @typedef {import("./types.js").Client} Client
 * @typedef {import("./types.js").HistoryPage} HistoryPage
 * @typedef {import("../server/history").Message} Message
 */

/**
 * @typedef {{
 *   scrollTop: number,
 *   scrollHeight: number,
 *   clientHeight: number,
 *   getBoundingClientRect(): { top: number },
 *   addEventListener(type: "scroll", listener: () => void): void,
 *   removeEventListener(type: "scroll", listener: () => void): void,
 * }} OutputElement
 * @typedef {{
 *   insertAdjacentHTML(where: "afterbegin" | "beforeend", html: string): void,
 *   replaceChildren(): void,
 *   firstElementChild: { remove(): void } | null,
 *   querySelector(selector: string): { outerHTML: string } | null,
 * }} ItemsElement
 */

/**
 * The elements of a Terminal screen that Earlier messages read and write. The
 * page's own elements have all of these members; the tests stand in plain
 * objects. `output` is what scrolls; `region` holds the `note`, the `items`,
 * the `gap` line and the `join` rule above the Live screen.
 * @typedef {{
 *   output: OutputElement,
 *   region: { hidden: HTMLElement["hidden"], dataset: DOMStringMap },
 *   note: { textContent: string | null },
 *   items: ItemsElement,
 *   gap: { hidden: HTMLElement["hidden"] },
 *   join: { getBoundingClientRect(): { top: number } },
 * }} EarlierScreen
 */

/**
 * One open Terminal's Earlier messages. `before` is where the next page
 * starts: undefined before the first page, null at the start of the
 * conversation. `noneScreen` is the Live screen that the last no-match answer
 * was for.
 * @typedef {object} EarlierHistory
 * @property {HistoryStatus} status
 * @property {boolean} loading
 * @property {number | null | undefined} before
 * @property {string} [session]
 * @property {number} count
 * @property {string | null} reason
 * @property {string | null} error
 * @property {GapFiller} gap
 * @property {string | undefined} [noneScreen]
 */

/**
 * The open Terminal. `history` is null for a Shell, and once it is left; a
 * Session switch replaces it. Anything that awaited compares it with the
 * history it started with, so an answer for a Terminal that was left,
 * reopened or reset is dropped.
 * @typedef {{ paneId: string, screen: EarlierScreen, history: EarlierHistory | null }} Opened
 */

// Earlier messages load when the output is scrolled this near its top, and
// at most this many are kept above the Live screen.
const HISTORY_EDGE_PX = 240;
const HISTORY_CAP = 300;
// What scrolled off the Live screen comes in one answer of at most this many.
const GAP_LIMIT = 100;

// Letters and digits of a screen line, without escape codes: what stays the
// same when Atomic redraws or rewraps it (the server matches the same way).
/** @param {string} line */
const lineKey = (line) => matchKey(plainText(line));
const TOP_KEY_MIN = 24;

// What the note says: a retry after a no-match keeps its note. It comes back
// every refresh while the view is at the top, and a flash of "Loading…" each
// time would be noise.
/** @param {Pick<EarlierHistory, "loading" | "status">} earlier */
const noteStatus = (earlier) => (earlier.loading && earlier.status !== "none" ? "loading" : earlier.status);

// Is this page from another Atomic Session than the Earlier messages shown
// (the pane's Session changed)? Its messages must not be joined to theirs.
/**
 * @param {string | undefined} shown
 * @param {string} answered
 */
const switchedSession = (shown, answered) => shown !== undefined && answered !== shown;

// Should the next page be asked for, with `screen` on the Live screen? Not
// when the Earlier messages are all there ("done") or capped. After a no-match
// answer ("none") only when the Live screen has changed since that answer: the
// server answers the same screen the same way, and the pane may match now that
// the Session's latest text is back on screen. So every request after a
// no-match is justified by a changed screen.
/**
 * @param {Pick<EarlierHistory, "status" | "noneScreen">} history
 * @param {string} screen
 */
function shouldAsk(history, screen) {
  if (history.status === "done" || history.status === "capped") return false;
  if (history.status === "none") return history.noneScreen !== screen;
  return true;
}

// Takes the server's answer to a page request made with `screen` on the Live
// screen into the history's bookkeeping (status, cursor, count, the gap
// filler's session and Join). Returns what to do with it:
//   "none"     no match: the status is "none" for this screen; messages already
//              shown stay, and the same cursor is asked again on a changed screen
//   "switched" the pane's Session changed: start again, nothing is joined
//   "skipped"  capped while the page was on its way: it would leave a hole
//   "page"     put `messages` above the ones shown
/**
 * @param {EarlierHistory} history
 * @param {HistoryPage} page
 * @param {string} screen
 * @returns {{ outcome: "none" | "switched" | "skipped" } | { outcome: "page", first: boolean, messages: Message[] }}
 */
function takeAnswer(history, page, screen) {
  if (!page.history) {
    history.status = "none";
    history.reason = page.reason;
    history.noneScreen = screen;
    return { outcome: "none" };
  }
  if (switchedSession(history.session, page.history.session)) return { outcome: "switched" };
  // Capped while this page was on its way: the newest were kept, so this page would leave a hole.
  if (history.status === "capped") return { outcome: "skipped" };
  const { messages, before, join, session } = page.history;
  const first = history.before === undefined;
  if (first) {
    history.session = session;
    history.gap.start(join, session);
  }
  history.count += messages.length;
  history.before = before;
  history.noneScreen = undefined;
  history.status = before === null ? "done" : history.count >= HISTORY_CAP ? "capped" : "idle";
  return { outcome: "page", first, messages };
}

// Did text scroll off the top of the Live screen between two reads? The first
// lines of the old screen (enough of them to be distinctive) are no longer on
// the new one.
/**
 * @param {string} previous
 * @param {string} next
 */
function scrolledOff(previous, next) {
  let top = "";
  for (const line of previous.split("\n")) {
    top += lineKey(line);
    if (top.length >= TOP_KEY_MIN) break;
  }
  if (top.length < TOP_KEY_MIN) return false;
  return !next.split("\n").map(lineKey).join("").includes(top);
}

// Keeps the Earlier messages joined to the Live screen while the Agent works
// on. `read(from)` asks the server for the messages from seq `from` up to the
// screen's new Join. Only a refresh that scrolled text off the screen asks,
// once, from the Join of the last answer, so messages already shown are never
// asked for again. `missing` says a gap could not be filled (no match now, or
// no answer); the next scroll-off tries again from the same Join. More than
// one answer holds, or an answer from another Session (the pane's Session
// changed: /new, /resume, /fork): `reset`, and the Earlier messages start
// again from the new first page, never joined to the old Session's.
/**
 * @typedef {object} GapFiller
 * @property {boolean} missing
 * @property {(first: number | undefined, firstSession: string | undefined) => void} start
 * @property {(previous: string | undefined, next: string) => Promise<{ messages: Message[], reset: boolean } | null>} live
 */

/**
 * @param {(from: number) => Promise<HistoryPage | null>} read
 * @returns {GapFiller}
 */
function gapFiller(read) {
  /** @type {number | undefined} */
  let join;
  /** @type {string | undefined} */
  let session;
  let busy = false;
  let again = false;
  /** @type {GapFiller} */
  const filler = {
    missing: false,
    start(first, firstSession) {
      join = first;
      session = firstSession;
      filler.missing = false;
    },
    async live(previous, next) {
      if (join === undefined || !previous || !scrolledOff(previous, next)) return null;
      if (busy) {
        again = true;
        return null;
      }
      busy = true;
      /** @type {Map<number, Message>} */
      const found = new Map();
      try {
        do {
          again = false;
          /** @type {HistoryPage | null} */
          let page;
          try {
            page = await read(join);
          } catch {
            page = null;
          }
          if (!page?.history) {
            filler.missing = true;
            break;
          }
          if (page.history.session !== session || page.history.before !== null) {
            join = undefined;
            session = undefined;
            filler.missing = false;
            return { messages: [], reset: true };
          }
          for (const message of page.history.messages) found.set(message.seq, message);
          if (page.history.join !== undefined) join = page.history.join;
          filler.missing = false;
        } while (again && join !== undefined);
      } finally {
        busy = false;
      }
      return { messages: [...found.values()].sort((a, b) => a.seq - b.seq), reset: false };
    },
  };
  return filler;
}

// `client` reads the pages. The returned module is the whole interface:
//   open(paneId, kind, screen)  this Terminal's screen is open, as an "agent"
//                               or a "shell"; may be repeated while it stays
//                               open, and again when its kind changes
//   live(text)                  its Live screen shows `text`, drawn and scrolled
//   leave()                     the screen is left, or still shown with its
//                               Terminal gone; nothing more is read, and a page
//                               on its way is dropped (its note says what it
//                               said before that page, not "Loading…")
/**
 * @param {{ client: Pick<Client, "readHistory"> }} page
 */
export function createEarlier({ client }) {
  /** @type {Opened | null} */
  let opened = null;
  // The Live screen as last drawn; null until it first is, and once left.
  /** @type {string | null} */
  let text = null;
  // Where the view went when opening showed the note under a Live screen drawn
  // before the Terminal was known: that scroll isn't the reader's.
  /** @type {number | null} */
  let shownAt = null;

  // The Earlier messages of a newly opened Agent.
  /**
   * @param {string} paneId
   * @returns {EarlierHistory}
   */
  function freshHistory(paneId) {
    return {
      status: "idle",
      loading: false,
      before: undefined,
      session: undefined,
      count: 0,
      reason: null,
      error: null,
      gap: gapFiller((from) => client.readHistory(paneId, { from, limit: GAP_LIMIT })),
    };
  }

  /** @param {Opened} at */
  function renderNote(at) {
    const { region, note } = at.screen;
    const earlier = at.history;
    region.hidden = !earlier || text === null;
    if (!earlier) return;
    const status = noteStatus(earlier);
    region.dataset.status = status;
    note.textContent = historyNote({ ...earlier, status, cap: HISTORY_CAP });
  }

  // When the note first shows or goes, what is on screen doesn't move.
  /** @param {Opened} at */
  function renderNoteKeepingView(at) {
    const { output, region } = at.screen;
    const wasHidden = region.hidden;
    const restore = keepView(output);
    renderNote(at);
    if (region.hidden !== wasHidden) restore();
  }

  // A Shell has no Earlier messages: nothing of them stays on the page.
  /** @param {Opened} at */
  function dropHistory(at) {
    at.screen.items.replaceChildren();
    at.screen.gap.hidden = true;
    at.history = null;
    renderNote(at);
  }

  // The Earlier messages start again: none of the old ones stay on the page.
  /** @param {Opened} at */
  function resetHistory(at) {
    at.screen.items.replaceChildren();
    at.history = freshHistory(at.paneId);
    at.screen.gap.hidden = true;
  }

  // At most HISTORY_CAP Earlier messages: the oldest go first, without moving
  // what is on screen.
  /** @param {Opened} at */
  function trimHistory(at) {
    const earlier = at.history;
    if (!earlier || earlier.count <= HISTORY_CAP) return;
    const { output, items } = at.screen;
    // From the saved position: removing content can clamp scrollTop already.
    const restore = keepView(output, { fromTop: true });
    while (earlier.count > HISTORY_CAP && items.firstElementChild) {
      items.firstElementChild.remove();
      earlier.count--;
    }
    restore();
    earlier.status = "capped";
  }

  // Once Earlier messages are shown, what scrolls off the Live screen is added
  // at their end, so the two stay joined. A partial message comes back whole in
  // its place. What is on screen doesn't move.
  /**
   * @param {Opened} at
   * @param {string | null | undefined} previous the Live screen before this read
   * @param {string} next
   */
  async function fillGap(at, previous, next) {
    const earlier = at.history;
    if (!earlier || typeof previous !== "string") return;
    const result = await earlier.gap.live(previous, next);
    if (!result || at.history !== earlier) return;
    const { output, items, gap, join } = at.screen;
    // Everything here changes what is above the "Live screen" rule. Followed to
    // the bottom, the view stays at the bottom; with the rule above the view,
    // what is in view stays where it is.
    const atBottom = isAtBottom(output);
    const aboveView = join.getBoundingClientRect().top <= output.getBoundingClientRect().top;
    const restore = keepView(output);
    if (result.reset) {
      // Too much to fill, or the pane's Session changed: start the Earlier
      // messages again from the screen, with nothing of the old ones left. A
      // page still on its way is dropped.
      resetHistory(at);
    } else {
      for (const message of result.messages) {
        const shown = items.querySelector(`.h-msg[data-seq="${message.seq}"]`);
        if (shown) {
          shown.outerHTML = messageHtml(message);
        } else {
          items.insertAdjacentHTML("beforeend", messageHtml(message));
          earlier.count++;
        }
      }
    }
    if (at.history) gap.hidden = !at.history.gap.missing;
    if (atBottom) output.scrollTop = output.scrollHeight;
    else if (aboveView) restore();
    else if (result.reset) output.scrollTop = 0;
    trimHistory(at);
    renderNote(at);
    // The view was in the Earlier messages that are gone: load the new ones.
    if (result.reset && output.scrollTop < HISTORY_EDGE_PX) load(at);
  }

  // The next page of Earlier messages, put above the ones already shown
  // without moving what is on screen.
  /** @param {Opened} at */
  async function load(at) {
    const earlier = at.history;
    const shown = text;
    if (!earlier || earlier.loading || shown === null) return;
    if (!shouldAsk(earlier, shown)) return;
    const { output, items } = at.screen;
    earlier.loading = true;
    let restore = keepView(output);
    renderNote(at);
    restore();
    let again = false;
    try {
      const page = await client.readHistory(at.paneId, { before: earlier.before });
      if (at.history !== earlier) return;
      const answer = takeAnswer(earlier, page, shown);
      if (answer.outcome === "switched") {
        // The pane's Session changed since the Earlier messages shown were
        // read: they are dropped, and this one is read from its first page.
        resetHistory(at);
        again = true;
      } else if (answer.outcome === "page") {
        restore = keepView(output);
        items.insertAdjacentHTML("afterbegin", historyHtml(answer.messages));
        restore();
        // A page of only skipped entries goes on to the next one.
        again = !answer.messages.length && earlier.status === "idle";
        // Text that scrolled off while the first page was on its way.
        if (answer.first) fillGap(at, shown, text ?? shown);
      }
    } catch (error) {
      if (at.history !== earlier) return;
      earlier.status = "error";
      earlier.error = describeError(error).message;
    } finally {
      if (at.history === earlier) {
        earlier.loading = false;
        restore = keepView(output);
        renderNote(at);
        restore();
      }
    }
    if (again) load(at);
  }

  // Scrolled near the top of the open screen's output.
  function scrolled() {
    if (!opened) return;
    const { scrollTop } = opened.screen.output;
    const byOpening = scrollTop === shownAt;
    shownAt = null;
    if (!byOpening && scrollTop < HISTORY_EDGE_PX) load(opened);
  }

  /**
   * @param {string} paneId
   * @param {"agent" | "shell"} kind
   * @param {EarlierScreen} screen
   */
  function open(paneId, kind, screen) {
    // Another screen opened: the old one was replaced, so nothing is written to it.
    if (opened && (opened.paneId !== paneId || opened.screen.output !== screen.output)) close();
    const newlyOpened = !opened;
    const at = opened ?? { paneId, screen, history: null };
    if (!opened) {
      opened = at;
      screen.output.addEventListener("scroll", scrolled);
    }
    if (kind === "shell") {
      if (newlyOpened || at.history) dropHistory(at);
    } else if (!at.history) {
      // A screen left and opened again (the Terminal known again) may still show
      // the messages of the first time: they start again, not joined twice.
      resetHistory(at);
      const { output } = screen;
      const before = output.scrollTop;
      renderNoteKeepingView(at);
      shownAt = output.scrollTop === before ? null : output.scrollTop;
    }
  }

  /** @param {string} next */
  function live(next) {
    const previous = text;
    text = next;
    const at = opened;
    if (!at?.history) return;
    renderNoteKeepingView(at);
    // Output too short to scroll is already at its top. After a no-match the
    // pane may match now, so a changed screen asks again while the view sits at
    // the top (load skips an unchanged screen): at most one request per
    // refresh, only then.
    const { output } = at.screen;
    if (output.scrollHeight <= output.clientHeight || (at.history.status === "none" && output.scrollTop < HISTORY_EDGE_PX)) load(at);
    fillGap(at, previous, next);
  }

  // Nothing more is read or drawn: the listener goes, and the history with it,
  // so an answer still on its way finds it gone and writes nothing.
  function close() {
    if (opened) {
      opened.screen.output.removeEventListener("scroll", scrolled);
      opened.history = null;
      opened = null;
    }
    text = null;
    shownAt = null;
  }

  // The screen may still be shown (its Terminal gone): a page on its way is
  // dropped, so the note goes back now to what it said before that page, and
  // doesn't stay at "Loading…". On a screen being replaced this is harmless.
  function leave() {
    const at = opened;
    if (at?.history?.loading) {
      at.history.loading = false;
      const restore = keepView(at.screen.output);
      renderNote(at);
      restore();
    }
    close();
  }

  return { open, live, leave };
}
