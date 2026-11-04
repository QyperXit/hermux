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
 * @typedef {{ ids: string[], lines: Map<string, Pick<Terminal, "latest_line" | "latest_line_error">> }} Listing
 */

/**
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
 * @typedef {{ status: "ignored" } | { status: "sent", terminal: Terminal, error: null } | { status: "refused", terminal: Terminal, error: RequestError }} Sent
 */

const LIST_REFRESH_MS = 3000;
const OUTPUT_REFRESH_MS = 2000;

const READS_TERMINALS = new Set(["agent", "all"]);

// herdr 0.9.5 sends no event for new output.
const AT_REST = new Set(["idle", "done", "blocked"]);

/** @returns {Listing} */
const emptyListing = () => ({ ids: [], lines: new Map() });

/** @param {string} code */
const staleTerminal = (code) => code === "terminal_changed" || code === "pane_not_found";

/** @param {Terminal} terminal @returns {Agent} */
function agentOf(terminal) {
  /** @type {Agent} */
  const agent = { pane_id: terminal.pane_id, agent: terminal.kind, agent_status: terminal.status ?? "", cwd: terminal.cwd ?? "", terminal_title_stripped: terminal.title ?? "" };
  if (terminal.workspace.id !== null) agent.workspace_id = terminal.workspace.id;
  agent.tab = terminal.tab;
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
  /** @type {Map<string, Terminal>} */
  const panes = new Map();
  let agentList = emptyListing();
  let allList = emptyListing();
  /** @type {(Listing & { id: string | null, label: string | null }) | null} */
  let workspace = null;
  /** @type {Route} */
  let route = { name: "home" };
  /** @type {string[]} */
  let linePanes = [];
  let loaded = false;
  let updatedAt = 0;
  /** @type {RequestError | null} */
  let listError = null;
  let terminalsLoaded = false;
  let lookedUp = false;
  /** @type {RequestError | null} */
  let lookupError = null;
  /** @type {{ paneId: string | null, text: string | null, error: string | null }} */
  let output = { paneId: null, text: null, error: null };
  let sending = false;
  let streaming = false;
  let visible = false;
  /** @type {string | null} */
  let serverStreamName = null;
  /** @type {string | null} */
  let watchRequestedPane = null;
  let serverStreamsWatched = false;
  let pushedOutputCount = 0;
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

  // An agent list answer knows all of an Agent, its tab included, except its
  // workspace's label, which only the terminal lists have: that stays as they
  // last said.
  /** @param {Agent[]} agents */
  function rememberAgents(agents) {
    agentList = remember(agents.map(terminalOfAgent), (pane) => {
      const known = panes.get(pane.pane_id);
      if (!known) return pane;
      return { ...pane, workspace: { id: pane.workspace.id, label: known.workspace.id === pane.workspace.id ? known.workspace.label : null } };
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

  /** @returns {Terminal | null} */
  function openTerminal() {
    const { paneId } = route;
    if (!paneId) return null;
    if (workspace) return terminalIn(workspace, paneId);
    return terminalIn(allList, paneId) ?? terminalIn(agentList, paneId);
  }

  /** @returns {{ gone?: true, error?: string } | null} */
  function missingHeader() {
    if (loaded && (workspace || lookedUp)) return { gone: true };
    if (lookupError) return { error: retryingText(lookupError) };
    return null;
  }

  /** @param {ChangedTerminal[]} changes */
  function takeStatuses(changes) {
    for (const change of changes) {
      const pane = panes.get(change.pane_id);
      if (pane && pane.status !== null) panes.set(change.pane_id, { ...pane, status: change.agent_status });
    }
  }

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
    if (route.name !== "all") changed("screen");
    refreshTerminals();
  }

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
      if (failure.code === "workspace_not_found") workspace = { id: workspaceId, label: null, ...emptyListing() };
      else lookupError = failure;
      forgetUnlisted();
    }
    if (stillHere()) changed("screen");
  }

  async function refreshOutputNow() {
    const { paneId } = route;
    if (!paneId) return;
    const pushed = pushedOutputCount;
    try {
      const text = await client.readOutput(paneId);
      if (route.paneId !== paneId || pushedOutputCount !== pushed) return;
      output = { paneId, text, error: null };
    } catch (error) {
      if (route.paneId !== paneId || pushedOutputCount !== pushed) return;
      output = { ...output, error: describeError(error, "Couldn't read this agent's output.").message };
    }
    changed("output");
  }

  const refreshList = serialPoll(refreshListNow);
  const refreshTerminals = serialPoll(refreshTerminalsNow, () => `${route.name} ${route.paneId ?? ""}`);
  const refreshOutput = serialPoll(refreshOutputNow, () => route.paneId ?? "");

  /** @param {RequestError} error */
  function refreshStale(error) {
    if (!staleTerminal(error.code)) return;
    refreshList();
    refreshOutput();
  }

  const outputStreamed = () => serverStreamsWatched && route.name === "agent" && watchRequestedPane === route.paneId;

  const streamDown = () => !streaming;
  const listReadFailed = () => Boolean(listError);
  const terminalsReadFailed = () => Boolean(lookupError) && READS_TERMINALS.has(route.name);
  const openTerminalBusy = () => !AT_REST.has(openTerminal()?.status ?? "");
  const outputReadFailed = () => Boolean(output.error);

  const listPollRuns = () => streamDown() || listReadFailed() || terminalsReadFailed();
  const outputTimerRuns = () => route.name === "agent" && !outputStreamed() && (streamDown() || openTerminalBusy() || outputReadFailed());

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

  function syncWatch() {
    const wanted = visible && serverStreamName !== null && route.name === "agent" ? route.paneId : null;
    if (wanted === watchRequestedPane) return;
    const previous = watchRequestedPane;
    watchRequestedPane = wanted;
    serverStreamsWatched = false;
    if (serverStreamName === null) return;
    if (wanted !== null) client.watchOutput(wanted, serverStreamName).catch(() => {});
    else if (previous !== null) client.unwatchOutput(previous, serverStreamName).catch(() => {});
  }

  /** @param {string | null} id */
  function onStreamName(id) {
    const wasStreamed = outputStreamed();
    serverStreamName = id;
    syncWatch();
    if (wasStreamed && visible && !streaming) refreshOutput();
  }

  /**
   * @param {"change" | "output" | "watch"} type
   * @param {StreamEvent} data
   */
  function onStreamEvent(type, data) {
    const open = route.name === "agent" && route.paneId === data.pane_id;
    if (type === "watch") {
      if (!open || watchRequestedPane !== data.pane_id) return;
      const wasStreamed = serverStreamsWatched;
      serverStreamsWatched = data.streaming === true;
      if (wasStreamed && !serverStreamsWatched) refreshOutput();
      return;
    }
    if (type === "output") {
      if (!open) return;
      if (typeof data.text !== "string") {
        if (!outputStreamed()) refreshOutput();
        return;
      }
      if (watchRequestedPane !== data.pane_id) return;
      pushedOutputCount += 1;
      output = { paneId: route.paneId ?? null, text: data.text, error: null };
      changed("output");
      return;
    }
    if (data.changed?.length) {
      takeStatuses(data.changed);
      changed("screen");
    }
    refreshList();
  }

  /** @param {boolean} healthy */
  function onStreamHealth(healthy) {
    streaming = healthy;
    changed("screen");
    if (!visible) return;
    refreshList();
    if (route.name === "agent") refreshOutput();
  }

  const stream = client.isSample ? null : createLiveStream({ open: openStream, onHealth: onStreamHealth, onEvent: onStreamEvent, onStream: onStreamName });

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
      return { status: "sent", terminal, error: null };
    } catch (error) {
      const failure = describeError(error);
      refreshStale(failure);
      return { status: "refused", terminal, error: failure };
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
        if (!workspace?.ids.includes(route.paneId)) workspace = null;
        lookedUp = false;
        lookupError = null;
        output = { paneId: route.paneId, text: null, error: null };
        forgetUnlisted();
        refreshOutput();
        refreshTerminals();
      } else {
        lookupError = null;
        workspace = null;
        forgetUnlisted();
        refreshTerminals();
      }
      syncWatch();
    },

    hidden() {
      visible = false;
      syncWatch();
      stream?.stop();
    },

    visible() {
      visible = true;
      stream?.start();
      refreshList();
      if (route.name === "agent") refreshOutput();
    },

    /** @param {string} text @returns {Promise<Sent>} */
    async sendText(text) {
      const terminal = openTerminal();
      if (!terminal || sending || !text.trim()) return { status: "ignored" };
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
      if (!terminal) return { status: "ignored" };
      return sendTo(terminal, () => client.sendKeys(terminal.pane_id, [key], terminal.kind));
    },
  };
}
