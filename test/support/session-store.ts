// Fixture copies of Atomic's session store: a temporary SQLite file with
// Atomic's schema (session_sessions, session_entries) holding entries in the
// real shapes, written here through the fixture's own connection. The server
// opens them READ-ONLY.
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The folder a session runs in unless it names another.
export const CWD = "/home/you/weather-app";

// Atomic's own schema (journal.sqlite, checked read-only on the laptop).
const SCHEMA = `
CREATE TABLE session_sessions (
  id TEXT PRIMARY KEY, cwd TEXT NOT NULL, created_at TEXT NOT NULL,
  header_json TEXT NOT NULL CHECK(json_valid(header_json)), internal INTEGER NOT NULL,
  last_seq INTEGER NOT NULL, modified_at TEXT NOT NULL, message_count INTEGER NOT NULL,
  first_message TEXT NOT NULL CHECK(json_valid(first_message)),
  name TEXT CHECK(name IS NULL OR json_valid(name)), has_name INTEGER NOT NULL,
  summary TEXT CHECK(summary IS NULL OR json_valid(summary)), summarized_through_id TEXT,
  summary_state TEXT NOT NULL CHECK(json_valid(summary_state)), revision TEXT NOT NULL DEFAULT '') STRICT;
CREATE TABLE session_entries (
  session_id TEXT NOT NULL, seq INTEGER NOT NULL, entry_id TEXT NOT NULL,
  entry_json TEXT NOT NULL CHECK(json_valid(entry_json)), PRIMARY KEY(session_id, seq)) STRICT;`;

export type Entry = Record<string, unknown>;
export type Session = { id: string; cwd?: string; internal?: number; modified?: string; entries: Entry[] };

const insertSession = (db: Database, session: Session) => {
  db.run(
    "INSERT INTO session_sessions (id, cwd, created_at, header_json, internal, last_seq, modified_at, message_count, first_message, name, has_name, summary_state) VALUES (?, ?, ?, '{}', ?, ?, ?, ?, '\"\"', NULL, 0, '{}')",
    [session.id, session.cwd ?? CWD, "2026-10-29T00:00:00Z", session.internal ?? 0, session.entries.length, session.modified ?? "2026-10-29T10:00:00Z", session.entries.length],
  );
  insertEntries(db, session.id, 1, session.entries);
};

const insertEntries = (db: Database, sessionId: string, firstSeq: number, entries: Entry[]) =>
  entries.forEach((entry, index) =>
    db.run("INSERT INTO session_entries (session_id, seq, entry_id, entry_json) VALUES (?, ?, ?, ?)", [sessionId, firstSeq + index, `e${firstSeq + index}`, JSON.stringify(entry)]),
  );

const storeDirs: string[] = [];

// A new store in WAL mode, as Atomic keeps it; returns its path.
export function makeStore(sessions: Session[]) {
  const dir = mkdtempSync(join(tmpdir(), "atomic-store-"));
  storeDirs.push(dir);
  const path = join(dir, "journal.sqlite");
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(SCHEMA);
  for (const session of sessions) insertSession(db, session);
  db.close();
  return path;
}

// Atomic starting a session, or writing on, while the server has the store open.
export function addSession(path: string, session: Session) {
  const db = new Database(path);
  insertSession(db, session);
  db.close();
}

export function addEntries(path: string, sessionId: string, firstSeq: number, entries: Entry[]) {
  const db = new Database(path);
  insertEntries(db, sessionId, firstSeq, entries);
  db.close();
}

// Removes every store made so far; call it after a file's last test.
export function removeStores() {
  for (const dir of storeDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
