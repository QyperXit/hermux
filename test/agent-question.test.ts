import { describe, expect, test } from "bun:test";
import { answerKeys, answerTap, keysIfStillAsked, takesTypedAnswer } from "../web/agent-question.js";
import { readerParts } from "../web/reader.js";
import { readScreen } from "../web/screen.js";
import { declarations } from "./support/css";
import * as Atomic0990 from "./support/atomic-0990";
import * as Q from "./support/atomic-0990-question";
import { WORKFLOW_PICKER_SCREEN } from "./support/workflow-picker";
import { GRAPH_SCREEN, STAGE_QUESTION_SCREEN } from "./support/workflow-question";

const questionOf = (text: string) => readScreen(text).question;
const optionsOf = (text: string) =>
  questionOf(text)?.options.map(({ number, label, selected, role, ticked }) => `${selected ? "❯" : " "}${number} ${role}${ticked === null ? "" : ticked ? " [✔]" : " [ ]"} ${label}`);
const keysOf = (text: string, number: number) => answerKeys(questionOf(text), number);
// ASK_SCREEN with an inverse cell after the cursor's "Red", as a caret would draw.
const CARET_ON_RED_SCREEN = Q.ASK_SCREEN.replace("❯ 1. Red\u001b[0m ", "❯ 1. Red\u001b[0m\u001b[7m \u001b[0m");

describe("Atomic 0.9.90's question box", () => {
  test("reads its header, its question, and each numbered row with the cursor's", () => {
    const question = questionOf(Q.ASK_SCREEN)!;
    expect([question.form, question.title, question.text, question.prompt, question.step, question.review, question.typing]).toEqual(["ask", "Color", ["Red or blue?"], 0, null, false, false]);
    expect(optionsOf(Q.ASK_SCREEN)).toEqual(["❯1 answer Red", " 2 answer Blue", " 3 type Type something.", " 4 chat Chat about this"]);
  });

  test("spans the ∀ Questions row over the box to the key hint under it", () => {
    const { rows, question } = readScreen(Q.ASK_SCREEN);
    expect(rows[question!.heading!].text).toBe(" ∀ Questions · Color · 1s");
    expect(question!.start).toBe(question!.heading!);
    expect(rows[question!.end - 1].text).toBe("  ↑↓ select · enter choose · esc cancel");
    expect(question!.end).toBe(rows.length);
  });

  test("keeps each option's description, and counts every row: five rows, then six", () => {
    expect(questionOf(Q.ASK_FIVE_SCREEN)!.options.map((option) => option.description)).toEqual([
      "A fresh coat of garden green; needs two tins and a dry weekend.",
      "Keep the old brown; one tin, done in an afternoon.",
      "No paint this year.",
      "",
      "",
    ]);
    expect(optionsOf(Q.ASK_SIX_SCREEN)).toEqual([" 1 answer Warm", " 2 answer Neutral", " 3 answer Daylight", " 4 answer Motion", " 5 type Type something.", "❯6 chat "]);
  });

  test("a cursor row with no label, its typing field open and empty, still counts", () => {
    const question = questionOf(Q.ASK_TYPE_FOCUSED_SCREEN)!;
    expect(optionsOf(Q.ASK_TYPE_FOCUSED_SCREEN)).toEqual([" 1 answer Red", " 2 answer Blue", "❯3 type ", " 4 chat Chat about this"]);
    expect(question.typing).toBe(true);
  });

  test("the typing field is open only while the cursor's row shows Atomic's caret", () => {
    expect(questionOf(Q.ASK_TYPED_SCREEN)!.typing).toBe(true);
    expect(optionsOf(Q.ASK_TYPED_SCREEN)![2]).toBe("❯3 type purple, please");
    expect(questionOf(Q.ASK_CHAT_TYPED_SCREEN)!.typing).toBe(true);
    expect(optionsOf(Q.ASK_CHAT_TYPED_SCREEN)!.slice(2)).toEqual([" 3 type purple, please2", "❯4 chat why two?"]);
    for (const screen of [Q.ASK_SCREEN, Q.ASK_DOWN_SCREEN, Q.ASK_FIVE_SCREEN, Q.MULTI_SCREEN, Q.TABS_SCREEN, Q.REVIEW_SCREEN, Q.PREVIEW_SCREEN]) expect(questionOf(screen)!.typing).toBe(false);
  });

  test("a multi-select's ticks and its Submit row", () => {
    expect(optionsOf(Q.MULTI_SCREEN)).toEqual([" 1 answer [✔] Cheese", " 2 answer [ ] Olives", "❯3 answer [✔] Basil", " 4 commit Submit", " 5 chat Chat about this"]);
  });

  test("a questionnaire's step, the step's name as its title, and an answer it already has", () => {
    expect(questionOf(Q.TABS_SCREEN)).toMatchObject({ title: "Size", step: { at: 1, of: 3 }, review: false, text: ["What size shed?"] });
    const revisited = questionOf(Q.TABS_REVISITED_SCREEN)!;
    expect(revisited).toMatchObject({ title: "Roof", step: { at: 2, of: 3 }, text: ["Which roof?"] });
    expect(revisited.options.map((option) => [option.label, option.answered])).toEqual([["Flat", false], ["Pitched", true], ["Type something.", false], ["Chat about this", false]]);
  });

  test("a questionnaire's Review step asks the question over its two choices", () => {
    const review = questionOf(Q.REVIEW_SCREEN)!;
    expect(review).toMatchObject({ title: "Review", step: null, review: true });
    expect(review.text[review.prompt]).toBe("Ready to submit your answers?");
    expect(review.text.slice(0, 3)).toEqual(["Review your answers", "● Size", "→ Small"]);
    expect(optionsOf(Q.REVIEW_SCREEN)).toEqual(["❯1 answer Submit answers", " 2 answer Cancel"]);
    const unanswered = questionOf(Q.REVIEW_UNANSWERED_SCREEN)!;
    expect(unanswered.text[unanswered.prompt]).toBe("⚠ Answer remaining questions before submitting: Size, Roof, Extras");
  });

  test("a preview box to the right of the options is not part of them, and there is no Type something row", () => {
    expect(optionsOf(Q.PREVIEW_SCREEN)).toEqual(["❯1 answer Left door", " 2 answer Right door", " 3 chat Chat about this"]);
    expect(questionOf(Q.PREVIEW_SCREEN)!.options[1].description).toBe("Door on the right wall.");
    expect(questionOf(Q.PREVIEW_SCREEN)!.after).toEqual([]);
  });

  test("an open notes field is a typing field; it hides the cursor", () => {
    const notes = questionOf(Q.NOTES_SCREEN)!;
    expect(notes.typing).toBe(true);
    expect(notes.after).toEqual(["Notes:", "> hinge on the outside"]);
    expect(notes.options.some((option) => option.selected)).toBe(false);
  });

  test("a question and a description Atomic wrapped are each one paragraph", () => {
    const long = questionOf(Q.LONG_SCREEN)!;
    expect(long.text).toEqual([
      "The shed needs a new roof before winter and the budget only covers one of the two materials we looked at last week, so which one should the order go in for on Monday morning, given the delivery times and the fact that the old roof leaks over the workbench whenever the wind comes from the west?",
    ]);
    expect(long.options[0].description).toStartWith("Arrives in three days, lasts thirty years,");
    expect(long.options[0].description).toEndWith("could be put off until spring if the leak is fixed first.");
  });
});

describe("Atomic 0.9.90's trust prompt", () => {
  test("is a question whose choices have no numbers; they are counted from the top", () => {
    const trust = questionOf(Q.TRUST_SCREEN)!;
    expect(trust).toMatchObject({ form: "trust", title: "", prompt: 0, typing: false });
    expect(trust.text).toEqual(["Trust project folder?", "~/projects/yard", "This allows atomic to load .atomic settings and resources, install missing project packages, and execute project extensions."]);
    expect(optionsOf(Q.TRUST_SCREEN)).toEqual([" 1 answer Trust", " 2 answer Trust parent folder (~/projects)", " 3 answer Trust (this session only)", " 4 answer Do not trust", "❯5 answer Do not trust (this session only)"]);
  });
});

describe("no question is read", () => {
  test("on screens without Atomic 0.9.90's question box or trust prompt", () => {
    const screens = [GRAPH_SCREEN, STAGE_QUESTION_SCREEN, WORKFLOW_PICKER_SCREEN, ...Object.values(Atomic0990).filter((value) => typeof value === "string")];
    for (const screen of screens) expect(questionOf(screen)).toBeNull();
  });

  test("when the box is not straight over its key hint, or the hint is not the last row", () => {
    const rows = Q.ASK_SCREEN.split("\n");
    expect(questionOf([...rows.slice(0, -2), rows.at(-1)!].join("\n"))).toBeNull();
    expect(questionOf([...rows, " more words"].join("\n"))).toBeNull();
  });
});

describe("the keys that answer a question", () => {
  test("↑/↓ from the cursor's row to the option, then ⏎", () => {
    expect([1, 2].map((number) => keysOf(Q.ASK_DOWN_SCREEN, number))).toEqual([["up", "enter"], ["enter"]]);
    expect(keysOf(Q.ASK_FIVE_SCREEN, 3)).toEqual(["down", "down", "enter"]);
    expect(keysOf(Q.ASK_SIX_SCREEN, 1)).toEqual(["up", "up", "up", "up", "up", "enter"]);
  });

  test("a typing row is moved to, never ⏎'d; on it already there is nothing to press", () => {
    expect(keysOf(Q.ASK_SCREEN, 3)).toEqual(["down", "down"]);
    expect(keysOf(Q.ASK_SCREEN, 4)).toEqual(["down", "down", "down"]);
    expect(keysOf(Q.ASK_TYPED_SCREEN, 3)).toBeNull();
  });

  test("a multi-select option is ticked with ⏎ and Submit commits with ⏎", () => {
    expect(keysOf(Q.MULTI_SCREEN, 2)).toEqual(["up", "enter"]);
    expect(keysOf(Q.MULTI_SCREEN, 4)).toEqual(["down", "enter"]);
  });

  test("a trust choice is counted from the top", () => {
    expect(keysOf(Q.TRUST_SCREEN, 3)).toEqual(["up", "up", "enter"]);
  });

  test("none with no cursor (the notes field is open) or no such option", () => {
    expect(keysOf(Q.NOTES_SCREEN, 1)).toBeNull();
    expect(keysOf(Q.ASK_SCREEN, 5)).toBeNull();
    expect(answerKeys(null, 1)).toBeNull();
  });
});

const visible = (html: string) => html.replace(/<span class="visually-hidden">.*?<\/span>/g, "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
const answerRows = (html: string) => [...html.matchAll(/<button class="(ask-opt[^"]*)" type="button" data-answer="(\d+)">(.*?)<\/button>/g)].map(([, cls, number, inner]) => ({ cls, number, text: visible(inner) }));
const questionPart = (text: string) => readerParts(text).find((part) => part.startsWith(`<section class="ask"`))!;

describe("the question on the Live screen", () => {
  test("its header small, its question large, each option a numbered row to tap, the typing rows quieter", () => {
    const html = questionPart(Q.ASK_FIVE_SCREEN);
    expect(html).toContain(`<p class="ask-title"><span>Fence</span></p><p class="ask-text">Which paint should the fence get?</p>`);
    expect(answerRows(html)).toEqual([
      { cls: "ask-opt is-cursor", number: "1", text: "|1|Green|A fresh coat of garden green; needs two tins and a dry weekend.|" },
      { cls: "ask-opt", number: "2", text: "|2|Brown|Keep the old brown; one tin, done in an afternoon.|" },
      { cls: "ask-opt", number: "3", text: "|3|Leave it|No paint this year.|" },
      { cls: "ask-opt is-quiet", number: "4", text: "|4|Type something.|" },
      { cls: "ask-opt is-quiet", number: "5", text: "|5|Chat about this|" },
    ]);
    expect(html).toContain(`<span class="visually-hidden">, Atomic's cursor</span>`);
  });

  test("replaces Atomic's box and key hint; the ticking ∀ Questions row stays as a dimmed line of its own", () => {
    const parts = readerParts(Q.ASK_SCREEN);
    expect(parts.slice(-2)).toEqual([`<div class="line is-chrome" style="padding-left:1ch">∀ Questions · Color · 1s</div>`, questionPart(Q.ASK_SCREEN)]);
    expect(parts.join("")).not.toMatch(/[╭╰│]|↑↓ select/);
  });

  test("a multi-select shows each tick and its Submit row", () => {
    expect(answerRows(questionPart(Q.MULTI_SCREEN)).map(({ cls, text }) => [cls, text])).toEqual([
      ["ask-opt is-ticked", "|1|Cheese|Extra mozzarella.|"],
      ["ask-opt", "|2|Olives|Black olives.|"],
      ["ask-opt is-cursor is-ticked", "|3|Basil|Fresh leaves.|"],
      ["ask-opt", "|4|Submit|"],
      ["ask-opt is-quiet", "|5|Chat about this|"],
    ]);
    expect(questionPart(Q.MULTI_SCREEN)).toContain(`<span class="ask-tick" aria-hidden="true"></span><span class="visually-hidden">not ticked, </span><span class="ask-label">Olives</span>`);
  });

  test("a questionnaire says which question of how many, marks an answer it has, and shows its Review", () => {
    expect(questionPart(Q.TABS_REVISITED_SCREEN)).toContain(`<p class="ask-title"><span>Roof</span><span class="ask-step">Question 2 of 3</span></p>`);
    expect(questionPart(Q.TABS_REVISITED_SCREEN)).toContain(`<span class="ask-label">Pitched</span><span class="ask-answered" aria-hidden="true">✔</span>`);
    const review = questionPart(Q.REVIEW_SCREEN);
    expect(review).toContain(`<p class="ask-title"><span>Review</span></p><p class="ask-lead">Review your answers</p><p class="ask-lead">● Size</p>`);
    expect(review).toContain(`<p class="ask-text">Ready to submit your answers?</p>`);
  });

  test("long text is one paragraph that wraps on the phone, never a box that scrolls sideways", () => {
    const html = questionPart(Q.LONG_SCREEN);
    expect(html).toContain(`<p class="ask-text">The shed needs a new roof before winter`);
    expect(readerParts(Q.LONG_SCREEN).some((part) => part.includes(`class="block`))).toBe(false);
    expect(declarations(".ask-text")).toMatchObject({ "overflow-wrap": "anywhere" });
    expect(declarations(".ask-body")).toMatchObject({ "overflow-wrap": "anywhere" });
  });

  test("each option is at least 56px tall", () => {
    expect(declarations(":root")["--row"]).toBe("56px");
    expect(declarations(".ask-opt")).toMatchObject({ "min-height": "var(--row)" });
  });

  test("a typing row Atomic draws empty while its field is open keeps its name", () => {
    expect(answerRows(questionPart(Q.ASK_TYPE_FOCUSED_SCREEN))[2]).toEqual({ cls: "ask-opt is-quiet is-cursor", number: "3", text: "|3|Type something.|" });
    expect(answerRows(questionPart(Q.ASK_SIX_SCREEN))[5]).toEqual({ cls: "ask-opt is-quiet is-cursor", number: "6", text: "|6|Chat about this|" });
  });

  test("an open notes field shows what is typed under the options", () => {
    expect(questionPart(Q.NOTES_SCREEN)).toEndWith(`<p class="ask-after">Notes:</p><p class="ask-after">&gt; hinge on the outside</p></section>`);
  });

  test("the trust prompt asks in Atomic's chrome, its choices numbered for the number keys", () => {
    const html = questionPart(Q.TRUST_SCREEN);
    expect(html).toStartWith(`<section class="ask" aria-label="Atomic is asking"><p class="ask-text">Trust project folder?</p>`);
    expect(answerRows(html).map(({ number, text }) => `${number}${text}`)).toEqual(["1|1|Trust|", "2|2|Trust parent folder (~/projects)|", "3|3|Trust (this session only)|", "4|4|Do not trust|", "5|5|Do not trust (this session only)|"]);
    expect(readerParts(Q.TRUST_SCREEN).at(-1)).toBe(`<div class="line is-chrome">anthropic/claude-opus-5-5  medium • ~/projects/yard · ? keys</div>`);
  });
});

describe("a tap or a number key on a question", () => {
  test("sends the option's keys, or only opens a typing row", () => {
    expect(answerTap(questionOf(Q.ASK_SCREEN), 2)).toEqual({ send: true, label: "Blue", typing: false });
    expect(answerTap(questionOf(Q.ASK_SCREEN), 3)).toEqual({ send: true, label: "Type something.", typing: true });
    expect(answerTap(questionOf(Q.ASK_SIX_SCREEN), 5)).toEqual({ send: true, label: "Type something.", typing: true });
    expect(answerTap(questionOf(Q.ASK_SIX_SCREEN), 1)).toEqual({ send: true, label: "Warm", typing: false });
  });

  test("sends nothing, and says why, on the typing row it is on, with the notes open, or past the last option", () => {
    expect(answerTap(questionOf(Q.ASK_TYPED_SCREEN), 3)).toEqual({ send: false, message: "Type your answer in the box below.", error: false });
    expect(answerTap(questionOf(Q.NOTES_SCREEN), 1)).toEqual({ send: false, message: "Close the notes with Enter first.", error: true });
    expect(answerTap(questionOf(Q.ASK_SCREEN), 5)).toEqual({ send: false, message: "There is no answer 5.", error: true });
  });
});

describe("text typed on the phone for a blocked agent", () => {
  test("is taken only while the question's own typing field is open", () => {
    for (const screen of [Q.ASK_TYPE_FOCUSED_SCREEN, Q.ASK_TYPED_SCREEN, Q.ASK_CHAT_TYPED_SCREEN, Q.ASK_SIX_SCREEN, Q.NOTES_SCREEN]) expect(takesTypedAnswer(questionOf(screen))).toBe(true);
    for (const screen of [Q.ASK_SCREEN, Q.ASK_DOWN_SCREEN, Q.MULTI_SUBMIT_SCREEN, Q.TABS_SCREEN, Q.REVIEW_SCREEN, Q.PREVIEW_SCREEN, Q.TRUST_SCREEN, GRAPH_SCREEN, WORKFLOW_PICKER_SCREEN, STAGE_QUESTION_SCREEN]) {
      expect(takesTypedAnswer(questionOf(screen))).toBe(false);
    }
  });

  test("never on a caret left on an answer row: only a typing row's caret counts", () => {
    expect(CARET_ON_RED_SCREEN).not.toBe(Q.ASK_SCREEN);
    expect(takesTypedAnswer(questionOf(CARET_ON_RED_SCREEN))).toBe(false);
  });
});

describe("the keys for a tap, chosen again from the screen read just before sending", () => {
  test("are the answer's keys while the question and the option are the same, the cursor moved or not", () => {
    expect(keysIfStillAsked(questionOf(Q.ASK_SCREEN), questionOf(Q.ASK_SCREEN), 2)).toEqual(["down", "enter"]);
    expect(keysIfStillAsked(questionOf(Q.ASK_SCREEN), questionOf(Q.ASK_DOWN_SCREEN), 1)).toEqual(["up", "enter"]);
  });

  test("are none once a questionnaire has moved on to its next question", () => {
    expect(keysIfStillAsked(questionOf(Q.TABS_SCREEN), questionOf(Q.TABS_REVISITED_SCREEN), 2)).toBeNull();
  });

  test("are none when the tapped option's label changed under the same header", () => {
    const relabelled = Q.ASK_SCREEN.replace("2. Blue", "2. Pink");
    expect(optionsOf(relabelled)![1]).toBe(" 2 answer Pink");
    expect(keysIfStillAsked(questionOf(Q.ASK_SCREEN), questionOf(relabelled), 2)).toBeNull();
    expect(keysIfStillAsked(questionOf(Q.ASK_SCREEN), questionOf(relabelled), 1)).toEqual(["enter"]);
  });

  test("are none when the question has gone", () => {
    expect(keysIfStillAsked(questionOf(Q.ASK_SCREEN), null, 1)).toBeNull();
    expect(keysIfStillAsked(null, questionOf(Q.ASK_SCREEN), 1)).toBeNull();
  });
});
