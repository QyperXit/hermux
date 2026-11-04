// herdr 0.9.5's CLI has no streaming subscribe, so this talks to herdr's own
// socket (newline-delimited JSON, its shapes probed read-only). Every
// connection sends exactly one request, `events.subscribe`, and nothing
// else: no other method is ever written to the socket. herdr
// takes one subscribe per connection and needs a pane for each
// `pane.agent_status_changed` entry.
import { homedir } from "node:os";
import { resolve } from "node:path";
import { isRecord } from "./herdr";

// The events that change what the lists show. herdr streams them without a pane.
export const LIFECYCLE = [
  "pane.created",
  "pane.closed",
  "pane.updated",
  "pane.exited",
  "pane.agent_detected",
  "pane.moved",
  "tab.created",
  "tab.closed",
  "tab.renamed",
  "tab.moved",
  "workspace.created",
  "workspace.closed",
  "workspace.renamed",
  "workspace.moved",
  "workspace.reordered",
];

// Events after which the set of panes may differ, so the per-pane status
// entries are subscribed again. herdr names pushed lifecycle events with
// underscores (`pane_created`) and status changes with dots; both are
// compared in the underscore form.
const PANE_SET_CHANGES = new Set(["pane_created", "pane_closed", "pane_exited", "pane_moved", "tab_created", "tab_closed", "workspace_created", "workspace_closed"]);

// What a page is told. `live`: whether herdr's events are reaching the server
// (the page polls while they aren't). `change`: agents or terminals changed,
// with the changed records when herdr gave them, and always a refetch hint.
// `output`: something happened on this pane, so its open output may have changed.
export type ChangedTerminal = { pane_id: string; agent_status: string; agent?: string | null };
export type LiveEvent =
  | { type: "live"; live: boolean }
  | { type: "change"; changed?: ChangedTerminal[]; refetch: true }
  | { type: "output"; pane_id: string };

export type EventSocket = { write(text: string): void; end(): void };
export type Connect = (path: string, handlers: { data(text: string): void; close(): void }) => Promise<EventSocket>;

// herdr's own socket resolution, as the CLI the server runs uses it:
// HERDR_SOCKET_PATH, then the named session's socket, then the default.
export function herdrSocketPath(env: Record<string, string | undefined> = process.env, home = homedir()) {
  if (env.HERDR_SOCKET_PATH) return env.HERDR_SOCKET_PATH;
  if (env.HERDR_SESSION) return resolve(home, ".config/herdr/sessions", env.HERDR_SESSION, "herdr.sock");
  return resolve(home, ".config/herdr/herdr.sock");
}

export const connectUnix: Connect = async (path, { data, close }) => {
  const decoder = new TextDecoder();
  let unsent = new Uint8Array(0);
  let closed = false;
  const gone = () => {
    if (closed) return;
    closed = true;
    close();
  };
  const socket = await Bun.connect({
    unix: path,
    socket: {
      data: (_socket, chunk) => data(decoder.decode(chunk, { stream: true })),
      drain: (socket) => {
        unsent = unsent.subarray(socket.write(unsent));
      },
      close: gone,
      error: gone,
      end: gone,
    },
  });
  return {
    write(text) {
      const bytes = new TextEncoder().encode(text);
      unsent = bytes.subarray(socket.write(bytes));
    },
    end: () => socket.end(),
  };
};

type Subscription = { id: string; socket: EventSocket | null; buffer: string; ended: boolean };

export function createLiveEvents({
  socketPath,
  panes,
  connect = connectUnix,
  retryMs = { first: 500, max: 10_000 },
  resubscribeMs = 200,
}: {
  socketPath: string;
  panes: () => Promise<string[]>;
  connect?: Connect;
  retryMs?: { first: number; max: number };
  resubscribeMs?: number;
}) {
  const listeners = new Set<(event: LiveEvent) => void>();
  let live = false;
  let stopped = true;
  let startedSub: Subscription | null = null;
  let openingSub: Subscription | null = null;
  let panesChangedWhileOpening = false;
  let wait = retryMs.first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let count = 0;

  const emit = (event: LiveEvent) => {
    for (const listener of listeners) listener(event);
  };
  const setLive = (next: boolean) => {
    if (live === next) return;
    live = next;
    emit({ type: "live", live });
  };

  function schedule(ms: number) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(subscribe, ms);
  }

  function retryLater() {
    schedule(wait);
    wait = Math.min(wait * 2, retryMs.max);
  }

  function end(sub: Subscription) {
    sub.ended = true;
    sub.socket?.end();
  }

  function lost(sub: Subscription) {
    if (sub.ended && sub !== startedSub && sub !== openingSub) return;
    end(sub);
    if (sub === openingSub) {
      openingSub = null;
      retryLater();
    } else if (sub === startedSub) {
      startedSub = null;
      setLive(false);
      retryLater();
    }
  }

  function started(sub: Subscription) {
    const previous = startedSub;
    startedSub = sub;
    openingSub = null;
    wait = retryMs.first;
    if (previous) end(previous);
    setLive(true);
    if (panesChangedWhileOpening) {
      panesChangedWhileOpening = false;
      schedule(resubscribeMs);
    }
  }

  function onEvent(name: string, data: Record<string, unknown>) {
    const paneId = typeof data.pane_id === "string" ? data.pane_id : isRecord(data.pane) && typeof data.pane.pane_id === "string" ? data.pane.pane_id : undefined;
    if (name === "pane_agent_status_changed" && paneId !== undefined && typeof data.agent_status === "string") {
      const changed: ChangedTerminal = { pane_id: paneId, agent_status: data.agent_status };
      if (typeof data.agent === "string" || data.agent === null) changed.agent = data.agent;
      emit({ type: "change", changed: [changed], refetch: true });
      emit({ type: "output", pane_id: paneId });
      return;
    }
    emit({ type: "change", refetch: true });
    if (name === "pane_updated" && paneId !== undefined) emit({ type: "output", pane_id: paneId });
    if (PANE_SET_CHANGES.has(name)) resubscribeSoon();
  }

  function onLine(sub: Subscription, line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (message.id === sub.id) {
      if (isRecord(message.result) && message.result.type === "subscription_started" && sub === openingSub) started(sub);
      // herdr's error (events_lost, a pane that has gone): it closes the
      // connection, and a new subscription starts afresh.
      else if (message.error !== undefined) lost(sub);
      return;
    }
    if (sub !== startedSub || typeof message.event !== "string") return;
    onEvent(message.event.replaceAll(".", "_"), isRecord(message.data) ? message.data : {});
  }

  async function subscribe() {
    if (stopped) return;
    if (openingSub) {
      panesChangedWhileOpening = true;
      return;
    }
    const sub: Subscription = { id: `agents-events-${++count}`, socket: null, buffer: "", ended: false };
    openingSub = sub;
    panesChangedWhileOpening = false;
    try {
      sub.socket = await connect(socketPath, {
        data(text) {
          sub.buffer += text;
          for (let index = sub.buffer.indexOf("\n"); index !== -1; index = sub.buffer.indexOf("\n")) {
            const line = sub.buffer.slice(0, index);
            sub.buffer = sub.buffer.slice(index + 1);
            onLine(sub, line);
          }
        },
        close: () => lost(sub),
      });
      if (sub.ended) return;
      const ids = await panes();
      const subscriptions = [...LIFECYCLE.map((type) => ({ type })), ...ids.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id }))];
      if (sub.ended || stopped) return;
      sub.socket.write(`${JSON.stringify({ id: sub.id, method: "events.subscribe", params: { subscriptions } })}\n`);
    } catch (error) {
      if (!sub.ended) console.error(`Live updates: couldn't subscribe to herdr's events (${error instanceof Error ? error.message : String(error)}). Retrying.`);
      lost(sub);
    }
  }

  function resubscribeSoon() {
    if (openingSub) panesChangedWhileOpening = true;
    else schedule(resubscribeMs);
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      subscribe();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      for (const sub of [startedSub, openingSub]) if (sub) end(sub);
      startedSub = null;
      openingSub = null;
      setLive(false);
    },
    // A listener hears the current `live` state at once, then every event.
    subscribe(listener: (event: LiveEvent) => void) {
      listeners.add(listener);
      listener({ type: "live", live });
      return () => {
        listeners.delete(listener);
      };
    },
    isLive: () => live,
  };
}

export type LiveEvents = ReturnType<typeof createLiveEvents>;
