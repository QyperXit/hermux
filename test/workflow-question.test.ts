import { describe, expect, test } from "bun:test";
import { drawComposer } from "../web/composer.js";
import { attachQuestionCard, drawQuestionCard } from "../web/question-card.js";
import { promptBoxFree, readScreen } from "../web/screen.js";
import { blockedWorkflowAsk, choiceChooser, choiceKeys, openChooser, openKeys, workflowAsk } from "../web/workflow-question.js";
import { cssRules, declarations } from "./support/css";
import { asPageElement } from "./support/fake-dom";
import { keyBarScreen } from "./support/key-bar";
import { WORKFLOW_PICKER_SCREEN } from "./support/workflow-picker";
import {
  CROWDED_SCREEN,
  CUT_QUESTION,
  CUT_QUESTION_SCREEN,
  GENERAL_SCREEN,
  GRAPH_SCREEN,
  NOTHING_WAITING_SCREEN,
  ONE_QUESTION,
  ONE_QUESTION_SCREEN,
  ONE_RUN,
  PICKER_WITH_PANEL_SCREEN,
  STAGE_QUESTION_SCREEN,
  TWO_RUNS_SCREEN,
} from "./support/workflow-question";
import * as Atomic0990 from "./support/atomic-0990";

const askOf = (text: string) => workflowAsk(readScreen(text));
const GENERAL = { name: null, question: null, crowded: false };
const RUN_LIST_HINT = "  ↑↓ select · enter/→ to open · x stop · esc/← back to prompt · ? keys";
const FENCE = { name: "fence-check", question: ONE_QUESTION, crowded: false };

const panelScreen = (rows: string[]) =>
  [" Done.", "", " ↑1k • ↓2 • $0.010 (sub) • 1.0%/1.0M (auto)", "─".repeat(40), "❯", "─".repeat(40), "anthropic/claude-opus-5-5  medium • ~/projects/yard (main)", "", ...rows, " ↑↓ scroll · Alt+k/Alt+j"].join("\n");

describe("what Atomic's BACKGROUND panel says a workflow waits for", () => {
  test("one run with one question, beside a run that has ended: its name and the question as Atomic shows it", () => {
    expect(askOf(ONE_QUESTION_SCREEN)).toEqual(FENCE);
  });

  test("a question longer than the panel's row is as much of it as Atomic shows, ending in its …", () => {
    expect(askOf(CUT_QUESTION_SCREEN)).toEqual({ name: "garden-dry-run", question: CUT_QUESTION, crowded: false });
  });

  test("only general needs-attention guidance (a run with two questions) gives no name and no question", () => {
    expect(askOf(GENERAL_SCREEN)).toEqual(GENERAL);
  });

  test("two runs waiting, even with one preview among them, is general guidance, crowded: F2 may open the other", () => {
    expect(askOf(TWO_RUNS_SCREEN)).toEqual({ ...GENERAL, crowded: true });
  });

  test("a panel Atomic scrolls draws its right edge as a scrollbar; its ┃ thumb is an edge, not text", () => {
    const lines = readScreen(CROWDED_SCREEN).panel?.lines ?? [];
    expect(lines).toHaveLength(10);
    expect(lines.filter((line) => /[│┃]/.test(line))).toEqual([]);
    expect(lines[0]).toBe("BACKGROUND  2 runs  ● 2 running  ？ ↵ 2 needs attention (attach to workflow with `/workflow c…");
    expect(lines[5]).toBe("");
    expect(askOf(CROWDED_SCREEN)).toEqual({ ...GENERAL, crowded: true });
  });

  const panelTitle = (running: number) => `╭ BACKGROUND  2 runs  ● ${running} running  ？ ↵ 1 needs attention ─────────╮`;
  const otherRun = (glyph: string) => [
    `│   ${glyph}  8ac7c343-1cae-4457-9c01-4c7e3ee0fc85                │`,
    "│     slow-walk · single · 9s                                      │",
    "│                                                                  │",
  ];
  const fenceRun = [
    `│   ？  ${ONE_RUN}                │`,
    "│     fence-check · single · 0/1 · 20s                             │",
    `│     ${ONE_QUESTION}│`,
    `│     Answer: /workflow connect ${ONE_RUN}│`,
  ];
  const panelBottom = "╰──────────────────────────────────────────────────────────────────╯";

  test("one question while another run is still going is crowded; runs that have ended don't count", () => {
    expect(askOf(panelScreen([panelTitle(2), ...otherRun("●"), ...fenceRun, panelBottom]))).toEqual({ ...FENCE, crowded: true });
    expect(askOf(panelScreen([panelTitle(1), ...otherRun("✗"), ...fenceRun, panelBottom]))).toEqual(FENCE);
    expect(askOf(panelScreen([panelTitle(1), ...otherRun("✓"), ...fenceRun, panelBottom]))).toEqual(FENCE);
  });

  test("a title counting more than one run running is crowded, even with the other run out of view", () => {
    expect(askOf(panelScreen([panelTitle(2), ...fenceRun, panelBottom]))).toEqual({ ...FENCE, crowded: true });
  });

  test("a panel scrolled past its title may hide runs, so it is general guidance, crowded", () => {
    expect(askOf(panelScreen([...fenceRun, panelBottom]))).toEqual({ ...GENERAL, crowded: true });
  });

  test("nothing waiting, no panel, or the workflow graph: no ask", () => {
    expect(askOf(WORKFLOW_PICKER_SCREEN)).toBeNull();
    expect(askOf(" Done.\n\n Nothing to do.")).toBeNull();
    expect(askOf(GRAPH_SCREEN)).toBeNull();
    expect(askOf(STAGE_QUESTION_SCREEN)).toBeNull();
  });

  test("a run id Atomic wrapped onto the next rows is joined whole; one that is cut short gives general guidance", () => {
    const id = "8f3a1c20-5b64-4d8e-a791-2c3f0e6b9d44";
    const rows = (answer: string[]) => [
      "╭ BACKGROUND  1 run  ● 1 running  ？ ↵ 1 needs attention ─────────╮",
      `│   ？  ${id.slice(0, 30)}│`,
      `│     ${id.slice(30)}                          │`,
      "│     review-and-merge · single · 0/1 · 12m   │",
      '│     "Approve the migration?"                │',
      ...answer,
      "╰────────────────────────────────────────────╯",
    ];
    const wrapped = panelScreen(rows([`│     Answer: /workflow connect ${id.slice(0, 12)}│`, `│      ${id.slice(12)}  │`]));
    expect(askOf(wrapped)).toEqual({ name: "review-and-merge", question: '"Approve the migration?"', crowded: false });
    const cut = panelScreen(rows([`│     Answer: /workflow connect ${id.slice(0, 12)}│`]));
    expect(askOf(cut)).toEqual(GENERAL);
  });

  test("a panel scrolled past its title gives general guidance, crowded, even with one question in view", () => {
    const screen = readScreen(ONE_QUESTION_SCREEN);
    const scrolled = ONE_QUESTION_SCREEN.split("\n").filter((line) => !line.includes("BACKGROUND")).join("\n");
    expect(readScreen(scrolled).panel?.lines).toEqual(screen.panel?.lines.slice(1));
    expect(askOf(scrolled)).toEqual({ ...GENERAL, crowded: true });
  });
});

describe("a blocked Agent's message box and question card", () => {
  const read = (text: string) => readScreen(text);

  test("Atomic's prompt box is free on its main chat, and not under a question, the run picker, the graph or a stage's chat", () => {
    expect(promptBoxFree(read(ONE_QUESTION_SCREEN))).toBe(true);
    expect(promptBoxFree(read(GENERAL_SCREEN))).toBe(true);
    expect(promptBoxFree(read(NOTHING_WAITING_SCREEN))).toBe(true);
    for (const text of [PICKER_WITH_PANEL_SCREEN, WORKFLOW_PICKER_SCREEN, GRAPH_SCREEN, STAGE_QUESTION_SCREEN]) expect(promptBoxFree(read(text))).toBe(false);
  });

  test("with the question only in the BACKGROUND panel, the card shows what the panel says", () => {
    expect(blockedWorkflowAsk("blocked", read(ONE_QUESTION_SCREEN))).toEqual(FENCE);
    expect(blockedWorkflowAsk("blocked", read(GENERAL_SCREEN))).toEqual(GENERAL);
  });

  test("a block the panel doesn't explain has no card: no workflow waiting, the workflow graph, no prompt box", () => {
    const running = panelScreen(["╭ BACKGROUND  1 run  ● 1 running ─────────╮", "│   ●  958abe02-f7b9-4e7b-a2d6-867a19b47275  │", "│     goal · chain · 8/9 · 55m 58s          │", "╰──────────────────────────────────────────╯"]);
    for (const text of [running, NOTHING_WAITING_SCREEN, GRAPH_SCREEN, " Done.\n\n Nothing to do."]) expect(blockedWorkflowAsk("blocked", read(text))).toBeNull();
  });

  test("a question on the screen itself, the run picker or a stage's chat gives no card", () => {
    const dialog = [" Where should I upload it?", "", " ❯ 1. Internal testing", "   2. Closed testing", "   3. Production"].join("\n");
    for (const text of [dialog, STAGE_QUESTION_SCREEN, PICKER_WITH_PANEL_SCREEN]) expect(blockedWorkflowAsk("blocked", read(text))).toBeNull();
  });

  test("before the screen is read there is no card, nor for an Agent that isn't blocked, or a Shell", () => {
    expect(blockedWorkflowAsk("blocked", null)).toBeNull();
    for (const status of ["working", "idle", "done", undefined, null]) expect(blockedWorkflowAsk(status, read(ONE_QUESTION_SCREEN))).toBeNull();
  });
});

describe("number keys on a workflow stage's select", () => {
  const keysOf = (key: string, text: string) => choiceKeys(key, readScreen(text));
  const onDrop = STAGE_QUESTION_SCREEN.replace("→ Keep it", "  Keep it").replace("  \u001b[0m\u001b[38;2;127;132;156mDrop it", "→ \u001b[0m\u001b[38;2;127;132;156mDrop it");

  test("number key N moves the cursor from the selected option to the Nth, then presses Enter", () => {
    expect(["1", "2", "3"].map((key) => keysOf(key, STAGE_QUESTION_SCREEN))).toEqual([["enter"], ["down", "enter"], ["down", "down", "enter"]]);
    expect(onDrop).not.toBe(STAGE_QUESTION_SCREEN);
    expect(["1", "2", "3"].map((key) => keysOf(key, onDrop))).toEqual([["up", "up", "enter"], ["up", "enter"], ["enter"]]);
  });

  test("a number past the last option, a key that isn't a number, or no stage select on the screen leaves the key as it is", () => {
    for (const key of ["4", "0", "enter", "down", "left"]) expect(keysOf(key, STAGE_QUESTION_SCREEN)).toBeNull();
    const dialog = [" Where should I upload it?", "", " ❯ 1. Internal testing", "   2. Closed testing", "   3. Production"].join("\n");
    for (const text of [dialog, WORKFLOW_PICKER_SCREEN, PICKER_WITH_PANEL_SCREEN, ONE_QUESTION_SCREEN, GRAPH_SCREEN]) expect(keysOf("2", text)).toBeNull();
  });
});

function cardScreen() {
  const screen = keyBarScreen();
  const pressed: [string, string][] = [];
  const landed: (() => void)[] = [];
  attachQuestionCard(asPageElement(screen.root), (key, label) => {
    pressed.push([key, label]);
    return new Promise<void>((resolve) => landed.push(resolve));
  });
  const draw = (ask: ReturnType<typeof workflowAsk>) => drawQuestionCard(asPageElement(screen.root), ask, { target: "weather-app" });
  const card = () => screen.root.querySelector(".question-card")!;
  const crowded = () => card().querySelector(".question-card-crowded")!;
  return { screen, pressed, landed, draw, card, crowded };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const F2: [string, string] = ["f2", "Open the question"];

describe("the question card", () => {
  test("sits above the keys, and shows the lamp, who is asking, the whole question and one Open the question button", () => {
    const { screen, draw, card, crowded } = cardScreen();
    expect(card().shown).toBe(false);
    draw(askOf(ONE_QUESTION_SCREEN));
    const controls = screen.root.querySelector(".controls")!;
    expect(controls.children.map((child) => child.getAttribute("class")?.split(" ")[0]).indexOf("keys")).toBeGreaterThan(0);
    expect(controls.children[0]).toBe(card());
    expect(card().shown).toBe(true);
    expect(card().querySelector(".lamp")!.getAttribute("data-status")).toBe("blocked");
    expect(card().querySelector(".question-card-heading")!.textContent).toBe("A workflow is asking (fence-check)");
    expect(card().querySelector(".question-card-heading strong")!.textContent).toBe("A workflow is asking");
    expect(card().querySelector(".question-card-text")!.textContent).toBe(ONE_QUESTION);
    expect(crowded().shown).toBe(false);
    expect(card().querySelectorAll("button")).toHaveLength(1);
    expect(screen.button("Open the question in weather-app").getAttribute("type")).toBe("button");
  });

  test("its button presses Atomic's F2 through the key path, and types nothing", () => {
    const { screen, pressed, draw } = cardScreen();
    draw(askOf(ONE_QUESTION_SCREEN));
    screen.click(screen.button("Open the question in weather-app"));
    expect(pressed).toEqual([F2]);
    expect(screen.sentTexts).toEqual([]);
  });

  test("for general guidance it says a workflow needs you, shows no question, and presses F2 too", () => {
    const { screen, pressed, draw, card } = cardScreen();
    draw(askOf(GENERAL_SCREEN));
    expect(card().querySelector(".question-card-heading")!.textContent).toBe("A workflow needs you");
    expect(card().querySelector(".question-card-text")!.shown).toBe(false);
    screen.click(screen.button("Open the question in weather-app"));
    expect(pressed).toEqual([F2]);
  });

  test("with more than one run still going it says in plain words that F2 may open another one", () => {
    const { draw, crowded } = cardScreen();
    draw(askOf(TWO_RUNS_SCREEN));
    expect(crowded().shown).toBe(true);
    expect(crowded().textContent).toBe("More than one workflow is running, so this opens the newest one, which may not be the one asking.");
    draw(askOf(CUT_QUESTION_SCREEN));
    expect(crowded().shown).toBe(false);
  });

  test("a later draw replaces what it shows, and no ask hides the card", () => {
    const { draw, card } = cardScreen();
    draw(askOf(ONE_QUESTION_SCREEN));
    draw(askOf(CUT_QUESTION_SCREEN));
    expect(card().querySelector(".question-card-text")!.textContent).toBe(CUT_QUESTION);
    draw(null);
    expect(card().shown).toBe(false);
  });

  test("while its own F2 press is in flight the button is busy, so a double tap sends F2 once", async () => {
    const { pressed, landed, draw, card } = cardScreen();
    draw(askOf(ONE_QUESTION_SCREEN));
    const open = card().querySelector("button")!;
    const busy = () => [open.disabled, open.getAttribute("aria-busy")];
    expect(busy()).toEqual([false, "false"]);
    open.dispatch("click", { detail: 1 });
    open.dispatch("click", { detail: 1 });
    expect(pressed).toEqual([F2]);
    expect(busy()).toEqual([true, "true"]);
    draw(askOf(ONE_QUESTION_SCREEN));
    expect(busy()).toEqual([true, "true"]);
    landed[0]();
    await flush();
    expect(busy()).toEqual([false, "false"]);
    open.dispatch("click", { detail: 1 });
    expect(pressed).toEqual([F2, F2]);
  });

  test("a hostile question or workflow name stays text", () => {
    const { draw, card } = cardScreen();
    const hostile = `<img src=x onerror="alert(1)">&amp;`;
    draw({ name: `<b>${hostile}</b>`, question: hostile, crowded: false });
    expect(card().querySelectorAll("img, b")).toEqual([]);
    expect(card().querySelector(".question-card-text")!.textContent).toBe(hostile);
    expect(card().querySelector(".question-card-heading")!.textContent).toBe(`A workflow is asking (<b>${hostile}</b>)`);
  });

  test("the card stands in for the blocked note; the message box, attach and / stay hidden", () => {
    const { screen, draw } = cardScreen();
    const ask = blockedWorkflowAsk("blocked", readScreen(ONE_QUESTION_SCREEN));
    drawComposer(asPageElement(screen.root), { target: "weather-app", sending: false, blocked: true, withNote: !ask });
    draw(ask);
    expect(screen.root.querySelector(".composer")!.shown).toBe(false);
    expect(screen.root.querySelector(".blocked-note")!.shown).toBe(false);
    drawComposer(asPageElement(screen.root), { target: "weather-app", sending: false, blocked: true });
    expect(screen.root.querySelector(".blocked-note")!.shown).toBe(true);
  });

  test("its button is a 48px dark key across the card, and the card hides while typing or editing keys", () => {
    expect(declarations(".act")).toMatchObject({ height: "var(--key)" });
    expect(declarations(".question-card-open")).toMatchObject({ width: "100%" });
    const hiding = cssRules.filter((rule) => rule.declarations.display === "none").flatMap((rule) => rule.selectors);
    expect(declarations("[hidden]")).toMatchObject({ display: "none !important" });
    for (const selector of [".app.is-composing .question-card", ".app.is-editing-keys .question-card", ".app.is-editing-commands .question-card"]) expect(hiding).toContain(selector);
  });
});

describe("Atomic 0.9.90's list of runs under its footer", () => {
  const LAMP = { name: "lamp-check", question: "Paint the new fence green, or keep the old brown? The paint s...", crowded: false };
  const listScreen = (rows: string[]) => [" Done.", "", "↑1k • ↓2 • $0.010 (sub) • 1.0%/1.0M (auto)", "─".repeat(40), "❯", "─".repeat(40), "anthropic/claude-opus-5-5  medium • ~/projects/yard · 1 needs input · ? keys", "", ...rows].join("\n");

  test("one run waiting on one question: its name and the question as far as Atomic shows it", () => {
    expect(askOf(Atomic0990.ONE_QUESTION_SCREEN)).toEqual(LAMP);
  });

  test("with another run still going it is crowded; a run that ended doesn't count", () => {
    expect(askOf(Atomic0990.CROWDED_SCREEN)).toEqual({ ...LAMP, question: "Paint the new fence green, or keep the old brown? The paint shop...", crowded: true });
    const waiting = "  ◆ lamp-check  Is it dry yet?  needs input · 9s";
    expect(askOf(listScreen([waiting, "  ✗ slow-walk    Workflow run failed  failed · 3m", "  ✓ tidy-up      complete · 1m"]))).toEqual({ name: "lamp-check", question: "Is it dry yet?", crowded: false });
  });

  test("a run waiting on several questions shows its stage, not a question, and two runs waiting is general guidance, crowded", () => {
    expect(askOf(listScreen(["  ◆ two-at-once  stage select  needs input · 42s"]))).toEqual(GENERAL);
    expect(askOf(Atomic0990.GENERAL_SCREEN)).toEqual({ ...GENERAL, crowded: true });
  });

  test("nothing waiting, rows above the footer, or no footer: no ask", () => {
    expect(askOf(listScreen(["  ∀ slow-walk  35s"]))).toBeNull();
    expect(askOf([" Done.", "  ◆ lamp-check  Is it dry yet?  needs input · 9s", "", "─".repeat(40), "❯", "─".repeat(40), "esc to interrupt · ? keys"].join("\n"))).toBeNull();
    for (const text of [Atomic0990.IDLE_NAMED_SCREEN, Atomic0990.PICKER_SCREEN, Atomic0990.GRAPH_SCREEN, Atomic0990.STAGE_SCREEN]) expect(askOf(text)).toBeNull();
  });

  test("the prompt box is free on the main chat under its named rule, and not under the picker, the graph or a stage's chat", () => {
    for (const text of [Atomic0990.ONE_QUESTION_SCREEN, Atomic0990.IDLE_NAMED_SCREEN, Atomic0990.WORKING_NAMED_SCREEN, Atomic0990.JUMP_PILL_SCREEN]) expect(promptBoxFree(readScreen(text))).toBe(true);
    for (const text of [Atomic0990.PICKER_SCREEN, Atomic0990.GRAPH_SCREEN, Atomic0990.STAGE_SCREEN]) expect(promptBoxFree(readScreen(text))).toBe(false);
  });

  test("a blocked Agent gets the card, which presses F2", () => {
    const ask = blockedWorkflowAsk("blocked", readScreen(Atomic0990.ONE_QUESTION_SCREEN));
    expect(ask).toEqual(LAMP);
    const { screen, pressed, draw, card } = cardScreen();
    draw(ask);
    expect(card().shown).toBe(true);
    expect(card().querySelector(".question-card-heading")!.textContent).toBe("A workflow is asking (lamp-check)");
    expect(card().querySelector(".question-card-text")!.textContent).toBe(LAMP.question);
    screen.click(screen.button("Open the question in weather-app"));
    expect(pressed).toEqual([F2]);
  });

  test("with the list focused with ↓, a blocked Agent still gets the card, read from the list in the prompt box's place", () => {
    const HAT = { name: "hat-check", question: "Wear the red hat to the fair, or the blue one? The hat stall closes at four.", crowded: false };
    expect(blockedWorkflowAsk("blocked", readScreen(Atomic0990.LIST_FOCUSED_SCREEN))).toEqual(HAT);
    expect(blockedWorkflowAsk("blocked", readScreen(Atomic0990.LIST_FOCUSED_WORKING_SCREEN))).toEqual({
      name: "kite-check",
      question: "Fly the yellow kite today, or the green one? The wind drops after lunch.",
      crowded: false,
    });
    for (const text of [Atomic0990.LIST_TWO_SCREEN, Atomic0990.LIST_PRESS_AGAIN_SCREEN]) expect(blockedWorkflowAsk("blocked", readScreen(text))).toEqual({ ...GENERAL, crowded: true });
    for (const text of [Atomic0990.KEYS_HELP_SCREEN, Atomic0990.LIST_HELP_WORKING_SCREEN]) expect(blockedWorkflowAsk("blocked", readScreen(text))).toBeNull();
    expect(promptBoxFree(readScreen(Atomic0990.LIST_FOCUSED_SCREEN))).toBe(false);
  });

  test("on the focused list, crowded means not exactly one run waiting, or runs out of view; a run still going and the main row don't count", () => {
    const HAT = { name: "hat-check", question: "Wear the red hat?", crowded: false };
    const hat = "❯ ◆ hat-check  Wear the red hat?  needs input · 2m";
    const focusedList = (rows: string[]) =>
      [" Done.", "", " ∀ Freed for 6s · ↓ 201 tokens", "↑1k • ↓2k • 1.0%/1.0M (auto)", ...rows, RUN_LIST_HINT, "", "anthropic/claude-opus-5-5  medium • ~/projects/attic"].join("\n");
    const askOn = (rows: string[]) => blockedWorkflowAsk("blocked", readScreen(focusedList(rows)));
    expect(askOn([hat])).toEqual(HAT);
    expect(askOn([hat, "  ∀ slow-walk  35s"])).toEqual(HAT);
    expect(askOn(["  ● main", hat])).toEqual(HAT);
    expect(askOn(["  ↑ 2 more", hat])).toEqual({ ...HAT, crowded: true });
    expect(askOn([hat, "  +3 more"])).toEqual({ ...HAT, crowded: true });
    expect(askOn([hat, "  ◆ kite-check  Fly the kite?  needs input · 1m"])).toEqual({ ...GENERAL, crowded: true });
  });

  test("there the list takes F2 too, so the card's F2 becomes the moves from ❯ to the first waiting run, then ⏎", () => {
    expect(openKeys(readScreen(Atomic0990.LIST_FOCUSED_SCREEN))).toEqual(["enter"]);
    expect(openKeys(readScreen(Atomic0990.LIST_FOCUSED_WORKING_SCREEN))).toEqual(["enter"]);
    for (const text of [Atomic0990.LIST_TWO_SCREEN, Atomic0990.LIST_PRESS_AGAIN_SCREEN]) expect(openKeys(readScreen(text))).toEqual(["up", "enter"]);
    const chooser = openChooser(readScreen(Atomic0990.LIST_TWO_SCREEN))!;
    expect(chooser(Atomic0990.LIST_TWO_SCREEN)).toEqual(["up", "enter"]);
    expect(chooser(Atomic0990.ONE_QUESTION_SCREEN)).toBeNull();
    for (const text of [Atomic0990.ONE_QUESTION_SCREEN, Atomic0990.IDLE_NAMED_SCREEN, Atomic0990.KEYS_HELP_SCREEN, Atomic0990.GRAPH_SCREEN]) {
      expect(openKeys(readScreen(text))).toBeNull();
      expect(openChooser(readScreen(text))).toBeUndefined();
    }
    expect(openChooser(null)).toBeUndefined();
  });

  test("the list's '↑ N more' and '+N more' rows are not runs to move past", () => {
    for (const more of ["  ↑ 2 more", "  +3 more"]) {
      const text = Atomic0990.LIST_TWO_SCREEN.replace(RUN_LIST_HINT, `${more}\n${RUN_LIST_HINT}`);
      expect(text).not.toBe(Atomic0990.LIST_TWO_SCREEN);
      expect(openKeys(readScreen(text))).toEqual(["up", "enter"]);
    }
  });

  test("F2 from the key row is sent as it is, even over the focused list", () => {
    for (const key of ["f2", "enter"]) expect(choiceChooser(key, readScreen(Atomic0990.LIST_TWO_SCREEN))).toBeUndefined();
  });

  test("number keys answer the stage's select, whose cursor is now ❯", () => {
    expect(["1", "2", "3", "4"].map((key) => choiceKeys(key, readScreen(Atomic0990.STAGE_SCREEN)))).toEqual([["enter"], ["down", "enter"], ["down", "down", "enter"], null]);
  });
});
