// Atomic 0.10 tells herdr it is working while one of its subagents waits for
// an answer, so herdr's events never say it needs you. This passes herdr's
// events on, and while herdr calls an agent working it looks at the agent's
// screen every few seconds (the read its Latest line takes, reused as that
// is): a waiting subagent turns the agent's status to blocked in the events,
// for the page and for notifications, until it no longer waits.
import type { ChangedTerminal, LiveEvent, LiveEvents } from "./events";
import { HerdrError } from "./herdr";
import { shownStatus, type createRoster } from "./roster";

const LOOK_MS = 5_000;

export function createNeedsYou({
  events,
  roster,
  lookMs = LOOK_MS,
}: {
  events: Pick<LiveEvents, "subscribe" | "isLive">;
  roster: Pick<ReturnType<typeof createRoster>, "lookForWaiting">;
  lookMs?: number;
}) {
  const listeners = new Set<(event: LiveEvent) => void>();
  const herdrStatus = new Map<string, string>();
  const waiting = new Set<string>();
  let seeded = false;
  let looking = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe = () => {};

  const emit = (event: LiveEvent) => {
    for (const listener of listeners) listener(event);
  };

  const shown = (paneId: string, status: string) => shownStatus(status, waiting.has(paneId));

  function onEvent(event: LiveEvent) {
    if (event.type === "live" && event.live) seeded = false;
    if (event.type !== "change" || !event.changed) {
      emit(event);
      return;
    }
    const changed = event.changed.map((change): ChangedTerminal => {
      herdrStatus.set(change.pane_id, change.agent_status);
      if (change.agent_status !== "working") waiting.delete(change.pane_id);
      return { ...change, agent_status: shown(change.pane_id, change.agent_status) };
    });
    emit({ ...event, changed });
  }

  async function look() {
    if (looking || !events.isLive() || (seeded && ![...herdrStatus.values()].includes("working"))) return;
    looking = true;
    try {
      const agents = await roster.lookForWaiting();
      const seeding = !seeded;
      seeded = true;
      const listed = new Set(agents.map((agent) => agent.pane_id));
      for (const paneId of [...herdrStatus.keys()]) if (!listed.has(paneId)) herdrStatus.delete(paneId);
      const changed: ChangedTerminal[] = [];
      for (const { pane_id, agent_status, waiting: waits } of agents) {
        herdrStatus.set(pane_id, agent_status);
        if (waits === waiting.has(pane_id)) continue;
        if (waits) waiting.add(pane_id);
        else waiting.delete(pane_id);
        changed.push({ pane_id, agent_status: shown(pane_id, agent_status) });
      }
      for (const paneId of [...waiting]) if (!listed.has(paneId)) waiting.delete(paneId);
      if (changed.length && !seeding) emit({ type: "change", changed, refetch: true });
    } catch (error) {
      if (!(error instanceof HerdrError)) console.error(error);
    } finally {
      looking = false;
    }
  }

  return {
    start() {
      if (timer) return;
      unsubscribe = events.subscribe(onEvent);
      timer = setInterval(look, lookMs);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
      unsubscribe();
    },
    // A listener hears the current `live` state at once, then every event.
    subscribe(listener: (event: LiveEvent) => void) {
      listeners.add(listener);
      listener({ type: "live", live: events.isLive() });
      return () => {
        listeners.delete(listener);
      };
    },
    isLive: () => events.isLive(),
    look,
  };
}
