// What the home screen (Inbox and Activity) and the All screen
// show, and in what order. No DOM here, so the tests can import it.
import { FULL_ROWS, RECENT_ROWS } from "./activity.js";

/**
 * @typedef {import("./types.js").Agent} Agent
 */

/**
 * Where the opened completions are kept: localStorage, or memoryStorage().
 * @typedef {object} OpenedStore
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(index: number) => string | null} key
 * @property {number} length
 */

/**
 * What describe needs of an agent or of a terminal that stands for one.
 * @typedef {{ pane_id: string, cwd: string, agent?: string, terminal_title_stripped: string }} Describable
 */

const OPENED_PREFIX = "agents.opened-completion.";

/**
 * @param {Describable} agent
 * @returns {{ folder: string, session: string | null }}
 */
export function describe(agent) {
  const folder = agent.cwd.split("/").filter(Boolean).pop() ?? agent.pane_id;
  const kindPrefix = `${agent.agent} - `;
  const title = agent.terminal_title_stripped.startsWith(kindPrefix)
    ? agent.terminal_title_stripped.slice(kindPrefix.length)
    : agent.terminal_title_stripped;
  const folderSuffix = ` - ${folder}`;
  const session = title.endsWith(folderSuffix) ? title.slice(0, -folderSuffix.length) : title;
  return { folder, session: session && session !== folder ? session : null };
}

// Opening an agent's screen stores its current completion_seq (null if it has
// none yet) under its pane ID.
/**
 * @param {OpenedStore} storage
 * @param {{ pane_id: string, completion_seq?: unknown }} agent
 */
export function recordOpened(storage, agent) {
  storage.setItem(OPENED_PREFIX + agent.pane_id, JSON.stringify(agent.completion_seq ?? null));
}

// The first time the app sees a pane it stores a baseline under the same key.
// On the app's first load (nothing stored yet) that is the pane's current
// completion_seq, so completions from before the app was used don't flood the
// Inbox, or null when the pane is done (that completion hasn't been opened
// yet). A pane first seen later, once the app is in use, gets null: the user has
// opened none of its completions here, so any completion is new. Opening the
// agent overwrites the baseline.
/**
 * @param {OpenedStore} storage
 * @param {Agent[]} agents
 */
export function recordFirstSight(storage, agents) {
  const firstLoad = !hasStoredBaseline(storage);
  for (const agent of agents) {
    if (storage.getItem(OPENED_PREFIX + agent.pane_id) !== null) continue;
    const seen = firstLoad && agent.agent_status !== "done" ? (agent.completion_seq ?? null) : null;
    storage.setItem(OPENED_PREFIX + agent.pane_id, JSON.stringify(seen));
  }
}

/** @param {OpenedStore} storage */
function hasStoredBaseline(storage) {
  for (let i = 0; i < storage.length; i++) {
    if (storage.key(i)?.startsWith(OPENED_PREFIX)) return true;
  }
  return false;
}

// In-memory stand-in for localStorage. The sample data (`?demo`) uses real pane
// IDs, so the demo keeps its opened completions here, not in the real store.
/** @returns {OpenedStore} */
export function memoryStorage() {
  /** @type {Map<string, string>} */
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    key: (index) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
  };
}

// Finished since the user last opened it in this app: herdr's completion_seq is
// newer than the stored one (null: every completion is new). A pane with nothing
// stored hasn't been seen yet, so it isn't finished.
/**
 * @param {Agent} agent
 * @param {OpenedStore} storage
 */
function isFinished(agent, storage) {
  const stored = storage.getItem(OPENED_PREFIX + agent.pane_id);
  if (stored === null) return false;
  /** @type {unknown} */
  const opened = JSON.parse(stored);
  return typeof agent.completion_seq === "number" && (opened === null || (typeof opened === "number" && agent.completion_seq > opened));
}

/** @param {{ state_change_seq?: unknown }} agent */
const seqOf = (agent) => (typeof agent.state_change_seq === "number" ? agent.state_change_seq : -Infinity);

// Newest activity first; herdr's own order is kept for ties.
/**
 * @template {{ state_change_seq?: unknown }} T
 * @param {T[]} agents
 * @returns {T[]}
 */
const newestFirst = (agents) => [...agents].sort((a, b) => seqOf(b) - seqOf(a));

// Each agent appears at most once on home: blocked in the Inbox, otherwise in
// the Inbox if it finished since opened, otherwise in Activity when it is
// working, unknown or among the most recent others. Activity is in strict
// state_change_seq order, newest first; a working or unknown row is never older.
// `olderCount` counts the agents shown in neither, which only #/all lists.
/**
 * @param {Agent[]} agents
 * @param {OpenedStore} storage
 */
export function homeLists(agents, storage) {
  /** @param {string[]} statuses */
  const is = (...statuses) => (/** @type {Agent} */ agent) => statuses.includes(agent.agent_status);
  const blocked = newestFirst(agents.filter(is("blocked")));
  const finished = newestFirst(agents.filter((agent) => is("done", "idle")(agent) && isFinished(agent, storage)));
  const working = newestFirst(agents.filter(is("working", "unknown")));
  const shown = new Set([...blocked, ...finished, ...working]);
  const recent = newestFirst(agents.filter((agent) => !shown.has(agent))).slice(0, RECENT_ROWS);
  const older = new Set(recent.slice(FULL_ROWS));
  const inActivity = new Set([...working, ...recent]);
  const activity = newestFirst(agents.filter((agent) => inActivity.has(agent))).map((agent) => ({ agent, older: older.has(agent) }));
  return {
    blocked,
    finished,
    working,
    activity,
    olderCount: agents.length - blocked.length - finished.length - activity.length,
  };
}

// The server reads every working, unknown and done agent's latest line, but
// only the most recent idle ones by default. Finished idle agents in the Inbox
// can use those up, so the page names the idle panes Activity shows in its list
// request (GET /api/agents?lines=…), and the server reads those too.
/** @typedef {ReturnType<typeof homeLists>} Home */

/** @param {Home} home */
const idleActivity = (home) => home.activity.filter(({ agent }) => agent.agent_status === "idle").map(({ agent }) => agent);

/** @param {Home} home */
export const activityLinePanes = (home) => idleActivity(home).map((agent) => agent.pane_id);

// An idle Activity row the server didn't read has no `latest_line` key at all
// (a read with no line gives null). The page then asks once more, naming it.
/** @param {Home} home */
export const missingActivityLines = (home) => idleActivity(home).some((agent) => !("latest_line" in agent));

// The key under Activity that opens #/all.
/** @param {number} count */
export function olderKeyLabel(count) {
  return `${count} more older sessions`;
}

// The All screen: every agent, blocked pinned on top, then newest activity first.
/** @param {Agent[]} agents */
export function allAgents(agents) {
  return newestFirst(agents).sort((a, b) => Number(b.agent_status === "blocked") - Number(a.agent_status === "blocked"));
}

/** @param {Pick<Home, "blocked" | "finished" | "working">} home */
export function summaryLine({ blocked, finished, working }) {
  const parts = [blocked.length ? `${blocked.length} need${blocked.length === 1 ? "s" : ""} you` : "Nothing needs you"];
  if (finished.length) parts.push(`${finished.length} finished`);
  if (working.length) parts.push(`${working.length} working`);
  return parts.join(" · ");
}

/** @param {Pick<Home, "working">} home */
export function calmLine({ working }) {
  return working.length ? `Nothing new. ${working.length} working.` : "Nothing new.";
}
