// Push notifications (D32): turns herdr's status changes into notifications.
//
// An Agent that becomes blocked "needs you"; one that goes from working to done
// has "finished". Nothing else notifies: not a Shell, not idle, not a change
// that doesn't start from working. A change is looked at again DEBOUNCE_MS
// after it, and only if the Agent is still in that state and nothing newer came
// in: an Agent that flaps notifies once, or not at all. A Terminal a page is
// viewing right now (the watch registry, D30) is no news to that page, so it
// isn't notified either. The notifier only reads; it never sends input.
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

// Plain text for a notification: colour codes go, other control and
// direction-changing characters become spaces, runs of space one, and it is cut
// to `max` characters with an ellipsis. A notification shows text, not markup,
// so nothing is escaped.
const COLOUR_CODES = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/gu;
export function plainText(text: string, max: number) {
  const characters = [...text.replace(COLOUR_CODES, "").replace(UNSAFE, " ").replace(/\s+/gu, " ").trim()];
  return characters.length > max ? `${characters.slice(0, max - 1).join("").trimEnd()}…` : characters.join("");
}

// `<folder> · <name> needs you`, named as everywhere in the app (D31, web/terminals.js),
// with the Agent's question or Latest line as the body.
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

// Only a status that differs from the last one gets here (onChange).
const transitionOf = (previous: string | undefined, status: string): Transition | null => {
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
  // Each Agent's status as last heard, and the changes waiting out the debounce.
  const statuses = new Map<string, string>();
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();

  // What herdr lists now, for the Agents no event has been heard about yet, so
  // the first change of each one has a "before". Nothing is notified from here.
  async function remember() {
    try {
      const agents = await herdr.list();
      const listed = new Set(agents.map((agent) => agent.pane_id));
      for (const paneId of [...statuses.keys()]) if (!listed.has(paneId)) statuses.delete(paneId);
      for (const agent of agents) if (!statuses.has(agent.pane_id)) statuses.set(agent.pane_id, agent.agent_status);
    } catch (error) {
      if (!(error instanceof HerdrError)) console.error(error);
    }
  }

  async function notify(paneId: string, transition: Transition) {
    waiting.delete(paneId);
    if (!push.hasSubscribers()) return;
    try {
      const terminal = await roster.terminal(paneId);
      // Another change came in while herdr was asked: that one decides.
      if (waiting.has(paneId) || statuses.get(paneId) !== WORDS[transition].status) return;
      // A Shell has no status, so it never matches.
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
    if (event.type === "live" && event.live) remember();
    if (event.type === "change") for (const changed of event.changed ?? []) onChange(changed.pane_id, changed.agent_status);
  }

  return {
    start: () => events.subscribe(onEvent),
    // Forgets the changes still waiting.
    stop() {
      for (const timer of waiting.values()) clearTimeout(timer);
      waiting.clear();
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
