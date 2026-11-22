import { describe, expect, test } from "bun:test";
import { readLook } from "../server/latest-line";
import { readScreen } from "../web/screen.js";
import { mayHidePaused, pausedHelpers, pausedLine, showHelpersStep, stepToTask, taskRows } from "../web/subagents.js";
import * as A from "./support/atomic-0100";
import * as Atomic0990 from "./support/atomic-0990";
import { FOOTER } from "./support/screens";

const pausedOf = (screen: string) => pausedHelpers(readScreen(screen));

describe("a paused helper on Atomic 0.10", () => {
  test("main idle with no agent panel and the footer's \"/tasks to see subagents\" proves nothing: a finished helper's own shell looks the same", () => {
    for (const screen of [A.PAUSED_MAIN_SCREEN, A.DONE_HELPER_SHELL_SCREEN, A.FORK_DONE_HELPER_SHELL_SCREEN, A.PAUSED_ONLY_SCREEN]) {
      expect(pausedOf(screen)).toBeNull();
      expect(mayHidePaused(readScreen(screen))).toBe(true);
    }
    for (const screen of [A.PAUSED_PANEL_SCREEN, A.TASKS_PAUSED_SCREEN, A.WAITING_SCREEN, A.PAUSED_SHOWN_SCREEN, A.SHOWN_WORKING_SCREEN, A.QUESTION_SCREEN]) expect(mayHidePaused(readScreen(screen))).toBe(false);
    const working = A.PAUSED_MAIN_SCREEN.replace("Mumbled for 2s · ↓ 245 tokens", "Mumbling… (2s · ↓ 245 tokens)");
    expect(mayHidePaused(readScreen(working))).toBe(false);
    expect(pausedLine({ names: [] })).toBe("A helper is paused · send to continue");
  });

  test("the panel with only paused and finished rows names the paused helper", () => {
    expect(pausedOf(A.PAUSED_PANEL_SCREEN)).toEqual({ names: ["asker"] });
    expect(pausedLine({ names: ["asker"] })).toBe("asker is paused · send to continue");
    expect(pausedLine({ names: ["asker", "worker"] })).toBe("2 helpers are paused · send to continue");
  });

  test("/tasks with only paused helpers working names them, wherever its cursor is", () => {
    expect(pausedOf(A.TASKS_PAUSED_SCREEN)).toEqual({ names: ["asker"] });
    expect(pausedOf(A.TASKS_PAUSED_DOWN_SCREEN)).toEqual({ names: ["asker"] });
    expect(pausedOf(A.TASKS_PAUSED_WIDE_SCREEN)).toEqual({ names: ["worker"] });
  });

  test("never while a helper runs, waits on a call or a question, a shell runs, or a question is on screen", () => {
    for (const screen of [A.WAITING_SCREEN, A.FOCUSED_SCREEN, A.FOCUSED_FOUR_SCREEN, A.QUESTION_SCREEN, A.TASKS_SCREEN, A.MAIN_QUESTION_SCREEN, A.NARROW_WAITING_SCREEN, A.STEERING_SCREEN, A.RETRY_SCREEN]) {
      expect(pausedOf(screen)).toBeNull();
    }
  });

  test("never while a helper is on screen: main's own turn can't be seen then", () => {
    for (const screen of [A.PAUSED_SHOWN_SCREEN, A.SHOWN_PAUSED_SCREEN, A.SHOWN_WORKING_SCREEN, A.SHOWN_DRAFT_SCREEN, A.NARROW_DONE_SCREEN]) expect(pausedOf(screen)).toBeNull();
  });

  test("never while main works, or on a screen with no 0.10 footer", () => {
    const working = A.PAUSED_MAIN_SCREEN.replace("Mumbled for 2s · ↓ 245 tokens", "Mumbling… (2s · ↓ 245 tokens)");
    expect(working).not.toBe(A.PAUSED_MAIN_SCREEN);
    expect(pausedOf(working)).toBeNull();
    for (const screen of [Atomic0990.ONE_QUESTION_SCREEN, Atomic0990.LIST_FOCUSED_SCREEN, Atomic0990.GENERAL_SCREEN, `Idle.${FOOTER}`, A.TRUST_RESUMED_SCREEN]) expect(pausedOf(screen)).toBeNull();
  });

  test("a hidden /tasks row (more working than paused rows shown) is doubt", () => {
    const more = A.TASKS_PAUSED_SCREEN.replace("1 working · 1 done", "2 working · 1 done");
    expect(more).not.toBe(A.TASKS_PAUSED_SCREEN);
    expect(pausedOf(more)).toBeNull();
  });

  test("the server's look: paused only when herdr's working meets such a screen, and a waiting helper still wins", () => {
    expect(readLook(A.PAUSED_MAIN_SCREEN)).toEqual({ line: "The worker's completion notice doesn't match what I launched. It refers to a task task-1-0-2 that I never started, and it doesn't contain the expected reply \"slept.\" I haven't resumed or restarted anything. The asker subagent (task-1-0-1) is still running, and I haven't checked its status since you asked me not to wait.", waiting: false, paused: null, unlisted: true });
    expect(readLook(A.PAUSED_PANEL_SCREEN)).toMatchObject({ waiting: false, paused: { names: ["asker"] }, unlisted: false });
    expect(readLook(A.WAITING_SCREEN)).toMatchObject({ waiting: true, paused: null, unlisted: false });
    expect(readLook(A.TASKS_SCREEN)).toMatchObject({ waiting: true, paused: null, unlisted: false });
  });
});

describe("/tasks rows", () => {
  test("each task row with its cursor, mark, name and state; group headings are no rows", () => {
    expect(taskRows(readScreen(A.TASKS_PAUSED_DOWN_SCREEN))?.map(({ cursor, mark, name, state }) => [cursor, mark, name, state])).toEqual([
      [false, "‖", "asker", "paused · 25s"],
      [true, "●", "worker", "done · 53s"],
    ]);
    expect(taskRows(readScreen(A.PAUSED_MAIN_SCREEN))).toBeNull();
  });
});

describe("Show helpers and opening a paused helper", () => {
  test("Show helpers types /tasks only into Atomic's empty main prompt, and is done once /tasks is on screen", () => {
    expect(showHelpersStep(readScreen(A.PAUSED_MAIN_SCREEN))).toEqual({ text: "/tasks" });
    expect(showHelpersStep(readScreen(A.TASKS_PAUSED_SCREEN))).toEqual({ done: true });
    const draft = A.PAUSED_MAIN_SCREEN.replace("❯ \u001b[0m\u001b[7m \u001b[0m", "❯ half a thought\u001b[0m\u001b[7m \u001b[0m");
    expect(draft).not.toBe(A.PAUSED_MAIN_SCREEN);
    expect(showHelpersStep(readScreen(draft))).toEqual({ refused: expect.stringContaining("draft") });
    expect(showHelpersStep(readScreen(A.QUESTION_SCREEN))).toEqual({ refused: expect.stringContaining("question") });
    expect(showHelpersStep(readScreen(A.PAUSED_SHOWN_SCREEN))).toEqual({ refused: expect.stringContaining("Back to main") });
  });

  test("a tap on a paused row: the ↑/↓ presses to it from a fresh read, then ⏎ alone, then it is on screen", () => {
    const asker = { name: "asker", row: 0 };
    expect(stepToTask(readScreen(A.TASKS_PAUSED_SCREEN), asker)).toEqual({ keys: ["enter"], then: { sent: "enter" } });
    expect(stepToTask(readScreen(A.TASKS_PAUSED_DOWN_SCREEN), asker)).toEqual({ keys: ["up"], then: { sent: "moves", from: 1 } });
    expect(stepToTask(readScreen(A.TASKS_PAUSED_DOWN_SCREEN), asker, { sent: "moves", from: 1 })).toEqual({ wait: true });
    expect(stepToTask(readScreen(A.TASKS_PAUSED_SCREEN), asker, { sent: "moves", from: 1 })).toEqual({ keys: ["enter"], then: { sent: "enter" } });
    expect(stepToTask(readScreen(A.TASKS_PAUSED_SCREEN), asker, { sent: "enter" })).toEqual({ wait: true });
    expect(stepToTask(readScreen(A.PAUSED_SHOWN_SCREEN), asker, { sent: "enter" })).toEqual({ done: true });
  });

  test("nothing when the row is no longer that paused helper, or /tasks has gone", () => {
    expect(stepToTask(readScreen(A.TASKS_PAUSED_SCREEN), { name: "worker", row: 0 })).toEqual({ refused: expect.stringContaining("changed") });
    expect(stepToTask(readScreen(A.TASKS_PAUSED_SCREEN), { name: "worker", row: 1 })).toEqual({ refused: expect.stringContaining("changed") });
    expect(stepToTask(readScreen(A.PAUSED_MAIN_SCREEN), { name: "asker", row: 0 })).toEqual({ refused: expect.stringContaining("/tasks") });
    expect(stepToTask(readScreen(A.TASKS_PAUSED_DOWN_SCREEN), { name: "asker", row: 0 }, { sent: "moves", from: 0 })).toEqual({ refused: expect.stringContaining("changed") });
  });
});
