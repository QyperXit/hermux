// Live output streaming (D30): a live copy of the screen of each Terminal a
// page is viewing, and its output pushed to those pages as it changes.
//
// While at least one page views a pane, the watcher keeps one read-only
// `terminal session observe` stream of it (server/herdr.ts) and feeds its
// frames into a headless terminal emulator, so the server always holds the
// pane's screen. Frames arrive in bursts, so the screen is looked at once per
// DEBOUNCE_MS; when it really changed, the watcher reads the pane's output the
// way the output endpoint does (`readStyled`) and pushes that text, if it
// differs from the last push. herdr's frames place every row with a cursor
// move, so they can't say where a long line wrapped; the read's
// recent-unwrapped text can, and so the pushed text is byte for byte what a
// poll returns: the Reader, the Join and Earlier messages see no difference.
//
// When the last page stops viewing a pane, its stream stops after GRACE_MS
// (a page that comes back sooner keeps it). A stream that fails or ends is
// opened again with back-off; until it works again, and after a read fails,
// the viewing pages are told to poll that pane as before.
import { Terminal, type IBufferCell } from "@xterm/headless";
import { HerdrError, isRecord, type Frame, type Herdr, type Observation, type Pane } from "./herdr";

// The canvas the stream is observed on. herdr pads a pane's rows to it, or
// clips them: a wide canvas keeps any pane's whole width in view, so a change
// is never cut off. The rows are the pane's own (`pane get`).
export const OBSERVE_COLS = 400;
// herdr's own default canvas height, for a pane that reports no rows.
const DEFAULT_ROWS = 40;

// What a viewing page is told: `output`, the open Terminal's text, as the
// output endpoint returns it; `watch`, whether its output is streamed now
// (true) or the page should poll it (false).
export type WatchEvent = { type: "output"; pane_id: string; text: string } | { type: "watch"; pane_id: string; streaming: boolean };
// A viewing page's connection, as the watcher reaches it.
export type Viewer = (event: WatchEvent) => void;

type Watched = {
  paneId: string;
  viewers: Set<Viewer>;
  term: Terminal | null;
  observation: Observation | null;
  // Counts the streams opened, so a stream that was replaced is ignored.
  runs: number;
  // The screen last looked at, and the text last pushed.
  screen: string | null;
  text: string | null;
  // What the viewing pages were last told.
  streaming: boolean;
  reading: boolean;
  again: boolean;
  wait: number;
  closed: boolean;
  debounce?: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setTimeout>;
  grace?: ReturnType<typeof setTimeout>;
};

const viewportRows = (pane: Pane) => {
  const rows = isRecord(pane.scroll) ? pane.scroll.viewport_rows : undefined;
  return typeof rows === "number" && Number.isInteger(rows) && rows > 0 ? rows : DEFAULT_ROWS;
};

// An SGR parameter list for a cell's style, "" for the default style.
function styleOf(cell: IBufferCell) {
  const codes: string[] = [];
  if (cell.isBold()) codes.push("1");
  if (cell.isDim()) codes.push("2");
  if (cell.isItalic()) codes.push("3");
  if (cell.isUnderline()) codes.push("4");
  if (cell.isBlink()) codes.push("5");
  if (cell.isInverse()) codes.push("7");
  if (cell.isInvisible()) codes.push("8");
  if (cell.isStrikethrough()) codes.push("9");
  if (cell.isOverline()) codes.push("53");
  const colour = (base: number, palette: boolean, rgb: boolean, value: number) => {
    if (palette) codes.push(`${base};5;${value}`);
    else if (rgb) codes.push(`${base};2;${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}`);
  };
  colour(38, cell.isFgPalette(), cell.isFgRGB(), cell.getFgColor());
  colour(48, cell.isBgPalette(), cell.isBgRGB(), cell.getBgColor());
  return codes.join(";");
}

// The emulator's screen as text: one line per row, each style change as an
// SGR reset and the cell's codes, trailing plain blanks and blank rows left
// out. Comparing it tells a frame that changed the screen from one that didn't.
export function screenText(term: Terminal): string {
  const buffer = term.buffer.active;
  const cell = buffer.getNullCell();
  const rows: string[] = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buffer.getLine(buffer.viewportY + y);
    if (!line) break;
    const runs: { style: string; chars: string }[] = [];
    for (let x = 0; x < term.cols; x++) {
      if (!line.getCell(x, cell) || cell.getWidth() === 0) continue;
      const style = styleOf(cell);
      const chars = cell.getChars() || " ";
      const last = runs[runs.length - 1];
      if (last && last.style === style) last.chars += chars;
      else runs.push({ style, chars });
    }
    while (runs.length && runs[runs.length - 1].style === "") {
      const last = runs[runs.length - 1];
      last.chars = last.chars.trimEnd();
      if (last.chars) break;
      runs.pop();
    }
    rows.push(runs.map(({ style, chars }) => `\x1b[0m${style ? `\x1b[${style}m` : ""}${chars}`).join("") + (runs.length ? "\x1b[0m" : ""));
  }
  while (rows.length && rows[rows.length - 1] === "") rows.pop();
  return rows.join("\n");
}

export function createWatcher({
  herdr,
  cols = OBSERVE_COLS,
  debounceMs = 40,
  graceMs = 5_000,
  retryMs = { first: 500, max: 10_000 },
}: {
  herdr: Pick<Herdr, "pane" | "observe" | "readStyled">;
  cols?: number;
  debounceMs?: number;
  graceMs?: number;
  retryMs?: { first: number; max: number };
}) {
  const watched = new Map<string, Watched>();
  // The pane each viewer views: one at a time.
  const viewing = new Map<Viewer, string>();

  const tell = (entry: Watched, event: WatchEvent) => {
    for (const viewer of entry.viewers) viewer(event);
  };

  function setStreaming(entry: Watched, streaming: boolean) {
    if (entry.streaming === streaming) return;
    entry.streaming = streaming;
    tell(entry, { type: "watch", pane_id: entry.paneId, streaming });
  }

  function endStream(entry: Watched) {
    clearTimeout(entry.debounce);
    entry.debounce = undefined;
    entry.observation?.stop();
    entry.observation = null;
    entry.term?.dispose();
    entry.term = null;
    entry.screen = null;
  }

  function close(entry: Watched) {
    entry.closed = true;
    clearTimeout(entry.retry);
    clearTimeout(entry.grace);
    endStream(entry);
    watched.delete(entry.paneId);
  }

  // The stream failed or ended: the pages poll, and it is opened again later.
  function lost(entry: Watched, run: number, error: unknown) {
    if (entry.closed || run !== entry.runs) return;
    endStream(entry);
    setStreaming(entry, false);
    console.error(`Live output: the stream of ${entry.paneId} stopped (${error instanceof Error ? error.message : String(error)}). Retrying.`);
    clearTimeout(entry.retry);
    entry.retry = setTimeout(() => open(entry), entry.wait);
    entry.wait = Math.min(entry.wait * 2, retryMs.max);
  }

  async function open(entry: Watched) {
    const run = ++entry.runs;
    try {
      const rows = viewportRows(await herdr.pane(entry.paneId));
      if (entry.closed || run !== entry.runs) return;
      const term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
      entry.term = term;
      entry.observation = herdr.observe(entry.paneId, { cols, rows }, { frame: (frame) => onFrame(entry, run, term, frame), end: (error) => lost(entry, run, error) });
    } catch (error) {
      lost(entry, run, error);
    }
  }

  function onFrame(entry: Watched, run: number, term: Terminal, frame: Frame) {
    if (entry.closed || run !== entry.runs) return;
    if (frame.width !== term.cols || frame.height !== term.rows) term.resize(frame.width, frame.height);
    term.write(frame.bytes, () => {
      if (entry.closed || run !== entry.runs || entry.debounce) return;
      entry.debounce = setTimeout(() => {
        entry.debounce = undefined;
        look(entry, run, term);
      }, debounceMs);
    });
  }

  // The screen changed since the last look: read the output.
  function look(entry: Watched, run: number, term: Terminal) {
    if (entry.closed || run !== entry.runs) return;
    const screen = screenText(term);
    if (screen === entry.screen) return;
    entry.screen = screen;
    read(entry);
  }

  // One read at a time per pane; a change during a read reads once more after it.
  async function read(entry: Watched) {
    if (entry.reading) {
      entry.again = true;
      return;
    }
    entry.reading = true;
    try {
      do {
        entry.again = false;
        const run = entry.runs;
        try {
          const text = await herdr.readStyled(entry.paneId);
          if (entry.closed || run !== entry.runs || !entry.observation) continue;
          const resumed = !entry.streaming;
          entry.wait = retryMs.first;
          setStreaming(entry, true);
          if (resumed || text !== entry.text) {
            entry.text = text;
            tell(entry, { type: "output", pane_id: entry.paneId, text });
          }
        } catch (error) {
          // Like a failed poll: the pages poll (and show the error), and the
          // next change reads again.
          if (entry.closed || run !== entry.runs) continue;
          entry.screen = null;
          setStreaming(entry, false);
          if (!(error instanceof HerdrError)) console.error(error);
        }
      } while (entry.again && !entry.closed);
    } finally {
      entry.reading = false;
    }
  }

  // Stops viewing the pane the viewer views, if any; with no viewer left, its
  // stream stops after the grace period.
  function unwatch(viewer: Viewer, paneId?: string) {
    const current = viewing.get(viewer);
    if (current === undefined || (paneId !== undefined && paneId !== current)) return;
    viewing.delete(viewer);
    const entry = watched.get(current);
    if (!entry) return;
    entry.viewers.delete(viewer);
    if (entry.viewers.size) return;
    clearTimeout(entry.grace);
    entry.grace = setTimeout(() => close(entry), graceMs);
  }

  return {
    // The viewer now views this pane (and no other). If its output is
    // streamed already, the viewer hears so at once, with the latest text.
    watch(viewer: Viewer, paneId: string) {
      if (viewing.get(viewer) !== paneId) unwatch(viewer);
      viewing.set(viewer, paneId);
      let entry = watched.get(paneId);
      if (!entry) {
        entry = { paneId, viewers: new Set(), term: null, observation: null, runs: 0, screen: null, text: null, streaming: false, reading: false, again: false, wait: retryMs.first, closed: false };
        watched.set(paneId, entry);
        open(entry);
      }
      clearTimeout(entry.grace);
      entry.grace = undefined;
      entry.viewers.add(viewer);
      if (entry.streaming && entry.text !== null) {
        viewer({ type: "watch", pane_id: paneId, streaming: true });
        viewer({ type: "output", pane_id: paneId, text: entry.text });
      }
    },
    unwatch,
    // The panes with a stream, open or being opened again.
    watched: () => [...watched.keys()],
    stop() {
      for (const entry of [...watched.values()]) close(entry);
      viewing.clear();
    },
  };
}

export type Watcher = ReturnType<typeof createWatcher>;
