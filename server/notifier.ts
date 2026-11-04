// The notifier only reads; it never sends input.
import { describeTerminal, terminalName } from "../web/terminals.js";
import type { LiveEvent, LiveEvents } from "./events";
import { HerdrError, type Herdr } from "./herdr";
import type { Payload, Push } from "./push";
import type { createRoster } from "./roster";
import type { Terminal } from "./terminals";
import type { Watcher } from "./watch";

export const DEBOUNCE_MS = 3_000;
const FOLDER_MAX = 40;
const NAME_MAX = 60;
const BODY_MAX = 120;

type Transition = "needs-you" | "finished";

const WORDS: Record<Transition, { title: string; fallback: string; status: string }> = {
  "needs-you": { title: "needs you", fallback: "Waiting for your answer.", status: "blocked" },
  finished: { title: "finished", fallback: "Finished.", status: "done" },
};

// A notification shows text, not markup, so nothing is escaped.
const COLOUR_CODES = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const CONTROL_CHARS = "\\u0000-\\u001f\\u007f-\\u009f";
const ZERO_WIDTH_CHARS = "\\u200b-\\u200d\\ufeff";
const DIRECTION_CHARS = "\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069";
const UNSAFE = new RegExp(`[${CONTROL_CHARS}${ZERO_WIDTH_CHARS}${DIRECTION_CHARS}]+`, "gu");
export function plainText(text: string, max: number) {
  const characters = [...text.replace(COLOUR_CODES, "").replace(UNSAFE, " ").replace(/\s+/gu, " ").trim()];
  return characters.length > max ? `${characters.slice(0, max - 1).join("").trimEnd()}…` : characters.join("");
}

export function notificationFor(terminal: Terminal, transition: Transition): Payload {
  const { folder } = describeTerminal(terminal);
  const words = WORDS[transition];
  return {
    title: `${plainText(folder, FOLDER_MAX)} · ${plainText(terminalName(terminal), NAME_MAX)} ${words.title}`,
    body: plainText(terminal.latest_line ?? "", BODY_MAX) || words.fallback,
    pane_id: terminal.pane_id,
    tag: `pane-${terminal.pane_id}`,
  };
}

const transitionOf = (previous: string | undefined, status: string): Transition | null => {
  if (previous === status) return null;
  if (status === "blocked") return "needs-you";
  if (status === "done" && previous === "working") return "finished";
  return null;
};

export function createNotifier({
  events,
  herdr,
  roster,
  push,
  watcher,
  debounceMs = DEBOUNCE_MS,
}: {
  events: Pick<LiveEvents, "subscribe">;
  herdr: Pick<Herdr, "list">;
  roster: Pick<ReturnType<typeof createRoster>, "terminal">;
  push: Pick<Push, "broadcast" | "hasSubscribers">;
  watcher: Pick<Watcher, "viewed">;
  debounceMs?: number;
}) {
  const statuses = new Map<string, string>();
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();

  async function seedUnheardStatuses() {
    try {
      const agents = await herdr.list();
      const listed = new Set(agents.map((agent) => agent.pane_id));
      for (const paneId of [...statuses.keys()]) if (!listed.has(paneId)) statuses.delete(paneId);
      for (const agent of agents) if (!statuses.has(agent.pane_id)) statuses.set(agent.pane_id, agent.agent_status);
    } catch (error) {
      if (!(error instanceof HerdrError)) console.error(error);
    }
  }

  const superseded = (paneId: string, transition: Transition) => waiting.has(paneId) || statuses.get(paneId) !== WORDS[transition].status;

  async function notify(paneId: string, transition: Transition) {
    waiting.delete(paneId);
    if (!push.hasSubscribers()) return;
    try {
      const terminal = await roster.terminal(paneId);
      if (superseded(paneId, transition)) return;
      if (!terminal || terminal.status !== WORDS[transition].status) return;
      if (watcher.viewed(paneId)) return;
      await push.broadcast(notificationFor(terminal, transition));
    } catch (error) {
      if (!(error instanceof HerdrError)) console.error(error);
    }
  }

  function onChange(paneId: string, status: string) {
    const previous = statuses.get(paneId);
    if (previous === status) return;
    statuses.set(paneId, status);
    clearTimeout(waiting.get(paneId));
    waiting.delete(paneId);
    const transition = transitionOf(previous, status);
    if (transition) waiting.set(paneId, setTimeout(() => notify(paneId, transition), debounceMs));
  }

  function onEvent(event: LiveEvent) {
    if (event.type === "live" && event.live) seedUnheardStatuses();
    if (event.type === "change") for (const changed of event.changed ?? []) onChange(changed.pane_id, changed.agent_status);
  }

  return {
    start: () => events.subscribe(onEvent),
    stop() {
      for (const timer of waiting.values()) clearTimeout(timer);
      waiting.clear();
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
