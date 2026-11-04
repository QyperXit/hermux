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
 * @typedef {object} EarlierHistory
 * @property {HistoryStatus} status
 * @property {boolean} loading
 * @property {number | undefined} before
 * @property {boolean} firstPageLoaded
 * @property {string} [session]
 * @property {number} count
 * @property {string | null} reason
 * @property {string | null} error
 * @property {GapFiller} gap
 * @property {string | undefined} [noneScreen]
 */

/**
 * @typedef {{ paneId: string, screen: EarlierScreen, history: EarlierHistory | null }} Opened
 */

const HISTORY_EDGE_PX = 240;
const HISTORY_CAP = 300;
const GAP_LIMIT = 100;

/** @param {string} line */
const lineKey = (line) => matchKey(plainText(line));
const TOP_KEY_MIN = 24;

/** @param {Pick<EarlierHistory, "loading" | "status">} earlier */
const noteStatus = (earlier) => {
  const retryAfterNoMatch = earlier.status === "none";
  return earlier.loading && !retryAfterNoMatch ? "loading" : earlier.status;
};

/**
 * @param {Opened} at
 * @param {EarlierHistory} earlier
 */
const isCurrent = (at, earlier) => at.history === earlier;

/**
 * @param {string | undefined} shown
 * @param {string} answered
 */
const switchedSession = (shown, answered) => shown !== undefined && answered !== shown;

/**
 * @param {Pick<EarlierHistory, "status" | "noneScreen">} history
 * @param {string} screen
 */
function shouldAsk(history, screen) {
  if (history.status === "done" || history.status === "capped") return false;
  const screenChangedSinceNoMatch = history.noneScreen !== screen;
  if (history.status === "none") return screenChangedSinceNoMatch;
  return true;
}

/**
 * @param {EarlierHistory} history
 * @param {HistoryPage} page
 * @param {string} screen
 * @returns {{ outcome: "none" | "switched" | "droppedAfterCap" } | { outcome: "page", first: boolean, messages: Message[] }}
 */
function takeAnswer(history, page, screen) {
  if (!page.history) {
    history.status = "none";
    history.reason = page.reason;
    history.noneScreen = screen;
    return { outcome: "none" };
  }
  if (switchedSession(history.session, page.history.session)) return { outcome: "switched" };
  if (history.status === "capped") return { outcome: "droppedAfterCap" };
  const { messages, before, join, session } = page.history;
  const first = !history.firstPageLoaded;
  if (first) {
    history.session = session;
    history.gap.start(join, session);
  }
  history.count += messages.length;
  history.before = before ?? undefined;
  history.firstPageLoaded = true;
  history.noneScreen = undefined;
  history.status = before === null ? "done" : history.count >= HISTORY_CAP ? "capped" : "idle";
  return { outcome: "page", first, messages };
}

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

/**
 * @typedef {object} GapFiller
 * @property {boolean} lastFillFailed
 * @property {(first: number | undefined, firstSession: string | undefined) => void} start
 * @property {(previous: string | undefined, next: string) => Promise<{ messages: Message[], restartHistory: boolean } | null>} fill
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
    lastFillFailed: false,
    start(first, firstSession) {
      join = first;
      session = firstSession;
      filler.lastFillFailed = false;
    },
    async fill(previous, next) {
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
            filler.lastFillFailed = true;
            break;
          }
          if (page.history.session !== session || page.history.before !== null) {
            join = undefined;
            session = undefined;
            filler.lastFillFailed = false;
            return { messages: [], restartHistory: true };
          }
          for (const message of page.history.messages) found.set(message.seq, message);
          if (page.history.join !== undefined) join = page.history.join;
          filler.lastFillFailed = false;
        } while (again && join !== undefined);
      } finally {
        busy = false;
      }
      return { messages: [...found.values()].sort((a, b) => a.seq - b.seq), restartHistory: false };
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
  /** @type {string | null} */
  let text = null;
  /** @type {number | null} */
  let scrollTopAfterOpening = null;

  /**
   * @param {string} paneId
   * @returns {EarlierHistory}
   */
  function freshHistory(paneId) {
    return {
      status: "idle",
      loading: false,
      before: undefined,
      firstPageLoaded: false,
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

  /** @param {Opened} at */
  function renderNoteKeepingView(at) {
    const { output, region } = at.screen;
    const wasHidden = region.hidden;
    const restore = keepView(output);
    renderNote(at);
    if (region.hidden !== wasHidden) restore();
  }

  /** @param {Opened} at */
  function dropHistory(at) {
    at.screen.items.replaceChildren();
    at.screen.gap.hidden = true;
    at.history = null;
    renderNote(at);
  }

  /** @param {Opened} at */
  function resetHistory(at) {
    at.screen.items.replaceChildren();
    at.history = freshHistory(at.paneId);
    at.screen.gap.hidden = true;
  }

  /** @param {Opened} at */
  function trimHistory(at) {
    const earlier = at.history;
    if (!earlier || earlier.count <= HISTORY_CAP) return;
    const { output, items } = at.screen;
    const restore = keepView(output, { fromTop: true });
    while (earlier.count > HISTORY_CAP && items.firstElementChild) {
      items.firstElementChild.remove();
      earlier.count--;
    }
    restore();
    earlier.status = "capped";
  }

  /**
   * @param {Opened} at
   * @param {string | null | undefined} previous the Live screen before this read
   * @param {string} next
   */
  async function fillGap(at, previous, next) {
    const earlier = at.history;
    if (!earlier || typeof previous !== "string") return;
    const result = await earlier.gap.fill(previous, next);
    if (!result || !isCurrent(at, earlier)) return;
    const { output, items, gap, join } = at.screen;
    const atBottom = isAtBottom(output);
    const aboveView = join.getBoundingClientRect().top <= output.getBoundingClientRect().top;
    const restore = keepView(output);
    if (result.restartHistory) {
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
    if (at.history) gap.hidden = !at.history.gap.lastFillFailed;
    if (atBottom) output.scrollTop = output.scrollHeight;
    else if (aboveView) restore();
    else if (result.restartHistory) output.scrollTop = 0;
    trimHistory(at);
    renderNote(at);
    if (result.restartHistory && output.scrollTop < HISTORY_EDGE_PX) load(at);
  }

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
      if (!isCurrent(at, earlier)) return;
      const answer = takeAnswer(earlier, page, shown);
      if (answer.outcome === "switched") {
        resetHistory(at);
        again = true;
      } else if (answer.outcome === "page") {
        restore = keepView(output);
        items.insertAdjacentHTML("afterbegin", historyHtml(answer.messages));
        restore();
        again = !answer.messages.length && earlier.status === "idle";
        if (answer.first) fillGap(at, shown, text ?? shown);
      }
    } catch (error) {
      if (!isCurrent(at, earlier)) return;
      earlier.status = "error";
      earlier.error = describeError(error).message;
    } finally {
      if (isCurrent(at, earlier)) {
        earlier.loading = false;
        restore = keepView(output);
        renderNote(at);
        restore();
      }
    }
    if (again) load(at);
  }

  function scrolled() {
    if (!opened) return;
    const { scrollTop } = opened.screen.output;
    const byOpening = scrollTop === scrollTopAfterOpening;
    scrollTopAfterOpening = null;
    if (!byOpening && scrollTop < HISTORY_EDGE_PX) load(opened);
  }

  /**
   * @param {string} paneId
   * @param {"agent" | "shell"} kind
   * @param {EarlierScreen} screen
   */
  function open(paneId, kind, screen) {
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
      resetHistory(at);
      const { output } = screen;
      const before = output.scrollTop;
      renderNoteKeepingView(at);
      scrollTopAfterOpening = output.scrollTop === before ? null : output.scrollTop;
    }
  }

  /** @param {string} next */
  function live(next) {
    const previous = text;
    text = next;
    const at = opened;
    if (!at?.history) return;
    renderNoteKeepingView(at);
    const { output } = at.screen;
    const fitsWithoutScrolling = output.scrollHeight <= output.clientHeight;
    const retryAfterNoMatch = at.history.status === "none" && output.scrollTop < HISTORY_EDGE_PX;
    if (fitsWithoutScrolling || retryAfterNoMatch) load(at);
    fillGap(at, previous, next);
  }

  function close() {
    if (opened) {
      opened.screen.output.removeEventListener("scroll", scrolled);
      opened.history = null;
      opened = null;
    }
    text = null;
    scrollTopAfterOpening = null;
  }

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
