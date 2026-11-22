import { describe, expect, test } from "bun:test";
import { drawComposer } from "../web/composer.js";
import { attachQuestionCard, drawQuestionCard } from "../web/question-card.js";
import { readScreen } from "../web/screen.js";
import { attachSubagentStrip, drawSubagentStrip, stripHtml } from "../web/subagent-strip.js";
import { shownAgent, waitingSubagent } from "../web/subagents.js";
import { cssRules, declarations } from "./support/css";
import { asPageElement, fakePage } from "./support/fake-dom";
import { keyBarScreen } from "./support/key-bar";
import * as A from "./support/atomic-0100";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const waitingOf = (screen: string) => waitingSubagent(readScreen(screen));

function cardScreen() {
  const screen = keyBarScreen();
  const opened: (() => void)[] = [];
  attachQuestionCard(asPageElement(screen.root), () => new Promise<void>((resolve) => opened.push(resolve)));
  const draw = (waiting: ReturnType<typeof waitingOf>, draft = false) => drawQuestionCard(asPageElement(screen.root), waiting, { target: "weather-app", draft });
  const card = () => screen.root.querySelector(".question-card")!;
  return { screen, opened, draw, card };
}

describe("the subagent card (sketch left)", () => {
  test("sits above the keys: the lamp, \"‹name› is asking · ‹task›\", its question, and one Open ‹name›'s question button", () => {
    const { screen, draw, card } = cardScreen();
    expect(card().shown).toBe(false);
    draw(waitingOf(A.WAITING_SCREEN));
    const controls = screen.root.querySelector(".controls")!;
    expect(controls.children[0]).toBe(card());
    expect(card().shown).toBe(true);
    expect(card().querySelector(".lamp")!.getAttribute("data-status")).toBe("blocked");
    expect(card().querySelector(".question-card-heading")!.textContent).toBe("asker is asking · Call ask_user_question exactly once with header Roof,…");
    expect(card().querySelector(".question-card-heading strong")!.textContent).toBe("asker is asking");
    expect(card().querySelector(".question-card-text")!.textContent).toBe("Which roof should the shed get?");
    expect(card().querySelector(".question-card-note")!.shown).toBe(false);
    expect(card().querySelectorAll("button")).toHaveLength(1);
    expect(screen.button("Open asker's question in weather-app").getAttribute("type")).toBe("button");
  });

  test("without the question on screen it says a helper needs an answer; with only the footer's count it names no one", () => {
    const { draw, card, screen } = cardScreen();
    draw({ name: "worker", task: "roof sketches", question: null });
    expect(card().querySelector(".question-card-heading")!.textContent).toBe("worker is asking · roof sketches");
    expect(card().querySelector(".question-card-text")!.textContent).toBe("A helper needs your answer before it can carry on.");
    draw({ name: null, task: null, question: null });
    expect(card().querySelector(".question-card-heading")!.textContent).toBe("A subagent is asking");
    screen.button("Open the question in weather-app");
  });

  test("its button runs the open steps once, busy while they run, and types nothing", async () => {
    const { screen, opened, draw, card } = cardScreen();
    draw(waitingOf(A.WAITING_SCREEN));
    const open = card().querySelector("button")!;
    open.dispatch("click", { detail: 1 });
    open.dispatch("click", { detail: 1 });
    expect(opened).toHaveLength(1);
    expect([open.disabled, open.getAttribute("aria-busy")]).toEqual([true, "true"]);
    draw(waitingOf(A.WAITING_SCREEN));
    expect(open.disabled).toBe(true);
    opened[0]();
    await flush();
    expect([open.disabled, open.getAttribute("aria-busy")]).toEqual([false, "false"]);
    expect(screen.sentTexts).toEqual([]);
    expect(screen.sentKeys).toEqual([]);
  });

  test("while Atomic's prompt holds a draft it says why and its button does nothing", () => {
    const { opened, draw, card } = cardScreen();
    draw(waitingOf(A.WAITING_SCREEN), true);
    expect(card().querySelector(".question-card-note")!.shown).toBe(true);
    expect(card().querySelector(".question-card-note")!.textContent).toContain("draft");
    const open = card().querySelector("button")!;
    expect(open.disabled).toBe(true);
    open.dispatch("click", { detail: 1 });
    expect(opened).toEqual([]);
    draw(waitingOf(A.WAITING_SCREEN));
    expect(open.disabled).toBe(false);
  });

  test("a hostile name, task or question stays text", () => {
    const { draw, card } = cardScreen();
    const hostile = `<img src=x onerror="alert(1)">&amp;`;
    draw({ name: `<b>${hostile}</b>`, task: hostile, question: hostile });
    expect(card().querySelectorAll("img, b")).toEqual([]);
    expect(card().querySelector(".question-card-text")!.textContent).toBe(hostile);
  });

  test("its button is a 48px dark key across the card; the card hides while typing or editing keys, and the number keys while it shows", () => {
    expect(declarations(".act")).toMatchObject({ height: "var(--key)" });
    expect(declarations(".question-card-open")).toMatchObject({ width: "100%" });
    const hiding = cssRules.filter((rule) => rule.declarations.display === "none").flatMap((rule) => rule.selectors);
    for (const selector of [".app.is-composing .question-card", ".app.is-editing-keys .question-card", ".app.is-editing-commands .question-card", ".app.has-subagent-card:not(.has-question) .key-answer"]) expect(hiding).toContain(selector);
    expect(declarations(".app.has-question .key-answer")).toMatchObject({ display: "grid" });
  });
});

describe("the message box never answers a question by accident", () => {
  function composer() {
    const screen = keyBarScreen();
    const draw = (state: Partial<Parameters<typeof drawComposer>[1]>) => drawComposer(asPageElement(screen.root), { target: "weather-app", sending: false, blocked: false, ...state });
    const shown = () => [screen.root.querySelector(".composer")!.shown, screen.root.querySelector(".blocked-note")!.shown];
    return { screen, draw, shown };
  }

  test("a question on screen hides it, whatever herdr says, unless its typing field is open", () => {
    const { draw, shown, screen } = composer();
    draw({ asked: true });
    expect(shown()).toEqual([false, true]);
    draw({ asked: true, answering: true });
    expect(shown()).toEqual([true, false]);
    expect(screen.field("Your answer for weather-app").placeholder).toBe("Your answer");
  });

  test("a waiting subagent's card leaves the main prompt free: the box stays beside it", () => {
    const { draw, shown } = composer();
    draw({ blocked: true, card: true });
    expect(shown()).toEqual([true, false]);
    draw({ blocked: true });
    expect(shown()).toEqual([false, true]);
  });

  test("it is labelled with whoever is on Atomic's screen", () => {
    const { draw, screen } = composer();
    draw({ target: "@worker" });
    expect(screen.field("Message @worker").placeholder).toBe("Message @worker");
    screen.button("Send to @worker");
  });
});

describe("the strip while a subagent is on screen", () => {
  function stripScreen() {
    const { root } = fakePage(stripHtml());
    const backs: (() => void)[] = [];
    attachSubagentStrip(asPageElement(root), () => new Promise<void>((resolve) => backs.push(resolve)));
    const draw = (screen: string) => drawSubagentStrip(asPageElement(root), shownAgent(readScreen(screen)));
    const words = () => root.querySelector(".subagent-strip-words")!.textContent;
    return { root, backs, draw, words, strip: () => root.querySelector(".subagent-strip")! };
  }

  test("names it, says what it does, and offers Back to main", () => {
    const { draw, words, strip, root } = stripScreen();
    draw(A.QUESTION_SCREEN);
    expect(strip().shown).toBe(true);
    expect(words()).toBe("asker is asking · Call ask_user_question exactly once with header Roof,…");
    expect(root.querySelector(".subagent-strip .lamp")!.getAttribute("data-status")).toBe("blocked");
    draw(A.SHOWN_PAUSED_SCREEN);
    expect(words()).toStartWith("worker is paused · Run the bash command");
    draw(A.SHOWN_WORKING_SCREEN);
    expect(words()).toStartWith("worker is working · Your whole task");
    draw(A.NARROW_DONE_SCREEN);
    expect(words()).toStartWith("asker is done · ");
    expect(root.querySelector(".subagent-strip-back")!.textContent).toBe("Back to main");
  });

  test("is hidden while main is on screen", () => {
    const { draw, strip } = stripScreen();
    draw(A.QUESTION_SCREEN);
    draw(A.WAITING_SCREEN);
    expect(strip().shown).toBe(false);
  });

  test("Back to main runs once while it is in flight", async () => {
    const { draw, backs, root } = stripScreen();
    draw(A.SHOWN_WORKING_SCREEN);
    const back = root.querySelector(".subagent-strip-back")!;
    back.dispatch("click", { detail: 1 });
    back.dispatch("click", { detail: 1 });
    expect(backs).toHaveLength(1);
    expect(back.disabled).toBe(true);
    backs[0]();
    await flush();
    expect(back.disabled).toBe(false);
  });
});
