// Earlier messages of an Atomic agent's conversation. herdr only returns
// the visible screen for Atomic agents, so the server reads Atomic's own session
// store, READ-ONLY: the SQLite file is opened with `readonly: true` (SQLite's
// SQLITE_OPEN_READONLY), and the only statements here are the two SELECTs below.
// Nothing writes, checkpoints, vacuums or locks it for writing.
//
// Every entry read is an indexed lookup by session_id and seq with a LIMIT
// (the table's primary key). The candidate lookup by folder reads only
// session_sessions, never entry_json, and runs only when a pane is (re)matched;
// a pane with no match is not looked up again until its screen changes.
import { Database } from "bun:sqlite";
import { CONTROL, matchKey } from "../web/wrap.js";
import { HerdrError, isRecord, type Herdr } from "./herdr";

// After the store fails to open, it is not tried again for this long: the
// failure is logged once, and a store that appears later is used after it.
export const STORE_RETRY_MS = 30_000;
const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;
// Raw entries read per query, and at most per walk through a session; a
// request may walk more than once (tool results and other entries are
// skipped, so a page may need several batches).
const BATCH = 100;
const MAX_SCAN = 3000;
// How many sessions in the pane's folder are compared with its screen.
const MAX_CANDIDATES = 40;
// Lines of the latest assistant text are evidence of a match from this many
// letters and digits; lines used to find the join, from this many.
const MATCH_MIN = 24;
const JOIN_MIN = 12;
// Consecutive messages not on screen after which older ones are not checked.
const JOIN_MISSES = 3;
// A tool call is summarised in one line of at most this many characters.
const SUMMARY_MAX = 80;

export type Block = { kind: "text"; text: string } | { kind: "tool"; name: string; summary: string };
export type Message = { seq: number; role: "user" | "assistant"; blocks: Block[]; partial?: true };
// `join`: the seq of the oldest message with a line on the live screen. Asked
// again with `from` set to it, after the screen has moved on, the first page
// holds just the messages from that seq up to the new join: what scrolled off.
export type HistoryPage =
  | { history: { session: string; messages: Message[]; before: number | null; join?: number } }
  | { history: null; reason: "no_match" | "ambiguous" | "unavailable" };

// What a page request may ask for (see `page` below).
export type HistoryQuery = { before?: number; limit?: number; from?: number };

const CANDIDATES_SQL =
  "SELECT id FROM session_sessions WHERE cwd = ?1 ORDER BY internal, modified_at DESC LIMIT ?2";
// Only user and assistant messages come back with their JSON; other entries
// (tool results, images, custom entries) come back as their seq alone.
const ENTRIES_SQL =
  "SELECT seq, CASE WHEN json_extract(entry_json, '$.type') = 'message' AND json_extract(entry_json, '$.message.role') IN ('user', 'assistant') THEN entry_json END AS json " +
  "FROM session_entries WHERE session_id = ?1 AND seq < ?2 ORDER BY seq DESC LIMIT ?3";

export type SessionStore = ReturnType<typeof openSessionStore>;

type EntryRow = { seq: number; json: string | null };
const isEntryRow = (row: unknown): row is EntryRow =>
  isRecord(row) && Number.isSafeInteger(row.seq) && (row.json === null || typeof row.json === "string");

export function openSessionStore(path: string) {
  const db = new Database(path, { readonly: true });
  const candidates = db.query(CANDIDATES_SQL);
  const entries = db.query(ENTRIES_SQL);
  return {
    db,
    // A session whose id isn't text is never a candidate.
    candidates: (cwd: string) => candidates.all(cwd, MAX_CANDIDATES).flatMap((row) => (isRecord(row) && typeof row.id === "string" ? [row.id] : [])),
    // Newest first: entries with seq < before, at most `limit` of them. A row
    // in another shape fails the request like any other store error.
    entriesBefore: (sessionId: string, before: number, limit: number): EntryRow[] => {
      const rows = entries.all(sessionId, before, limit);
      if (!rows.every(isEntryRow)) throw new Error("Atomic's session store returned an entry the server couldn't read.");
      return rows;
    },
    close: () => db.close(),
  };
}

// A markdown link shows its text on screen.
const withoutLinkTargets = (text: string) => text.replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1");
const clean = (text: string) => text.replace(CONTROL, "");

const SUMMARY_KEYS = ["command", "cmd", "path", "file_path", "filePath", "pattern", "query", "url", "urls", "prompt", "description", "task", "message", "action", "name"];

function firstString(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") return value;
  if (depth > 3 || value === null || typeof value !== "object") return undefined;
  for (const item of Object.values(value)) {
    const found = firstString(item, depth + 1);
    if (found) return found;
  }
  return undefined;
}

// The tool's main argument (its command, path, query…) on one line.
function toolSummary(args: unknown): string {
  let text: string | undefined;
  if (isRecord(args)) {
    for (const key of SUMMARY_KEYS) {
      text = firstString(args[key]);
      if (text) break;
    }
  }
  text ??= firstString(args) ?? "";
  const line = clean(text).replace(/\s+/g, " ").trim();
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line;
}

// A user or assistant message as text blocks and one-line tool calls. Thinking
// (and its signature), images and other binary parts are skipped.
function toMessage(seq: number, json: string): Message | null {
  let entry: unknown;
  try {
    entry = JSON.parse(json);
  } catch {
    return null;
  }
  const message = isRecord(entry) ? entry.message : undefined;
  if (!isRecord(message)) return null;
  const { role, content } = message;
  if (role !== "user" && role !== "assistant") return null;
  const parts: unknown[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  const blocks: Block[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      blocks.push({ kind: "text", text: clean(part.text) });
    } else if (part.type === "toolCall" && typeof part.name === "string") {
      blocks.push({ kind: "tool", name: clean(part.name), summary: toolSummary(part.arguments) });
    }
  }
  return blocks.length ? { seq, role, blocks } : null;
}

// A message as units, in order: each line of its text, and each tool call.
type Unit = { block: number; key: string } & ({ kind: "text"; line: string } | { kind: "tool" });

function unitsOf(message: Message): Unit[] {
  return message.blocks.flatMap((block, index): Unit[] =>
    block.kind === "text"
      ? block.text.split("\n").map((line): Unit => ({ block: index, kind: "text", line, key: matchKey(withoutLinkTargets(line)) }))
      : [{ block: index, kind: "tool", key: matchKey(block.summary.replace(/…$/, "")).slice(0, 40) }],
  );
}

// The units of `units[0..end)` as blocks again.
function blocksOf(message: Message, units: Unit[]): Block[] {
  const blocks: Block[] = [];
  let last = -1;
  for (const unit of units) {
    const previous = blocks.at(-1);
    if (unit.kind === "tool") blocks.push(message.blocks[unit.block]);
    else if (unit.block === last && previous?.kind === "text") previous.text += `\n${unit.line}`;
    else blocks.push({ kind: "text", text: unit.line });
    last = unit.block;
  }
  return blocks.filter((block) => block.kind === "tool" || block.text.trim());
}

// The units of a message just above `at` in the screen that are on it too.
// Long lines may be anywhere above; a short line only counts when it ends right
// where the line below it starts (it could be part of any line otherwise). A
// blank line says nothing, and is only on screen with a line above it.
function onScreenFrom(units: Unit[], end: number, at: number, screen: string): number {
  let top = end;
  for (let i = end - 1; i >= 0; i--) {
    const key = units[i].key;
    if (!key) continue;
    const above = screen.slice(0, at);
    const found = key.length >= JOIN_MIN ? above.lastIndexOf(key) : above.endsWith(key) ? at - key.length : -1;
    if (found < 0) break;
    at = found;
    top = i;
  }
  return top;
}

// Is this message on the pane's screen? "yes" when one of its long enough lines
// (or tool calls) is on it, "no" when none is, "unknown" when it has none.
function onScreen(units: Unit[], screen: string): "yes" | "no" | "unknown" {
  const evidence = units.filter((unit) => unit.key.length >= JOIN_MIN);
  if (!evidence.length) return "unknown";
  return evidence.some((unit) => screen.includes(unit.key)) ? "yes" : "no";
}

export function createHistory({ herdr, openStore, now = Date.now }: { herdr: Herdr; openStore: () => SessionStore; now?: () => number }) {
  let store: SessionStore | null = null;
  // When the store last failed to open; null while it hasn't failed since it last opened.
  let failedAt: number | null = null;
  const matches = new Map<string, { cwd: string; session: string }>();
  // Panes with no (or no single) match, and the screen that showed it.
  const unmatched = new Map<string, { cwd: string; screen: string; reason: "no_match" | "ambiguous" }>();

  function getStore(): SessionStore | null {
    if (store) return store;
    if (failedAt !== null && now() - failedAt < STORE_RETRY_MS) return null;
    try {
      store = openStore();
      failedAt = null;
    } catch (error) {
      if (failedAt === null) console.error(`Couldn't open Atomic's session store, so earlier messages are unavailable; trying again every ${STORE_RETRY_MS / 1000} s.`, error);
      failedAt = now();
    }
    return store;
  }

  // Messages newest first, from seq < before, until the start of the session
  // or MAX_SCAN entries. `scanned` is the lowest seq read so far.
  function* walk(s: SessionStore, session: string, before: number, cursor: { scanned: number; atStart: boolean }) {
    let next = before;
    let read = 0;
    while (read < MAX_SCAN) {
      const rows = s.entriesBefore(session, next, BATCH);
      read += rows.length;
      for (const row of rows) {
        cursor.scanned = row.seq;
        const message = row.json === null ? null : toMessage(row.seq, row.json);
        if (message) yield message;
      }
      if (rows.length < BATCH) {
        cursor.atStart = true;
        return;
      }
      next = rows[rows.length - 1].seq;
    }
  }

  // The most recent assistant text of a session, as evidence keys.
  function latestTextKeys(s: SessionStore, session: string): string[] {
    for (const message of walk(s, session, Number.MAX_SAFE_INTEGER, { scanned: 0, atStart: false })) {
      if (message.role !== "assistant") continue;
      const text = message.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n");
      if (!text.trim()) continue;
      const lines = text.split("\n").map((line) => matchKey(withoutLinkTargets(line))).filter((key) => key.length >= MATCH_MIN);
      if (lines.length) return lines;
      const whole = matchKey(withoutLinkTargets(text));
      return whole.length >= JOIN_MIN ? [whole] : [];
    }
    return [];
  }

  const shows = (s: SessionStore, session: string, screen: string) => latestTextKeys(s, session).some((key) => screen.includes(key));

  // The pane's session: the cached one while its latest assistant text is still
  // on screen, else the one session in the pane's folder whose latest assistant
  // text is on screen. None or several: no match.
  function match(s: SessionStore, paneId: string, cwd: string, screen: string): string | "no_match" | "ambiguous" {
    const cached = matches.get(paneId);
    if (cached && cached.cwd === cwd && shows(s, cached.session, screen)) return cached.session;
    matches.delete(paneId);
    const known = unmatched.get(paneId);
    if (known && known.cwd === cwd && known.screen === screen) return known.reason;
    unmatched.delete(paneId);
    const found = s.candidates(cwd).filter((session) => shows(s, session, screen));
    if (found.length !== 1) {
      const reason = found.length ? "ambiguous" : "no_match";
      unmatched.set(paneId, { cwd, screen, reason });
      return reason;
    }
    matches.set(paneId, { cwd, session: found[0] });
    return found[0];
  }

  return {
    // `from`: only messages with this seq or a later one (see `join`).
    async page(paneId: string, { before, limit = DEFAULT_PAGE, from = 0 }: HistoryQuery = {}): Promise<HistoryPage> {
      // The screen is read as the page's output route reads it, with no kind.
      const [agent, text] = await Promise.all([herdr.get(paneId), herdr.read(paneId)]);
      const s = getStore();
      if (!s) return { history: null, reason: "unavailable" };
      const cwd = typeof agent.cwd === "string" ? agent.cwd : "";
      const screen = matchKey(text);
      const session = cwd ? match(s, paneId, cwd, screen) : "no_match";
      if (session === "no_match" || session === "ambiguous") return { history: null, reason: session };

      const cursor = { scanned: before ?? Number.MAX_SAFE_INTEGER, atStart: false };
      const messages: Message[] = [];
      let join: number | undefined;
      // Messages older than the join (or than `before`) until the page is full
      // or `from` is reached.
      const fill = (older: Iterable<Message>) => {
        for (const message of older) {
          if (message.seq < from) {
            cursor.atStart = true;
            return;
          }
          if (messages.length >= limit) return;
          messages.push(message);
        }
      };
      const messagesWalk = walk(s, session, before ?? Number.MAX_SAFE_INTEGER, cursor);
      if (before === undefined) {
        // The join: the screen holds the newest messages, down to the oldest one
        // with a line on it. The first page starts just above that line, so
        // nothing is shown twice; lines of that message above the screen come
        // first, as a partial message.
        let oldest: { message: Message; units: Unit[] } | null = null;
        let misses = 0;
        for (const message of messagesWalk) {
          const units = unitsOf(message);
          const seen = onScreen(units, screen);
          if (seen === "yes") {
            oldest = { message, units };
            misses = 0;
          } else if (oldest && seen === "no" && ++misses >= JOIN_MISSES) {
            break;
          }
        }
        if (!oldest) return { history: null, reason: "no_match" };
        const first = oldest.units.findIndex((unit) => unit.key.length >= JOIN_MIN && screen.includes(unit.key));
        let end = onScreenFrom(oldest.units, first, screen.indexOf(oldest.units[first].key), screen);
        // Blank lines at the bottom of the head add nothing.
        while (end > 0 && !oldest.units[end - 1].key) end--;
        const head = blocksOf(oldest.message, oldest.units.slice(0, end));
        join = oldest.message.seq;
        if (head.length && join >= from) messages.push({ seq: join, role: oldest.message.role, blocks: head, partial: true });
        cursor.atStart = join <= from;
        cursor.scanned = join;
        if (!cursor.atStart) fill(walk(s, session, join, cursor));
      } else {
        fill(messagesWalk);
      }
      // A full page continues below its oldest message; else below what was scanned.
      const full = messages.length >= limit && !cursor.atStart;
      const next = full ? messages[messages.length - 1].seq : cursor.atStart ? null : cursor.scanned;
      return { history: { session, messages: messages.reverse(), before: next, ...(join === undefined ? {} : { join }) } };
    },
  };
}

export function parseHistoryQuery(params: URLSearchParams): HistoryQuery {
  const number = (name: string, max: number) => {
    const value = params.get(name);
    if (value === null) return undefined;
    if (!/^[1-9][0-9]{0,14}$/.test(value) || Number(value) > max) {
      throw new HerdrError("bad_request", `\`${name}\` must be a whole number from 1 to ${max}.`);
    }
    return Number(value);
  };
  return { before: number("before", Number.MAX_SAFE_INTEGER), limit: number("limit", MAX_PAGE), from: number("from", Number.MAX_SAFE_INTEGER) };
}
