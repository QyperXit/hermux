/**
 * @typedef {import("./types.js").Client} Client
 * @typedef {import("./types.js").Agent} Agent
 * @typedef {import("./types.js").Terminal} Terminal
 * @typedef {import("./types.js").HistoryPage} HistoryPage
 */

/** @type {Record<string, string>} */
const FRIENDLY = {
  agent_blocked: "It's waiting on a question. Answer it with the keys.",
  agent_changed: "That pane now runs a different agent. Nothing was sent.",
  agent_not_found: "That agent has gone. It may have exited.",
  terminal_changed: "That terminal changed since this screen loaded. Nothing was sent.",
  pane_not_found: "That terminal has gone. It may have been closed.",
  workspace_not_found: "That workspace has gone.",
  not_an_agent: "That terminal is a plain shell, so it has no earlier messages.",
  enter_not_sent: "The message was typed, but Enter didn't go through. Check the agent before sending again.",
  herdr_unavailable: "The server couldn't run herdr on the laptop.",
  subscription_not_found: "The laptop doesn't have this phone's subscription. Turn notifications off and on again.",
  push_failed: "The push service didn't accept the test. Try again in a moment.",
};

class ApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string | undefined} detail
 * @param {number} [status]
 */
export function errorMessage(code, detail, status) {
  return FRIENDLY[code] ?? (detail ? `herdr said: ${detail} (${code}).` : `The laptop answered ${status}.`);
}

/**
 * @param {unknown} error
 * @param {string} [fallback]
 * @returns {import("./types.js").RequestError}
 */
export function describeError(error, fallback = "The laptop didn't answer.") {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
  return { code, message: error instanceof Error ? error.message : fallback };
}

/**
 * @param {unknown} body
 * @returns {{ code?: string, message?: string }}
 */
function errorOf(body) {
  if (typeof body !== "object" || body === null || !("error" in body)) return {};
  const { error } = body;
  if (typeof error !== "object" || error === null) return {};
  return {
    code: "code" in error && typeof error.code === "string" ? error.code : undefined,
    message: "message" in error && typeof error.message === "string" ? error.message : undefined,
  };
}

/**
 * @template T
 * @param {string} path
 * @param {RequestInit} init
 * @returns {Promise<T>}
 */
async function request(path, init) {
  let response;
  try {
    response = await fetch(path, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("unreachable", "The laptop didn't answer.");
  }
  /** @type {T | null} */
  const body = await response.json().catch(() => null);
  if (response.ok && body) return body;
  const { code = `http_${response.status}`, message } = errorOf(body);
  throw new ApiError(code, errorMessage(code, message, response.status));
}

/**
 * @param {string} paneId
 * @param {string} [action]
 */
const terminalPath = (paneId, action = "") => `api/terminals/${encodeURIComponent(paneId)}${action ? `/${action}` : ""}`;

// A read that hasn't answered in this long counts as the laptop not
// answering, so a hung request never holds up the next refresh. Sends have
// no timeout: a slow send may still be delivered, and "Not sent" would invite
// sending it twice.
const READ_TIMEOUT_MS = 10_000;

/**
 * @param {string} path
 * @param {unknown} body
 */
const post = (path, body) =>
  request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * @param {{ readTimeoutMs?: number }} [options]
 * @returns {Client}
 */
export function createHttpClient({ readTimeoutMs = READ_TIMEOUT_MS } = {}) {
  /**
   * @template T
   * @param {string} path
   * @returns {Promise<T>}
   */
  const read = (path) => request(path, { signal: AbortSignal.timeout(readTimeoutMs) });
  return {
    isSample: false,

    async listAgents(linePanes = []) {
      const query = linePanes.length ? `?lines=${encodeURIComponent(linePanes.join(","))}` : "";
      /** @type {{ agents: Agent[] }} */
      const answer = await read(`api/agents${query}`);
      return answer.agents;
    },

    async listTerminals(linePanes = []) {
      const query = linePanes.length ? `?lines=${encodeURIComponent(linePanes.join(","))}` : "";
      /** @type {{ terminals: Terminal[] }} */
      const answer = await read(`api/terminals${query}`);
      return answer.terminals;
    },

    async listWorkspaceTerminals(workspaceId) {
      return read(`api/workspaces/${encodeURIComponent(workspaceId)}/terminals`);
    },

    async readOutput(paneId) {
      /** @type {{ text: string }} */
      const answer = await read(terminalPath(paneId, "output"));
      return answer.text;
    },

    // Earlier messages from Atomic's session store, newest page first.
    // `before` is the `before` of the previous page; `from` asks for what
    // scrolled off the screen since the Join `from` (with `limit` at most).
    // Agents only: a plain shell has none, and the page never asks.
    async readHistory(paneId, { before, from, limit } = {}) {
      const query = new URLSearchParams();
      if (before) query.set("before", String(before));
      if (from) query.set("from", String(from));
      if (limit) query.set("limit", String(limit));
      const search = query.toString();
      return read(`${terminalPath(paneId, "history")}${search ? `?${search}` : ""}`);
    },

    // `kind` is what the screen showed: "shell" or the agent kind. The server
    // checks the pane is still that just before sending.
    async sendPrompt(paneId, text, kind) {
      await post(terminalPath(paneId, "prompt"), { text, kind });
    },

    async sendKeys(paneId, keys, kind) {
      await post(terminalPath(paneId, "keys"), { keys, kind });
    },

    // Live output: the server pushes this pane's output on the page's
    // event stream, named `stream`, until the page asks no more.
    async watchOutput(paneId, stream) {
      await post(terminalPath(paneId, "watch"), { stream });
    },

    async unwatchOutput(paneId, stream) {
      await request(terminalPath(paneId, "watch"), { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ stream }) });
    },
  };
}

export function createPushClient() {
  const subscription = "api/push/subscription";
  return {
    async key() {
      /** @type {{ key: string }} */
      const answer = await request("api/push/key", { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
      return answer.key;
    },
    /** @param {unknown} pushSubscription */
    async subscribe(pushSubscription) {
      await post(subscription, { subscription: pushSubscription });
    },
    /** @param {string} endpoint */
    async unsubscribe(endpoint) {
      await request(subscription, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint }) });
    },
    /** @param {string} endpoint */
    async test(endpoint) {
      await post("api/push/test", { endpoint });
    },
  };
}
