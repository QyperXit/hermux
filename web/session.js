// The page's Terminal session (D26): the roster (one copy of the panes), the
// route and its open Terminal, that Terminal's Live screen text, when each of
// them is read again, the live stream with its poll fallback, and every guard
// that drops an answer for a screen that was left. No DOM here, so the tests
// can import it: the page passes in its client, an EventSource factory, its
// timers and the store of opened completions, reads `snapshot()` after each
// change it is told of, and tells the session what happened: a route opened,
// the page hidden or visible, text or a key to send.
import { describeError } from "./api.js";
import { activityLinePanes, homeLists, missingActivityLines, recordFirstSight } from "./home.js";
import { createLiveStream } from "./live.js";
import { serialPoll } from "./poll.js";
import { retryingText, terminalOfAgent } from "./terminals.js";

/**
 * @typedef {import("./types.js").Agent} Agent
 * @typedef {import("./types.js").Client} Client
 * @typedef {import("./types.js").RequestError} RequestError
 * @typedef {import("./types.js").Terminal} Terminal
 * @typedef {import("./types.js").Workspace} Workspace
 * @typedef {import("./home.js").OpenedStore} OpenedStore
 * @typedef {import("./live.js").EventSourceLike} EventSourceLike
 * @typedef {import("./live.js").ChangedTerminal} ChangedTerminal
 * @typedef {import("./live.js").StreamEvent} StreamEvent
 * @typedef {{ name: "home" | "all", paneId?: undefined } | { name: "agent", paneId: string }} Route
 * @typedef {{ setInterval: (run: () => void, ms: number) => unknown, now: () => number }} Timers
 * @typedef {"screen" | "output"} Change what the page redraws: the screen, or the Live screen alone
 */

/**
 * A list as it last answered: its panes in its order, and the Latest line it
 * read for each (each list has its own read policy, so its own readings).
 * @typedef {{ ids: string[], lines: Map<string, Pick<Terminal, "latest_line" | "latest_line_error">> }} Listing
 */

/**
 * What the page draws. `missing` says why the open Terminal isn't known
 * (see `missingHeader`); `output` is its Live screen's text and the last read's error.
 * @typedef {object} Snapshot
 * @property {Route} route
 * @property {boolean} streaming
 * @property {boolean} loaded
 * @property {number} updatedAt
 * @property {RequestError | null} listError
 * @property {Agent[]} agents
 * @property {Terminal[]} terminals
 * @property {boolean} terminalsLoaded
 * @property {Terminal | null} terminal
 * @property {{ gone?: true, error?: string } | null} missing
 * @property {Workspace | null} workspace
 * @property {{ text: string | null, error: string | null }} output
 * @property {boolean} sending
 */

/**
 * What a send did: nothing (null, when there's no Terminal, a message is on its
 * way or the text is blank), or sent to `terminal`, or refused with `error`.
 * @typedef {{ terminal: Terminal, error: RequestError | null } | null} Sent
 */

const LIST_REFRESH_MS = 3000;
const OUTPUT_REFRESH_MS = 2000;

// The 3 s list poll runs while the stream isn't healthy, and also while the
// last list read failed, or the last read of the open screen's terminals did:
// an event may not come for a long time, and the offline text, the "Retrying…"
// header and the stale rows would stay until it does. (Each list read also
// reads the open screen's terminals.) Only the agent and All screens read
// terminals, so only there does a terminals read's error count: elsewhere no
// read would ever clear it.
const READS_TERMINALS = new Set(["agent", "all"]);

// While streaming, a terminal at rest (idle, done or blocked) changes its
// screen only after a status change, which re-reads it, or a send from this
// page, which re-reads it too. herdr 0.9.5 sends no event for new output, so
// a working or unclear agent, and a plain shell (no status), keep the short
// output timer, and so does any terminal whose last output read failed (the
// notice says "Retrying…", and no event may come). Without the stream every
// open terminal keeps it.
const AT_REST = new Set(["idle", "done", "blocked"]);

/** @returns {Listing} */
const emptyListing = () => ({ ids: [], lines: new Map() });

// A terminal that changed or went since the screen loaded can't be typed into:
// the server refused with nothing sent.
/** @param {string} code */
const staleTerminal = (code) => code === "terminal_changed" || code === "pane_not_found";

// An Agent as home and All draw it, from its pane and the agent list's reading.
/** @param {Terminal} terminal @returns {Agent} */
function agentOf(terminal) {
  /** @type {Agent} */
  const agent = { pane_id: terminal.pane_id, agent: terminal.kind, agent_status: terminal.status ?? "", cwd: terminal.cwd ?? "", terminal_title_stripped: terminal.title ?? "" };
  if (terminal.workspace.id !== null) agent.workspace_id = terminal.workspace.id;
  if (typeof terminal.state_change_seq === "number") agent.state_change_seq = terminal.state_change_seq;
  if (typeof terminal.completion_seq === "number") agent.completion_seq = terminal.completion_seq;
  if (typeof terminal.since === "number") agent.since = terminal.since;
  if (terminal.latest_line !== undefined) agent.latest_line = terminal.latest_line;
  if (terminal.latest_line_error) agent.latest_line_error = terminal.latest_line_error;
  return agent;
}

/**
 * @param {{
 *   client: Client,
 *   openStream: (path: string) => EventSourceLike,
 *   timers: Timers,
 *   opened: OpenedStore,
 * }} options
 */
export function createSession({ client, openStream, timers, opened }) {
  // The roster: each pane once, as the latest answer that listed it said. The
  // lists below name which panes they hold.
  /** @type {Map<string, Terminal>} */
  const panes = new Map();
  // The agent list (home and All), every pane (the All screen, and a pane
  // that isn't an agent), and the workspace of the open screen's terminal.
  let agentList = emptyListing();
  let allList = emptyListing();
  /** @type {(Listing & { id: string | null, label: string | null }) | null} */
  let workspace = null;
  /** @type {Route} */
  let route = { name: "home" };
  // The idle panes home's Activity showed, named in the next list request.
  /** @type {string[]} */
  let linePanes = [];
  let loaded = false;
  let updatedAt = 0;
  /** @type {RequestError | null} */
  let listError = null;
  let terminalsLoaded = false;
  // True once the open screen's terminal has been searched for.
  let lookedUp = false;
  // Why the open screen's terminal couldn't be looked up, while it can't.
  /** @type {RequestError | null} */
  let lookupError = null;
  /** @type {{ paneId: string | null, text: string | null, error: string | null }} */
  let output = { paneId: null, text: null, error: null };
  let sending = false;
  // The server's event stream is healthy (D20): no list poll, and "Live".
  let streaming = false;
  let visible = false;
  /** @type {Set<(change: Change) => void>} */
  const listeners = new Set();

  /** @param {Change} change */
  const changed = (change) => {
    for (const listener of listeners) listener(change);
  };

  /**
   * @param {Terminal[]} rows
   * @param {(pane: Terminal) => Terminal} [merge]
   * @returns {Listing}
   */
  function remember(rows, merge = (pane) => pane) {
    const listing = emptyListing();
    for (const { latest_line, latest_line_error, ...pane } of rows) {
      panes.set(pane.pane_id, merge(pane));
      listing.ids.push(pane.pane_id);
      listing.lines.set(pane.pane_id, { ...(latest_line !== undefined ? { latest_line } : {}), ...(latest_line_error ? { latest_line_error } : {}) });
    }
    return listing;
  }

  // An agent list answer knows all of an Agent but its tab and its
  // workspace's label, which only the terminal lists have: those stay as
  // they last said.
  /** @param {Agent[]} agents */
  function rememberAgents(agents) {
    agentList = remember(agents.map(terminalOfAgent), (pane) => {
      const known = panes.get(pane.pane_id);
      if (!known) return pane;
      return { ...pane, tab: known.tab, workspace: { id: pane.workspace.id, label: known.workspace.id === pane.workspace.id ? known.workspace.label : null } };
    });
    forgetUnlisted();
  }

  function forgetUnlisted() {
    const listed = new Set([...agentList.ids, ...allList.ids, ...(workspace?.ids ?? [])]);
    for (const paneId of panes.keys()) if (!listed.has(paneId)) panes.delete(paneId);
  }

  /** @param {Listing} listing @param {string} paneId @returns {Terminal | null} */
  function terminalIn(listing, paneId) {
    const pane = listing.ids.includes(paneId) ? panes.get(paneId) : undefined;
    return pane ? { ...pane, ...listing.lines.get(paneId) } : null;
  }

  /** @param {Listing} listing @returns {Terminal[]} */
  const terminalsOf = (listing) => listing.ids.flatMap((paneId) => terminalIn(listing, paneId) ?? []);

  // The open screen's terminal, an agent or a plain shell. Once the
  // workspace has answered it is the authority: a pane missing from it is gone.
  /** @returns {Terminal | null} */
  function openTerminal() {
    const { paneId } = route;
    if (!paneId) return null;
    if (workspace) return terminalIn(workspace, paneId);
    return terminalIn(allList, paneId) ?? terminalIn(agentList, paneId);
  }

  // What the screen header says while its terminal isn't known: gone once the
  // agent list has loaded and the terminal lists answered without it; else the
  // error of the last lookup, while that failed (never "gone", as it may be
  // passing); else nothing yet.
  /** @returns {{ gone?: true, error?: string } | null} */
  function missingHeader() {
    if (loaded && (workspace || lookedUp)) return { gone: true };
    if (lookupError) return { error: retryingText(lookupError) };
    return null;
  }

  // The rows with the statuses a change event carried; a plain shell's null
  // status stays null.
  /** @param {ChangedTerminal[]} changes */
  function takeStatuses(changes) {
    for (const change of changes) {
      const pane = panes.get(change.pane_id);
      if (pane && pane.status !== null) panes.set(change.pane_id, { ...pane, status: change.agent_status });
    }
  }

  // Each list request names the idle panes home's Activity showed last time.
  // If Activity now shows an idle pane the server didn't read, the session
  // asks once more straight away, naming it.
  async function refreshListNow() {
    try {
      let agents = await client.listAgents(linePanes);
      recordFirstSight(opened, agents);
      let home = homeLists(agents, opened);
      if (missingActivityLines(home)) {
        agents = await client.listAgents(activityLinePanes(home));
        recordFirstSight(opened, agents);
        home = homeLists(agents, opened);
      }
      rememberAgents(agents);
      linePanes = activityLinePanes(home);
      loaded = true;
      updatedAt = timers.now();
      listError = null;
    } catch (error) {
      listError = describeError(error);
    }
    // The All screen is drawn once its terminals have answered too.
    if (route.name !== "all") changed("screen");
    refreshTerminals();
  }

  // The terminals the open screen needs. The All screen lists every pane. An
  // agent or shell screen lists its workspace's panes (the switcher), finding the
  // workspace first from the full list when the session doesn't know the pane yet
  // (a link straight to a shell). They are read on the list's rhythm, and only
  // while one of those screens is open.
  async function refreshTerminalsNow() {
    const { name, paneId } = route;
    if (name !== "all" && name !== "agent") return;
    const stillHere = () => route.name === name && route.paneId === paneId;
    /** @type {string | null} */
    let workspaceId = null;
    try {
      if (name === "all") {
        const all = await client.listTerminals();
        if (!stillHere()) return;
        allList = remember(all);
        terminalsLoaded = true;
      } else {
        workspaceId = openTerminal()?.workspace.id ?? null;
        if (!workspaceId) {
          const all = await client.listTerminals();
          if (!stillHere()) return;
          allList = remember(all);
          terminalsLoaded = true;
          workspaceId = openTerminal()?.workspace.id ?? null;
        }
        if (workspaceId) {
          const answer = await client.listWorkspaceTerminals(workspaceId);
          if (!stillHere()) return;
          workspace = { id: workspaceId, label: answer.workspace.label, ...remember(answer.terminals) };
        }
        lookedUp = true;
      }
      forgetUnlisted();
      lookupError = null;
    } catch (error) {
      if (!stillHere()) return;
      const failure = describeError(error);
      // The workspace itself has gone, and its panes with it.
      if (failure.code === "workspace_not_found") workspace = { id: workspaceId, label: null, ...emptyListing() };
      else lookupError = failure;
      forgetUnlisted();
    }
    if (stillHere()) changed("screen");
  }

  async function refreshOutputNow() {
    const { paneId } = route;
    if (!paneId) return;
    try {
      const text = await client.readOutput(paneId);
      if (route.paneId !== paneId) return;
      output = { paneId, text, error: null };
    } catch (error) {
      if (route.paneId !== paneId) return;
      output = { ...output, error: describeError(error, "Couldn't read this agent's output.").message };
    }
    changed("output");
  }

  // Each refresh runs one request at a time per target (web/poll.js): the
  // list; the terminals of the open screen; the open pane's output. A refresh
  // asked for while one is on its way runs once more after it.
  const refreshList = serialPoll(refreshListNow);
  const refreshTerminals = serialPoll(refreshTerminalsNow, () => `${route.name} ${route.paneId ?? ""}`);
  const refreshOutput = serialPoll(refreshOutputNow, () => route.paneId ?? "");

  // The screen refreshes to what the terminal is now.
  /** @param {RequestError} error */
  function refreshStale(error) {
    if (!staleTerminal(error.code)) return;
    refreshList();
    refreshOutput();
  }

  const listPollRuns = () => !streaming || Boolean(listError) || (Boolean(lookupError) && READS_TERMINALS.has(route.name));
  const outputTimerRuns = () => route.name === "agent" && (!streaming || !AT_REST.has(openTerminal()?.status ?? "") || Boolean(output.error));

  /**
   * @param {number} ms
   * @param {() => unknown} task
   * @param {() => boolean} shouldRun
   */
  function every(ms, task, shouldRun) {
    timers.setInterval(() => {
      if (visible && shouldRun()) task();
    }, ms);
  }

  // Live updates (D20). A change re-reads the list (and with it the open
  // screen's terminals) at once, after showing any new status straight away; an
  // output event for the open terminal re-reads its output.
  /**
   * @param {"change" | "output"} type
   * @param {StreamEvent} data
   */
  function onStreamEvent(type, data) {
    if (type === "output") {
      if (route.name === "agent" && route.paneId === data.pane_id) refreshOutput();
      return;
    }
    if (data.changed?.length) {
      takeStatuses(data.changed);
      changed("screen");
    }
    refreshList();
  }

  // The stream became healthy (polling stops, "Live") or stopped (polling
  // resumes at once). Either way the session reads what it may have missed.
  /** @param {boolean} healthy */
  function onStreamHealth(healthy) {
    streaming = healthy;
    changed("screen");
    if (!visible) return;
    refreshList();
    if (route.name === "agent") refreshOutput();
  }

  // The sample data has no stream.
  const stream = client.isSample ? null : createLiveStream({ open: openStream, onHealth: onStreamHealth, onEvent: onStreamEvent });

  /**
   * @param {Terminal} terminal
   * @param {() => Promise<void>} send
   * @returns {Promise<Sent>}
   */
  async function sendTo(terminal, send) {
    try {
      await send();
      refreshOutput();
      refreshList();
      return { terminal, error: null };
    } catch (error) {
      const failure = describeError(error);
      refreshStale(failure);
      return { terminal, error: failure };
    }
  }

  return {
    /** @param {(change: Change) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
    },

    /** @returns {Snapshot} */
    snapshot() {
      const terminal = openTerminal();
      return {
        route,
        streaming,
        loaded,
        updatedAt,
        listError,
        agents: terminalsOf(agentList).map(agentOf),
        terminals: terminalsOf(allList),
        terminalsLoaded,
        terminal,
        missing: terminal || route.name !== "agent" ? null : missingHeader(),
        workspace: workspace && { id: workspace.id, label: workspace.label, terminals: terminalsOf(workspace) },
        output: { text: output.text, error: output.error },
        sending,
      };
    },

    // The first list read, the stream when the page is shown, and the timers.
    // The list is polled only while the stream isn't healthy or the last list
    // read failed, or the open screen's last terminals read did. The open
    // terminal's output is re-read on the short timer while it may be changing
    // or the last read failed.
    /** @param {boolean} shown */
    start(shown) {
      visible = shown;
      refreshList();
      if (visible) stream?.start();
      every(LIST_REFRESH_MS, refreshList, listPollRuns);
      every(OUTPUT_REFRESH_MS, refreshOutput, outputTimerRuns);
    },

    /** @param {Route} next */
    open(next) {
      route = next;
      if (route.name === "agent") {
        // Swapping inside a workspace keeps its panes; anywhere else starts afresh.
        if (!workspace?.ids.includes(route.paneId)) workspace = null;
        lookedUp = false;
        lookupError = null;
        output = { paneId: route.paneId, text: null, error: null };
        forgetUnlisted();
        refreshOutput();
        refreshTerminals();
      } else {
        // Drop the terminals error of the screen left behind: home reads no
        // terminals, and All reads its own at once.
        lookupError = null;
        workspace = null;
        forgetUnlisted();
        refreshTerminals();
      }
    },

    // A hidden page closes the stream, and runs no timer.
    hidden() {
      visible = false;
      stream?.stop();
    },

    // Shown again: the stream opens again, and what may have been missed is read.
    visible() {
      visible = true;
      stream?.start();
      refreshList();
      if (route.name === "agent") refreshOutput();
    },

    /** @param {string} text @returns {Promise<Sent>} */
    async sendText(text) {
      const terminal = openTerminal();
      if (!terminal || sending || !text.trim()) return null;
      sending = true;
      changed("screen");
      try {
        return await sendTo(terminal, () => client.sendPrompt(terminal.pane_id, text, terminal.kind));
      } finally {
        sending = false;
        changed("screen");
      }
    },

    /** @param {string} key @returns {Promise<Sent>} */
    async sendKey(key) {
      const terminal = openTerminal();
      if (!terminal) return null;
      return sendTo(terminal, () => client.sendKeys(terminal.pane_id, [key], terminal.kind));
    },
  };
}
