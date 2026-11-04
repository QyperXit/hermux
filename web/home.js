import { FULL_ROWS, RECENT_ROWS } from "./activity.js";

/**
 * @typedef {import("./types.js").Agent} Agent
 */

/**
 * @typedef {object} OpenedStore
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(index: number) => string | null} key
 * @property {number} length
 */

/**
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

/**
 * @param {OpenedStore} storage
 * @param {{ pane_id: string, completion_seq?: unknown }} agent
 */
export function recordOpened(storage, agent) {
  storage.setItem(OPENED_PREFIX + agent.pane_id, JSON.stringify(agent.completion_seq ?? null));
}

const NEVER_OPENED = null;

/**
 * @param {Agent} agent
 * @param {boolean} firstLoad
 */
const baselineFor = (agent, firstLoad) => (firstLoad && agent.agent_status !== "done" ? (agent.completion_seq ?? NEVER_OPENED) : NEVER_OPENED);

/**
 * @param {OpenedStore} storage
 * @param {Agent[]} agents
 */
export function recordFirstSight(storage, agents) {
  const firstLoad = !hasStoredBaseline(storage);
  for (const agent of agents) {
    if (storage.getItem(OPENED_PREFIX + agent.pane_id) !== null) continue;
    storage.setItem(OPENED_PREFIX + agent.pane_id, JSON.stringify(baselineFor(agent, firstLoad)));
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

/**
 * @template {{ state_change_seq?: unknown }} T
 * @param {T[]} agents
 * @returns {T[]}
 */
const newestFirst = (agents) => [...agents].sort((a, b) => seqOf(b) - seqOf(a));

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

/** @typedef {ReturnType<typeof homeLists>} Home */

/** @param {Home} home */
const idleActivity = (home) => home.activity.filter(({ agent }) => agent.agent_status === "idle").map(({ agent }) => agent);

/** @param {Home} home */
export const activityLinePanes = (home) => idleActivity(home).map((agent) => agent.pane_id);

/** @param {Home} home */
export const missingActivityLines = (home) => idleActivity(home).some((agent) => !("latest_line" in agent));

/** @param {number} count */
export function olderKeyLabel(count) {
  return `${count} more older sessions`;
}

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
