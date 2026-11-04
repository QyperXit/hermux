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

export const STORE_RETRY_MS = 30_000;
const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;
const BATCH = 100;
const MAX_SCAN = 3000;
const MAX_CANDIDATES = 40;
const MATCH_MIN_KEY_CHARS = 24;
const JOIN_MIN_KEY_CHARS = 12;
const JOIN_MISSES = 3;
const SUMMARY_MAX = 80;

export type Block = { kind: "text"; text: string } | { kind: "tool"; name: string; summary: string };
export type Message = { seq: number; role: "user" | "assistant"; blocks: Block[]; partial?: true };
// `join`: the seq of the oldest message with a line on the live screen. Asked
// again with `from` set to it, after the screen has moved on, the first page
// holds just the messages from that seq up to the new join: what scrolled off.
export type HistoryPage =
  | { history: { session: string; messages: Message[]; before: number | null; join?: number } }
  | { history: null; reason: "no_match" | "ambiguous" | "unavailable" };

export type HistoryQuery = { before?: number; limit?: number; from?: number };

const CANDIDATES_SQL =
  "SELECT id FROM session_sessions WHERE cwd = ?1 ORDER BY internal, modified_at DESC LIMIT ?2";
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
    candidates: (cwd: string) => candidates.all(cwd, MAX_CANDIDATES).flatMap((row) => (isRecord(row) && typeof row.id === "string" ? [row.id] : [])),
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

type Unit = { block: number; key: string } & ({ kind: "text"; line: string } | { kind: "tool" });

function unitsOf(message: Message): Unit[] {
  return message.blocks.flatMap((block, index): Unit[] =>
    block.kind === "text"
      ? block.text.split("\n").map((line): Unit => ({ block: index, kind: "text", line, key: matchKey(withoutLinkTargets(line)) }))
      : [{ block: index, kind: "tool", key: matchKey(block.summary.replace(/…$/, "")).slice(0, 40) }],
  );
}

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

function foundAbove(key: string, screen: string, at: number): number {
  const above = screen.slice(0, at);
  if (key.length >= JOIN_MIN_KEY_CHARS) return above.lastIndexOf(key);
  return above.endsWith(key) ? at - key.length : -1;
}

function onScreenFrom(units: Unit[], end: number, at: number, screen: string): number {
  let top = end;
  for (let i = end - 1; i >= 0; i--) {
    const key = units[i].key;
    if (!key) continue;
    const found = foundAbove(key, screen, at);
    if (found < 0) break;
    at = found;
    top = i;
  }
  return top;
}

function onScreen(units: Unit[], screen: string): "yes" | "no" | "unknown" {
  const evidence = units.filter((unit) => unit.key.length >= JOIN_MIN_KEY_CHARS);
  if (!evidence.length) return "unknown";
  return evidence.some((unit) => screen.includes(unit.key)) ? "yes" : "no";
}

function findJoin(messages: Iterable<Message>, screen: string): { message: Message; head: Block[] } | null {
  let oldest: { message: Message; units: Unit[] } | null = null;
  let misses = 0;
  for (const message of messages) {
    const units = unitsOf(message);
    const seen = onScreen(units, screen);
    if (seen === "yes") {
      oldest = { message, units };
      misses = 0;
    } else if (oldest && seen === "no" && ++misses >= JOIN_MISSES) {
      break;
    }
  }
  if (!oldest) return null;
  const first = oldest.units.findIndex((unit) => unit.key.length >= JOIN_MIN_KEY_CHARS && screen.includes(unit.key));
  let end = onScreenFrom(oldest.units, first, screen.indexOf(oldest.units[first].key), screen);
  while (end > 0 && !oldest.units[end - 1].key) end--;
  return { message: oldest.message, head: blocksOf(oldest.message, oldest.units.slice(0, end)) };
}

type ScanCursor = { lowestSeqRead: number; reachedSessionStart: boolean };

export function createHistory({ herdr, openStore, now = Date.now }: { herdr: Herdr; openStore: () => SessionStore; now?: () => number }) {
  let store: SessionStore | null = null;
  let failedAt: number | null = null;
  const matches = new Map<string, { cwd: string; session: string }>();
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

  function* walk(s: SessionStore, session: string, before: number, cursor: ScanCursor) {
    let next = before;
    let read = 0;
    while (read < MAX_SCAN) {
      const rows = s.entriesBefore(session, next, BATCH);
      read += rows.length;
      for (const row of rows) {
        cursor.lowestSeqRead = row.seq;
        const message = row.json === null ? null : toMessage(row.seq, row.json);
        if (message) yield message;
      }
      if (rows.length < BATCH) {
        cursor.reachedSessionStart = true;
        return;
      }
      next = rows[rows.length - 1].seq;
    }
  }

  function latestTextKeys(s: SessionStore, session: string): string[] {
    for (const message of walk(s, session, Number.MAX_SAFE_INTEGER, { lowestSeqRead: 0, reachedSessionStart: false })) {
      if (message.role !== "assistant") continue;
      const text = message.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n");
      if (!text.trim()) continue;
      const lines = text.split("\n").map((line) => matchKey(withoutLinkTargets(line))).filter((key) => key.length >= MATCH_MIN_KEY_CHARS);
      if (lines.length) return lines;
      const whole = matchKey(withoutLinkTargets(text));
      return whole.length >= JOIN_MIN_KEY_CHARS ? [whole] : [];
    }
    return [];
  }

  const shows = (s: SessionStore, session: string, screen: string) => latestTextKeys(s, session).some((key) => screen.includes(key));

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
      const [agent, text] = await Promise.all([herdr.get(paneId), herdr.read(paneId)]);
      const s = getStore();
      if (!s) return { history: null, reason: "unavailable" };
      const cwd = typeof agent.cwd === "string" ? agent.cwd : "";
      const screen = matchKey(text);
      const session = cwd ? match(s, paneId, cwd, screen) : "no_match";
      if (session === "no_match" || session === "ambiguous") return { history: null, reason: session };

      const cursor: ScanCursor = { lowestSeqRead: before ?? Number.MAX_SAFE_INTEGER, reachedSessionStart: false };
      const messages: Message[] = [];
      let join: number | undefined;
      const fill = (older: Iterable<Message>) => {
        for (const message of older) {
          if (message.seq < from) {
            cursor.reachedSessionStart = true;
            return;
          }
          if (messages.length >= limit) return;
          messages.push(message);
        }
      };
      const messagesWalk = walk(s, session, before ?? Number.MAX_SAFE_INTEGER, cursor);
      if (before === undefined) {
        const found = findJoin(messagesWalk, screen);
        if (!found) return { history: null, reason: "no_match" };
        join = found.message.seq;
        if (found.head.length && join >= from) messages.push({ seq: join, role: found.message.role, blocks: found.head, partial: true });
        cursor.reachedSessionStart = join <= from;
        cursor.lowestSeqRead = join;
        if (!cursor.reachedSessionStart) fill(walk(s, session, join, cursor));
      } else {
        fill(messagesWalk);
      }
      const full = messages.length >= limit && !cursor.reachedSessionStart;
      const next = full ? messages[messages.length - 1].seq : cursor.reachedSessionStart ? null : cursor.lowestSeqRead;
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
