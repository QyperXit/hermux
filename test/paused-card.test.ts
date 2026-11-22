import { describe, expect, test } from "bun:test";
import { createAttachment } from "../web/attach.js";
import { composerHtml } from "../web/composer.js";
import { drawTerminalControls } from "../web/controls.js";
import { calmLine, homeLists, memoryStorage, summaryLine } from "../web/home.js";
import { createKeyBar } from "../web/key-bar.js";
import { attachPausedCard } from "../web/paused-card.js";
import { attachQuestionCard } from "../web/question-card.js";
import { readerParts } from "../web/reader.js";
import { activityRowsHtml, allRowHtml } from "../web/rows.js";
import { readScreen } from "../web/screen.js";
import { stripHtml } from "../web/subagent-strip.js";
import { STATE_WORDS } from "../web/terminals.js";
import type { Agent } from "../web/types.js";
import { cssRules, declarations } from "./support/css";
import { asPageElement, fakePage } from "./support/fake-dom";
import { fakeClock } from "./support/key-bar";
import * as A from "./support/atomic-0100";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const atomic = (status: string) => ({ pane_id: "w8:p1", kind: "atomic", status, cwd: "/home/you/garden", title: null, tab: { id: "w8:t1", label: "garden", number: 1 }, workspace: { id: "w8", label: "garden" } });
const agent = (pane_id: string, agent_status: string, extra: Partial<Agent> = {}): Agent => ({
  pane_id,
  agent: "atomic",
  agent_status,
  cwd: `/home/you/${pane_id.replace(":", "-")}`,
  terminal_title_stripped: "atomic",
  state_change_seq: 5,
  ...extra,
});

function controlsScreen() {
  const { root } = fakePage(`${stripHtml()}<div class="output" tabindex="0"></div><div class="controls">${composerHtml()}<p class="notice"></p></div>`);
  const page = asPageElement(root);
  const keyBar = createKeyBar({ storage: memoryStorage(), timers: fakeClock().timers });
  keyBar.attach(page, { sendKey: () => {}, sendText: () => {}, announce: () => {} });
  const attachment = createAttachment({
    client: { isSample: false, uploadImage: async () => ({ path: "", name: "", size: 0 }) } as unknown as Parameters<typeof createAttachment>[0]["client"],
    previews: { create: () => "blob:x", revoke: () => {} },
    prepare: async (file) => ({ blob: file, name: file.name }),
  });
  attachment.attach(page);
  const opened: (() => void)[] = [];
  attachQuestionCard(page, async () => {});
  attachPausedCard(page, () => new Promise<void>((resolve) => opened.push(resolve)));
  const draw = (status: string, screen: string) => drawTerminalControls(page, { terminal: atomic(status), sending: false, screen: readScreen(screen) }, { keyBar, attachment });
  const card = () => root.querySelector(".paused-card")!;
  const show = () => root.querySelector(".paused-card-open")!;
  return { root, draw, card, show, opened };
}

describe("an agent with only paused helpers (sketch left, \"Paused, quietly\")", () => {
  test("reads \"Paused\", with its own mark: no lamp, no orange", () => {
    expect(STATE_WORDS.paused).toBe("Paused");
    const mark = declarations('[data-status="paused"] > .lamp');
    expect(mark).toMatchObject({ "border-radius": "0", "box-shadow": "none" });
    expect(mark.background).toContain("var(--ink-soft)");
    expect(JSON.stringify(mark)).not.toContain("signal");
    expect(cssRules.some((rule) => rule.selectors.includes('.lamp[data-status="paused"]'))).toBe(true);
  });

  test("sits in Activity, not the Inbox, with its line quiet, and the summary counts it apart from working", () => {
    const store = memoryStorage();
    const paused = agent("w1:p1", "paused", { latest_line: "asker is paused · send to continue", completion_seq: 3, since: Date.now() - 12 * 60_000 });
    const lists = homeLists([paused, agent("w1:p2", "working")], store);
    expect(lists.blocked).toEqual([]);
    expect(lists.finished).toEqual([]);
    expect(lists.working.map((each) => each.pane_id)).toEqual(["w1:p2"]);
    expect(lists.activity.map(({ agent: each }) => each.pane_id)).toEqual(["w1:p1", "w1:p2"]);
    expect(summaryLine(lists)).toBe("Nothing needs you · 1 working · 1 paused");
    expect(calmLine(lists)).toBe("Nothing new. 1 working · 1 paused.");
    expect(calmLine(homeLists([paused], store))).toBe("Nothing new. 1 paused.");
    expect(calmLine(homeLists([agent("w1:p2", "working"), agent("w1:p4", "working")], store))).toBe("Nothing new. 2 working.");
    const row = activityRowsHtml([{ agent: paused, older: false }])[0];
    expect(row).toContain('data-status="paused"');
    expect(row).toContain('<span class="row-line is-quiet">asker is paused · send to continue</span>');
    expect(row).toContain("12 min");
    expect(allRowHtml(agent("w1:p3", "paused"))).toContain(">Paused<");
  });

  test("opening it shows the card: \"A helper is paused · send it a message to carry on\" and one Show helpers key, no lamp", () => {
    const { draw, card, root } = controlsScreen();
    draw("paused", A.PAUSED_MAIN_SCREEN);
    expect(card().shown).toBe(true);
    expect(card().querySelector(".lamp")).toBeNull();
    expect(card().querySelector(".paused-card-heading")!.textContent).toBe("A helper is paused · send it a message to carry on");
    expect(card().querySelector(".paused-card-heading strong")!.textContent).toBe("A helper is paused");
    expect(card().querySelectorAll("button")).toHaveLength(1);
    expect(card().querySelector("button")!.textContent).toBe("Show helpers");
    expect(root.querySelector(".question-card")!.shown).toBe(false);
    expect(root.querySelector(".composer")!.shown).toBe(true);
  });

  test("Show helpers runs once while in flight; with a draft in Atomic's prompt it says why and does nothing", async () => {
    const { draw, show, opened, card } = controlsScreen();
    draw("paused", A.PAUSED_MAIN_SCREEN);
    show().dispatch("click", { detail: 1 });
    show().dispatch("click", { detail: 1 });
    expect(opened).toHaveLength(1);
    expect(show().disabled).toBe(true);
    opened[0]();
    await flush();
    expect(show().disabled).toBe(false);
    draw("paused", A.PAUSED_MAIN_SCREEN.replace("❯ \u001b[0m\u001b[7m \u001b[0m", "❯ half a thought\u001b[0m\u001b[7m \u001b[0m"));
    expect(card().querySelector(".paused-card-note")!.textContent).toContain("draft");
    expect(show().disabled).toBe(true);
    show().dispatch("click", { detail: 1 });
    expect(opened).toHaveLength(1);
  });

  test("with /tasks on screen the card points at its rows, which are the keys", () => {
    const { draw, card, show } = controlsScreen();
    draw("paused", A.TASKS_PAUSED_SCREEN);
    expect(card().shown).toBe(true);
    expect(show().shown).toBe(false);
    expect(card().querySelector(".paused-card-note")!.textContent).toBe("Tap the paused helper in the list to open it.");
    const parts = readerParts(A.TASKS_PAUSED_DOWN_SCREEN).join("");
    expect(parts).toContain('data-task="0"');
    expect(parts).toContain('data-task-name="asker"');
    expect(parts.match(/<button class="task-open"/g)).toHaveLength(1);
    expect(readerParts(A.TASKS_PAUSED_WIDE_SCREEN).join("")).toContain('data-task-name="worker"');
    expect(readerParts(A.TASKS_SCREEN).join("")).not.toContain("data-task");
    expect(declarations(".task-open")).toMatchObject({ "min-height": "var(--key)" });
  });

  test("hidden unless the agent is paused, while a helper is on screen, and never over a waiting helper's card", () => {
    const { draw, card, root } = controlsScreen();
    draw("working", A.PAUSED_MAIN_SCREEN);
    expect(card().shown).toBe(false);
    draw("paused", A.PAUSED_SHOWN_SCREEN);
    expect(card().shown).toBe(false);
    draw("blocked", A.WAITING_SCREEN);
    expect([card().shown, root.querySelector(".question-card")!.shown]).toEqual([false, true]);
  });

  test("the card hides while typing or editing keys, as the subagent card does", () => {
    const hiding = cssRules.filter((rule) => rule.declarations.display === "none").flatMap((rule) => rule.selectors);
    for (const selector of [".app.is-composing .paused-card", ".app.is-editing-keys .paused-card", ".app.is-editing-commands .paused-card"]) expect(hiding).toContain(selector);
  });
});
