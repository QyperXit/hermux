import { describe, expect, test } from "bun:test";
import { latestLine, readLook } from "../server/latest-line";
import { answerKeys, answerTap, takesTypedAnswer } from "../web/agent-question.js";
import { readerParts } from "../web/reader.js";
import { readScreen } from "../web/screen.js";
import { mayHidePaused, pausedHelpers, stepToTask, taskRows, waitingSubagent } from "../web/subagents.js";
import * as A from "./support/atomic-01010";

const questionOf = (text: string) => readScreen(text).question;
const optionsOf = (text: string) => questionOf(text)?.options.map(({ number, label, selected, role }) => `${selected ? "∀" : " "}${number} ${role} ${label}`);
const keysOf = (text: string, number: number) => answerKeys(questionOf(text), number);
const visible = (html: string) => html.replace(/<span class="visually-hidden">.*?<\/span>/g, "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
const answerRows = (text: string) => {
  const html = readerParts(text).find((part) => part.startsWith(`<section class="ask"`)) ?? "";
  return [...html.matchAll(/<button class="(ask-opt[^"]*)" type="button" data-answer="(\d+)">(.*?)<\/button>/g)].map(([, cls, number, inner]) => `${number} ${cls} ${visible(inner)}`);
};

describe("a question on Atomic 0.10.10, its cursor ∀", () => {
  test("every row is an answer to tap, the cursor's too, with the typing and chat rows in their places", () => {
    expect(optionsOf(A.QUESTION_SCREEN)).toEqual(["∀1 answer Flat", " 2 answer Pitched", " 3 answer Green", " 4 type Type something.", " 5 chat Chat about this"]);
    expect(optionsOf(A.QUESTION_ROW3_SCREEN)).toEqual([" 1 answer Flat", " 2 answer Pitched", "∀3 answer Green", " 4 type Type something.", " 5 chat Chat about this"]);
    expect(answerRows(A.QUESTION_SCREEN)).toEqual([
      "1 ask-opt is-cursor |1|Flat|",
      "2 ask-opt |2|Pitched|",
      "3 ask-opt |3|Green|",
      "4 ask-opt is-quiet |4|Type something.|",
      "5 ask-opt is-quiet |5|Chat about this|",
    ]);
  });

  test("a tap or number key sends the moves from the cursor and ⏎, or only the moves to a typing row; no row is refused as if the notes were open", () => {
    expect(keysOf(A.QUESTION_SCREEN, 1)).toEqual(["enter"]);
    expect(keysOf(A.QUESTION_SCREEN, 3)).toEqual(["down", "down", "enter"]);
    expect(keysOf(A.QUESTION_SCREEN, 4)).toEqual(["down", "down", "down"]);
    expect(keysOf(A.QUESTION_SCREEN, 5)).toEqual(["down", "down", "down", "down"]);
    expect(keysOf(A.QUESTION_ROW3_SCREEN, 1)).toEqual(["up", "up", "enter"]);
    for (const screen of [A.QUESTION_SCREEN, A.QUESTION_ROW3_SCREEN, A.DESCRIBED_QUESTION_SCREEN, A.MULTI_SCREEN, A.QUESTIONNAIRE_SCREEN, A.REVIEW_SCREEN, A.HELPER_QUESTION_SCREEN]) {
      for (const option of questionOf(screen)!.options) {
        const tap = answerTap(questionOf(screen), option.number);
        expect([option.number, tap.send]).toEqual([option.number, true]);
      }
    }
    expect(answerTap(questionOf(A.QUESTION_SCREEN), 2)).toEqual({ send: true, label: "Pitched", typing: false });
    expect(answerTap(questionOf(A.QUESTION_SCREEN), 4)).toEqual({ send: true, label: "Type something.", typing: true });
    expect(answerTap(questionOf(A.QUESTION_SCREEN), 5)).toEqual({ send: true, label: "Chat about this", typing: true });
  });

  test("with descriptions: the question is the question, not the cursor row's description", () => {
    const question = questionOf(A.DESCRIBED_QUESTION_SCREEN)!;
    expect([question.title, question.text[question.prompt]]).toEqual(["Short board", "Should we fix the short boards before the shed is painted?"]);
    expect(optionsOf(A.DESCRIBED_QUESTION_SCREEN)).toEqual(["∀1 answer Fix it, 2 m minimum (Recommended)", " 2 answer Leave it as is", " 3 type Type something.", " 4 chat Chat about this"]);
    expect(question.options[0].description).toStartWith("Count a board only once it is 2 m long");
    expect(keysOf(A.DESCRIBED_QUESTION_SCREEN, 2)).toEqual(["down", "enter"]);
    expect(keysOf(A.DESCRIBED_QUESTION_SCREEN, 4)).toEqual(["down", "down", "down"]);
  });

  test("a multi-select ticks with ⏎ and commits on Submit", () => {
    expect(questionOf(A.MULTI_SCREEN)!.options.map((option) => `${option.selected ? "∀" : " "}${option.role}${option.ticked === null ? "" : option.ticked ? " [✔]" : " [ ]"} ${option.label}`)).toEqual([
      "∀answer [ ] Shelves",
      " answer [ ] Workbench",
      " answer [ ] Skylight",
      " commit Submit",
      " chat Chat about this",
    ]);
    expect(keysOf(A.MULTI_SCREEN, 2)).toEqual(["down", "enter"]);
    expect(questionOf(A.MULTI_SUBMIT_SCREEN)!.options.map((option) => option.ticked)).toEqual([true, false, true, null, null]);
    expect(keysOf(A.MULTI_SUBMIT_SCREEN, 4)).toEqual(["enter"]);
    expect(keysOf(A.MULTI_SUBMIT_SCREEN, 1)).toEqual(["up", "up", "up", "enter"]);
  });

  test("a questionnaire's step and its Review", () => {
    expect(questionOf(A.QUESTIONNAIRE_SCREEN)).toMatchObject({ title: "Size", step: { at: 1, of: 3 }, review: false });
    expect(keysOf(A.QUESTIONNAIRE_SCREEN, 2)).toEqual(["down", "enter"]);
    expect(questionOf(A.REVIEW_SCREEN)).toMatchObject({ title: "Review", review: true });
    expect(optionsOf(A.REVIEW_SCREEN)).toEqual(["∀1 answer Submit answers", " 2 answer Cancel"]);
    expect(keysOf(A.REVIEW_SCREEN, 2)).toEqual(["down", "enter"]);
  });

  test("a helper's question, over its prompt box and the agent panel", () => {
    expect(optionsOf(A.HELPER_QUESTION_SCREEN)).toEqual(["∀1 answer Gravel", " 2 answer Paving", " 3 type Type something.", " 4 chat Chat about this"]);
    expect(keysOf(A.HELPER_QUESTION_SCREEN, 2)).toEqual(["down", "enter"]);
  });

  test("the Latest line, and so the notification, is the question, never the cursor's row or its description", () => {
    expect(latestLine(A.QUESTION_SCREEN)).toBe("Roof: Which roof should the shed get?");
    expect(latestLine(A.DESCRIBED_QUESTION_SCREEN)).toBe("Short board: Should we fix the short boards before the shed is painted?");
    expect(latestLine(A.MULTI_SCREEN)).toBe("Extras: Which extras should the shed have?");
    expect(latestLine(A.QUESTIONNAIRE_SCREEN)).toBe("Size: How big should the shed be?");
    expect(latestLine(A.REVIEW_SCREEN)).toBe("Review: Ready to submit your answers?");
    expect(latestLine(A.HELPER_QUESTION_SCREEN)).toBe("Path: Gravel or paving for the path?");
  });
});

describe("\"Type something.\" and \"Chat about this\" on Atomic 0.10.10", () => {
  test("↓ to either row opens its field, empty or typed into: the typed answer is taken", () => {
    for (const screen of [A.TYPE_OPEN_SCREEN, A.TYPE_PASTED_SCREEN, A.CHAT_OPEN_SCREEN, A.CHAT_PASTED_SCREEN, A.HELPER_CHAT_OPEN_SCREEN]) expect(takesTypedAnswer(questionOf(screen))).toBe(true);
    expect(optionsOf(A.TYPE_OPEN_SCREEN)![3]).toBe("∀4 type ");
    expect(optionsOf(A.TYPE_PASTED_SCREEN)![3]).toBe("∀4 type Thatched roof");
    expect(optionsOf(A.CHAT_OPEN_SCREEN)![4]).toBe("∀5 chat ");
    expect(optionsOf(A.CHAT_PASTED_SCREEN)![3]).toBe("∀4 chat Would green hide moss better?");
    expect(answerRows(A.TYPE_OPEN_SCREEN)[3]).toBe("4 ask-opt is-quiet is-cursor |4|Type something.|");
    expect(answerTap(questionOf(A.TYPE_PASTED_SCREEN), 4)).toEqual({ send: false, message: "Type your answer in the box below.", error: false });
  });

  test("nowhere else: an answer row under the cursor, Submit, Review, the trust prompt", () => {
    for (const screen of [A.QUESTION_SCREEN, A.QUESTION_ROW3_SCREEN, A.DESCRIBED_QUESTION_SCREEN, A.MULTI_SCREEN, A.MULTI_SUBMIT_SCREEN, A.QUESTIONNAIRE_SCREEN, A.REVIEW_SCREEN, A.HELPER_QUESTION_SCREEN, A.TRUST_SCREEN]) {
      expect(takesTypedAnswer(questionOf(screen))).toBe(false);
    }
  });

  test("\"Chat about this\" sent empty ends the turn: no question left, an ordinary prompt", () => {
    expect(questionOf(A.CHAT_SENT_EMPTY_SCREEN)).toBeNull();
    expect(latestLine(A.CHAT_SENT_EMPTY_SCREEN)).toBe("● Door → \"User wants to chat about this\"");
  });
});

describe("the trust prompt on Atomic 0.10.10", () => {
  test("reads its five choices with the ∀ cursor, answered by ↑/↓ and ⏎", () => {
    expect(optionsOf(A.TRUST_SCREEN)).toEqual([" 1 answer Trust", " 2 answer Trust parent folder (~/projects)", " 3 answer Trust (this session only)", " 4 answer Do not trust", "∀5 answer Do not trust (this session only)"]);
    expect(keysOf(A.TRUST_SCREEN, 3)).toEqual(["up", "up", "enter"]);
    expect(questionOf(A.TRUST_UP_SCREEN)!.options.findIndex((option) => option.selected)).toBe(1);
    expect(keysOf(A.TRUST_UP_SCREEN, 3)).toEqual(["down", "enter"]);
    expect(latestLine(A.TRUST_SCREEN)).toBe("Trust project folder?");
    expect(answerRows(A.TRUST_SCREEN)).toHaveLength(5);
  });
});

describe("helpers on Atomic 0.10.10", () => {
  test("/tasks with its cursor on a paused helper reads paused, and that row is a key", () => {
    const screen = readScreen(A.TASKS_PAUSED_SCREEN);
    expect(taskRows(screen)!.map((row) => `${row.cursor ? "∀" : " "} ${row.mark} ${row.name} · ${row.state}`)).toEqual(["∀ ‖ scribe · paused · 31s", "  ● asker · done · 1m", "  ● asker · done · 33s"]);
    expect(pausedHelpers(screen)).toEqual({ names: ["scribe"] });
    expect(readLook(A.TASKS_PAUSED_SCREEN).paused).toEqual({ names: ["scribe"] });
    expect(stepToTask(screen, { name: "scribe", row: 0 })).toEqual({ keys: ["enter"], then: { sent: "enter" } });
    const parts = readerParts(A.TASKS_PAUSED_SCREEN).join("");
    expect(parts).toContain('<button class="task-open is-cursor" type="button" data-task="0" data-task-name="scribe">');
  });

  test("/tasks with its cursor on a waiting helper keeps it Needs you", () => {
    expect(waitingSubagent(readScreen(A.TASKS_WAITING_SCREEN))?.name).toBe("asker");
    expect(readLook(A.TASKS_WAITING_SCREEN)).toMatchObject({ waiting: true, line: "asker needs you" });
  });

  test("a waiting helper's ◆ launch card gives its question", () => {
    expect(waitingSubagent(readScreen(A.HELPER_CARD_SCREEN))).toEqual({ name: "asker", task: "Call ask_user_question exactly once with header Gate,…", question: "Which colour should the gate be?" });
    expect(latestLine(A.HELPER_CARD_SCREEN)).toBe("asker needs you: Which colour should the gate be?");
  });

  test("main at rest with no panel may hide a paused helper, for the saved session to confirm", () => {
    expect(pausedHelpers(readScreen(A.PAUSED_MAIN_SCREEN))).toBeNull();
    expect(mayHidePaused(readScreen(A.PAUSED_MAIN_SCREEN))).toBe(true);
  });
});

describe("Atomic 0.10.10's retry line", () => {
  test("\"∀ Retrying summary · …\" is Atomic's, never the Latest line", () => {
    expect(latestLine(A.RETRY_SUMMARY_SCREEN)).toBe("● Paint → \"Would green hide moss better?\"");
    const { rows, chromeStart } = readScreen(A.RETRY_SUMMARY_SCREEN);
    expect(rows[chromeStart].text.trim()).toStartWith("∀ Retrying summary · ");
  });
});
