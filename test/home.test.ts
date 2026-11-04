import { expect, test } from "bun:test";
import { RECENT_IDLE_READS } from "../web/activity.js";
import { activityLinePanes, allAgents, calmLine, homeLists, memoryStorage, missingActivityLines, olderKeyLabel, recordFirstSight, recordOpened, summaryLine } from "../web/home.js";
import { listRenderer } from "../web/list-render.js";

type Agent = { pane_id: string; agent_status: string; state_change_seq?: number; completion_seq?: number; cwd: string; terminal_title_stripped: string };
type Store = ReturnType<typeof memoryStorage>;

const storage = (): Store => memoryStorage();
const stored = (store: Store) =>
  Object.fromEntries(Array.from({ length: store.length }, (_, index) => [store.key(index), store.getItem(store.key(index)!)]));

const agent = (pane_id: string, agent_status: string, seqs: { state_change_seq?: number; completion_seq?: number } = {}): Agent => ({
  pane_id,
  agent_status,
  ...seqs,
  cwd: `/home/you/${pane_id.replace(":", "-")}`,
  terminal_title_stripped: `atomic - ${pane_id.replace(":", "-")}`,
});

const panes = (list: Agent[]) => list.map((entry) => entry.pane_id);

// One list refresh: the page records first sight, then works out home.
function visit(agents: Agent[], store: Store) {
  recordFirstSight(store, agents);
  return homeLists(agents, store);
}

test("a finished agent is in the Inbox until it is opened, and returns only when it completes again", () => {
  const store = storage();
  let brainDump = agent("wA:pD", "done", { state_change_seq: 384, completion_seq: 384 });
  expect(panes(visit([brainDump], store).finished)).toEqual(["wA:pD"]);

  recordOpened(store, brainDump);
  expect(panes(visit([brainDump], store).finished)).toEqual([]);

  brainDump = agent("wA:pD", "idle", { state_change_seq: 384, completion_seq: 384 });
  expect(panes(visit([brainDump], store).finished)).toEqual([]);

  brainDump = agent("wA:pD", "working", { state_change_seq: 389 });
  expect(panes(visit([brainDump], store).finished)).toEqual([]);
  expect(panes(visit([brainDump], store).working)).toEqual(["wA:pD"]);

  brainDump = agent("wA:pD", "done", { state_change_seq: 390, completion_seq: 390 });
  expect(panes(visit([brainDump], store).finished)).toEqual(["wA:pD"]);
});

test("an opened agent that completes again and is then cleared on the laptop stays in the Inbox until opened here", () => {
  const store = storage();
  recordOpened(store, agent("w8:p1", "done", { state_change_seq: 100, completion_seq: 100 }));
  const cleared = agent("w8:p1", "idle", { state_change_seq: 118, completion_seq: 118 });
  expect(panes(visit([cleared], store).finished)).toEqual(["w8:p1"]);
  recordOpened(store, cleared);
  expect(panes(visit([cleared], store).finished)).toEqual([]);
});

test("first visit: an agent never opened here counts as finished only while herdr says done", () => {
  const store = storage();
  const lists = visit(
    [
      agent("w8:p1", "idle", { state_change_seq: 118, completion_seq: 118 }),
      agent("w9:pF", "idle", { state_change_seq: 88, completion_seq: 88 }),
      agent("wA:pD", "done", { state_change_seq: 359, completion_seq: 359 }),
      agent("wA:pE", "idle", { state_change_seq: 10 }),
    ],
    store,
  );
  expect(panes(lists.finished)).toEqual(["wA:pD"]);
  expect(activity(lists)).toEqual(["w8:p1", "w9:pF", "wA:pE"]);
  expect(lists.olderCount).toBe(0);
});

test("a never-opened finished agent stays in the Inbox when it turns idle, and leaves only when opened here", () => {
  const store = storage();
  const done = agent("wA:pD", "done", { state_change_seq: 10, completion_seq: 10 });
  expect(panes(visit([done], store).finished)).toEqual(["wA:pD"]);

  const cleared = agent("wA:pD", "idle", { state_change_seq: 11, completion_seq: 10 });
  expect(panes(visit([cleared], store).finished)).toEqual(["wA:pD"]);

  recordOpened(store, cleared);
  expect(panes(visit([cleared], store).finished)).toEqual([]);

  const again = agent("wA:pD", "done", { state_change_seq: 20, completion_seq: 20 });
  expect(panes(visit([again], store).finished)).toEqual(["wA:pD"]);
});

test("first sight: an agent seen idle with an old completion is not in the Inbox, and its next completion is", () => {
  const store = storage();
  expect(panes(visit([agent("w8:p1", "idle", { state_change_seq: 118, completion_seq: 118 })], store).finished)).toEqual([]);
  expect(panes(visit([agent("w8:p1", "working", { state_change_seq: 130 })], store).finished)).toEqual([]);
  expect(panes(visit([agent("w8:p1", "done", { state_change_seq: 140, completion_seq: 140 })], store).finished)).toEqual(["w8:p1"]);
  expect(panes(visit([agent("w8:p1", "idle", { state_change_seq: 141, completion_seq: 140 })], store).finished)).toEqual(["w8:p1"]);
});

test("first sight: an agent first seen working, then done with its first completion, is in the Inbox", () => {
  const store = storage();
  expect(panes(visit([agent("w9:pF", "working", { state_change_seq: 5 })], store).finished)).toEqual([]);
  expect(panes(visit([agent("w9:pF", "done", { state_change_seq: 6, completion_seq: 6 })], store).finished)).toEqual(["w9:pF"]);
});

test("first load: the baseline for every pane in the first list is its current completion, so none of their old completions are in the Inbox", () => {
  const store = storage();
  const firstList = [
    agent("w8:p1", "idle", { state_change_seq: 118, completion_seq: 118 }),
    agent("w9:pF", "idle", { state_change_seq: 88, completion_seq: 88 }),
    agent("wA:pD", "idle", { state_change_seq: 359, completion_seq: 359 }),
    agent("w9:pE", "idle", { state_change_seq: 5 }),
  ];
  expect(panes(visit(firstList, store).finished)).toEqual([]);
  expect(stored(store)).toEqual({
    "agents.opened-completion.w8:p1": "118",
    "agents.opened-completion.w9:pF": "88",
    "agents.opened-completion.wA:pD": "359",
    "agents.opened-completion.w9:pE": "null",
  });
});

test("app in use: a new pane first seen idle with a completion it finished while the page was hidden is in the Inbox until opened", () => {
  const store = storage();
  visit([agent("w8:p1", "idle", { state_change_seq: 118, completion_seq: 118 })], store);

  const fresh = agent("wB:p1", "idle", { state_change_seq: 41, completion_seq: 40 });
  const list = [agent("w8:p1", "idle", { state_change_seq: 118, completion_seq: 118 }), fresh];
  expect(panes(visit(list, store).finished)).toEqual(["wB:p1"]);
  expect(panes(visit(list, store).finished)).toEqual(["wB:p1"]);

  recordOpened(store, fresh);
  expect(panes(visit(list, store).finished)).toEqual([]);
});

test("app in use: a new pane first seen working is not in the Inbox until its first completion", () => {
  const store = storage();
  visit([agent("w8:p1", "idle", { state_change_seq: 118, completion_seq: 118 })], store);
  expect(panes(visit([agent("wB:p2", "working", { state_change_seq: 3 })], store).finished)).toEqual([]);
  expect(panes(visit([agent("wB:p2", "idle", { state_change_seq: 4 })], store).finished)).toEqual([]);
  expect(panes(visit([agent("wB:p2", "idle", { state_change_seq: 9, completion_seq: 8 })], store).finished)).toEqual(["wB:p2"]);
});

test("first sight is recorded once per pane and never overwrites an opened agent", () => {
  const store = storage();
  recordFirstSight(store, [agent("w8:p1", "idle", { completion_seq: 118 }), agent("w9:pE", "done", { completion_seq: 3 })]);
  recordOpened(store, agent("wA:pD", "done", { completion_seq: 5 }));
  recordFirstSight(store, [agent("wA:pD", "idle", { completion_seq: 9 }), agent("w8:p1", "idle", { completion_seq: 500 }), agent("w9:pF", "idle", { completion_seq: 7 })]);
  expect(stored(store)).toEqual({
    "agents.opened-completion.w8:p1": "118",
    "agents.opened-completion.w9:pE": "null",
    "agents.opened-completion.wA:pD": "5",
    "agents.opened-completion.w9:pF": "null",
  });
});

test("opening an agent stores its completion_seq per pane, or null when it has none", () => {
  const store = storage();
  recordOpened(store, agent("wA:pD", "done", { state_change_seq: 384, completion_seq: 384 }));
  recordOpened(store, agent("w9:pE", "idle", { state_change_seq: 5 }));
  expect(stored(store)).toEqual({ "agents.opened-completion.wA:pD": "384", "agents.opened-completion.w9:pE": "null" });
  expect(panes(visit([agent("w9:pE", "idle", { state_change_seq: 6, completion_seq: 6 })], store).finished)).toEqual(["w9:pE"]);
});

test("home: blocked agents always in the Inbox, working and unknown always in Activity", () => {
  const store = storage();
  const lists = visit(
    [
      agent("w1:p1", "idle", { state_change_seq: 50 }),
      agent("w1:p2", "working", { state_change_seq: 40 }),
      agent("w1:p3", "blocked", { state_change_seq: 30 }),
      agent("w1:p4", "unknown", { state_change_seq: 60 }),
      agent("w1:p5", "blocked", { state_change_seq: 70 }),
      agent("w1:p6", "done", { state_change_seq: 20, completion_seq: 20 }),
      agent("w1:p7", "done", { state_change_seq: 80, completion_seq: 80 }),
    ],
    store,
  );
  expect(panes(lists.blocked)).toEqual(["w1:p5", "w1:p3"]);
  expect(panes(lists.finished)).toEqual(["w1:p7", "w1:p6"]);
  expect(panes(lists.working)).toEqual(["w1:p4", "w1:p2"]);
  expect(activity(lists)).toEqual(["w1:p4", "w1:p1", "w1:p2"]);
  expect(lists.olderCount).toBe(0);
  recordOpened(store, agent("w1:p3", "done", { completion_seq: 1 }));
  expect(panes(visit([agent("w1:p3", "blocked", { state_change_seq: 30, completion_seq: 25 })], store).finished)).toEqual([]);
});

// Activity rows as [pane, "older"?] in the order shown.
const activity = (lists: ReturnType<typeof homeLists>) =>
  lists.activity.map(({ agent: row, older }: { agent: Agent; older: boolean }) => (older ? `${row.pane_id} older` : row.pane_id));

test("Activity: working agents plus the 5 most recently active others, newest state_change_seq first; the newest 3 others full, the next 2 older", () => {
  const store = storage();
  const list = [
    agent("w1:p1", "idle", { state_change_seq: 10 }),
    agent("w1:p2", "working", { state_change_seq: 95 }),
    agent("w1:p3", "idle", { state_change_seq: 90 }),
    agent("w1:p4", "idle", { state_change_seq: 80 }),
    agent("w1:p5", "idle", { state_change_seq: 70 }),
    agent("w1:p6", "idle", { state_change_seq: 60 }),
    agent("w1:p7", "idle", { state_change_seq: 50 }),
    agent("w1:p8", "idle", { state_change_seq: 40 }),
    agent("w1:p9", "idle"),
    agent("w1:pA", "unknown", { state_change_seq: 5 }),
  ];
  const lists = visit(list, store);
  expect(activity(lists)).toEqual(["w1:p2", "w1:p3", "w1:p4", "w1:p5", "w1:p6 older", "w1:p7 older", "w1:pA"]);
  expect(lists.olderCount).toBe(3);
  expect(olderKeyLabel(lists.olderCount)).toBe("3 more older sessions");
});

test("Activity leaves out every Inbox agent, and the older-sessions count leaves out every agent shown above", () => {
  const store = storage();
  recordFirstSight(store, [agent("w0:p0", "idle", { completion_seq: 1 })]);
  const list = [
    agent("w1:p1", "blocked", { state_change_seq: 100 }),
    agent("w1:p2", "idle", { state_change_seq: 99, completion_seq: 98 }),
    agent("w1:p3", "done", { state_change_seq: 97, completion_seq: 97 }),
    agent("w1:p4", "idle", { state_change_seq: 96 }),
    agent("w1:p5", "idle", { state_change_seq: 95 }),
    agent("w1:p6", "idle", { state_change_seq: 94 }),
    agent("w1:p7", "idle", { state_change_seq: 93 }),
    agent("w1:p8", "idle", { state_change_seq: 92 }),
    agent("w1:p9", "idle", { state_change_seq: 91 }),
  ];
  const lists = visit(list, store);
  expect(panes(lists.finished)).toEqual(["w1:p2", "w1:p3"]);
  expect(activity(lists)).toEqual(["w1:p4", "w1:p5", "w1:p6", "w1:p7 older", "w1:p8 older"]);
  expect(lists.olderCount).toBe(1);
  expect(olderKeyLabel(lists.olderCount)).toBe("1 more older sessions");

  recordOpened(store, list[2]);
  const opened = visit(list, store);
  expect(activity(opened)).toEqual(["w1:p3", "w1:p4", "w1:p5", "w1:p6 older", "w1:p7 older"]);
  expect(opened.olderCount).toBe(2);
  expect(olderKeyLabel(opened.olderCount)).toBe("2 more older sessions");
});

test("the page names the idle panes Activity shows, and asks again at once only when one of them wasn't read", () => {
  const store = storage();
  recordFirstSight(store, [agent("w0:p0", "idle", { completion_seq: 1 })]);
  const inboxIdle = [1, 2, 3, 4, 5].map((n) => agent(`w1:p${n}`, "idle", { state_change_seq: 100 + n, completion_seq: 100 + n }));
  const opened = agent("w2:pD", "done", { state_change_seq: 99, completion_seq: 99 });
  recordOpened(store, opened);
  const older = [10, 20, 30, 40, 50, 60].map((seq) => agent(`w3:p${seq}`, "idle", { state_change_seq: seq }));
  const list = [agent("w2:pW", "working", { state_change_seq: 98 }), opened, ...inboxIdle, ...older];
  const lists = visit(list, store);
  expect(panes(lists.finished)).toEqual(["w1:p5", "w1:p4", "w1:p3", "w1:p2", "w1:p1"]);
  expect(activityLinePanes(lists)).toEqual(["w3:p60", "w3:p50", "w3:p40", "w3:p30"]);

  const read = (agents: Agent[], readPanes: string[]) =>
    agents.map((entry) => (readPanes.includes(entry.pane_id) ? { ...entry, latest_line: null } : entry));
  const newestIdle = [...inboxIdle, ...older].sort((a, b) => (b.state_change_seq ?? 0) - (a.state_change_seq ?? 0)).slice(0, RECENT_IDLE_READS);
  const recentOnly = read(list, ["w2:pW", "w2:pD", ...panes(newestIdle)]);
  expect(missingActivityLines(homeLists(recentOnly, store))).toBe(true);
  expect(missingActivityLines(homeLists(read(recentOnly, ["w3:p30"]), store))).toBe(false);
  expect(missingActivityLines(homeLists(read(list, panes(older)), store))).toBe(false);
});

test("Activity with fewer than 5 others: the newest 3 full, any rest older, and no older sessions", () => {
  const store = storage();
  const four = [1, 2, 3, 4].map((seq) => agent(`w1:p${seq}`, "idle", { state_change_seq: seq }));
  const lists = visit(four, store);
  expect(activity(lists)).toEqual(["w1:p4", "w1:p3", "w1:p2", "w1:p1 older"]);
  expect(lists.olderCount).toBe(0);
  expect(olderKeyLabel(lists.olderCount)).toBe("0 more older sessions");
  expect(activity(visit(four.slice(0, 2), store))).toEqual(["w1:p2", "w1:p1"]);
});

test("a working agent is never older, even when strictly newer others sit above it", () => {
  const store = storage();
  const list = [
    agent("w1:p1", "working", { state_change_seq: 1 }),
    ...[10, 20, 30, 40, 50, 60].map((seq) => agent(`w2:p${seq}`, "idle", { state_change_seq: seq })),
  ];
  const lists = visit(list, store);
  expect(activity(lists)).toEqual(["w2:p60", "w2:p50", "w2:p40", "w2:p30 older", "w2:p20 older", "w1:p1"]);
  expect(lists.olderCount).toBe(1);
});

test("an agent that stops keeps its place at the top of Activity", () => {
  const store = storage();
  const others = [10, 20, 30, 40, 50, 60].map((seq) => agent(`w2:p${seq}`, "idle", { state_change_seq: seq }));
  expect(activity(visit([agent("w1:p1", "working", { state_change_seq: 70 }), ...others], store))[0]).toBe("w1:p1");
  expect(activity(visit([agent("w1:p1", "idle", { state_change_seq: 71 }), ...others], store))).toEqual([
    "w1:p1",
    "w2:p60",
    "w2:p50",
    "w2:p40 older",
    "w2:p30 older",
  ]);
});

test("#/all: every agent, blocked pinned on top, then newest state_change_seq first", () => {
  const list = [
    agent("w1:p1", "idle", { state_change_seq: 5 }),
    agent("w1:p2", "working", { state_change_seq: 380 }),
    agent("w1:p3", "blocked", { state_change_seq: 30 }),
    agent("w1:p4", "idle"),
    agent("w1:p5", "done", { state_change_seq: 384, completion_seq: 384 }),
    agent("w1:p6", "blocked", { state_change_seq: 387 }),
    agent("w1:p7", "idle", { state_change_seq: 118, completion_seq: 118 }),
    agent("w1:p8", "idle"),
  ];
  expect(panes(allAgents(list))).toEqual(["w1:p6", "w1:p3", "w1:p5", "w1:p2", "w1:p7", "w1:p1", "w1:p4", "w1:p8"]);
  expect(panes(list)).toEqual(["w1:p1", "w1:p2", "w1:p3", "w1:p4", "w1:p5", "w1:p6", "w1:p7", "w1:p8"]);
});

test("summary line and the calm line for an empty Inbox", () => {
  const store = storage();
  const busy = visit([agent("w1:p1", "blocked"), agent("w1:p2", "done", { completion_seq: 3 }), agent("w1:p3", "working"), agent("w1:p4", "unknown")], store);
  expect(summaryLine(busy)).toBe("1 needs you · 1 finished · 2 working");
  const quiet = visit([agent("w1:p3", "working"), agent("w1:p4", "working"), agent("w1:p5", "idle")], store);
  expect(summaryLine(quiet)).toBe("Nothing needs you · 2 working");
  expect(calmLine(quiet)).toBe("Nothing new. 2 working.");
  expect(calmLine(visit([agent("w1:p5", "idle")], store))).toBe("Nothing new.");
  expect(summaryLine(visit([agent("w1:p1", "blocked"), agent("w1:p2", "blocked")], store))).toBe("2 need you");
});

test("home and All are rebuilt only when their HTML changed; a changed clock alone replaces just the freshness line", () => {
  const view = listRenderer();
  const home = (html: string, freshness: string, shown = "home") => view.next({ screen: "home", shown, html, freshness });
  expect(home("<rows>", "Live · 14:05", "agent")).toBe("rebuild");
  expect(home("<rows>", "Live · 14:05")).toBe("none");
  expect(home("<rows>", "Live · 14:05")).toBe("none");
  expect(home("<rows>", "Live · 14:06")).toBe("freshness");
  expect(home("<rows>", "Live · 14:06")).toBe("none");
  expect(home("<rows changed>", "Live · 14:06")).toBe("rebuild");
  expect(home("<rows changed>", "Live · 14:06", "agent")).toBe("rebuild");
  expect(view.next({ screen: "all", shown: "home", html: "<rows changed>" })).toBe("rebuild");
  expect(view.next({ screen: "all", shown: "all", html: "<rows changed>" })).toBe("none");
  expect(home("<rows changed>", "Live · 14:06", "all")).toBe("rebuild");
});
