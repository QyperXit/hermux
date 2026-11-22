import { describe, expect, test } from "bun:test";
import { latestLine, readLatest } from "../server/latest-line";
import { answerKeys, takesTypedAnswer } from "../web/agent-question.js";
import { readerParts } from "../web/reader.js";
import { plainText, readScreen } from "../web/screen.js";
import { agentPanel, shownAgent, stepTowards, waitingSubagent } from "../web/subagents.js";
import * as A from "./support/atomic-0100";
import * as Atomic0990 from "./support/atomic-0990";

const SCREENS = Object.entries(A) as [string, string][];
const plain = (html: string) => html.replace(/<[^>]+>/g, "");
const panelOf = (screen: string) => agentPanel(readScreen(screen))?.rows.map((row) => `${row.cursor ? "∀ " : ""}${row.nested ? "  " : ""}${row.mark} ${row.name}${row.state ? ` · ${row.state}` : ""}`);

describe("a subagent's question on Atomic 0.10", () => {
  const asked: [string, string, string, string[]][] = [
    ["222 columns", A.QUESTION_SCREEN, "Roof", ["Flat", "Pitched", "Type something.", "Chat about this"]],
    ["87 columns, a rule of seven dashes", A.NARROW_QUESTION_SCREEN, "Shelf", ["One", "Two", "Three", "Type something.", "Chat about this"]],
    ["62 columns, the rule's state cut off", A.NARROWER_QUESTION_SCREEN, "Hook", ["Yes", "No", "Type something.", "Chat about this"]],
  ];
  for (const [name, screen, title, labels] of asked) {
    test(`${name}: the box over the prompt box, footer and panel is read as the agent's question, answered by ↑/↓ and ⏎`, () => {
      const { question } = readScreen(screen);
      expect(question?.title).toBe(title);
      expect(question?.options.map((option) => option.label)).toEqual(labels);
      expect(question?.options[0].selected).toBe(true);
      expect(answerKeys(question, 2)).toEqual(["down", "enter"]);
      expect(takesTypedAnswer(question)).toBe(false);
      expect(readerParts(screen).filter((part) => part.startsWith(`<section class="ask"`))).toHaveLength(1);
    });
  }

  test("its Latest line is the question, not the ticking heading or the key hint", () => {
    expect(latestLine(A.QUESTION_SCREEN)).toBe("Roof: Which roof should the shed get?");
    expect(latestLine(A.TYPE_FOCUSED_SCREEN)).toBe("Door: Which way should the shed door open?");
  });

  test("its typing field, open on \"Type something.\", takes a typed answer as on main", () => {
    for (const screen of [A.TYPE_FOCUSED_SCREEN, A.TYPE_TYPED_SCREEN]) expect(takesTypedAnswer(readScreen(screen).question)).toBe(true);
  });

  test("the main agent's own question while subagents run still reads as before", () => {
    expect(readScreen(A.MAIN_QUESTION_SCREEN).question?.title).toBe("Roof");
  });
});

describe("Atomic 0.10's agent panel", () => {
  test("under the footer: main, then each subagent with its state, a waiting one marked ◆", () => {
    expect(panelOf(A.WAITING_SCREEN)).toEqual(["● main", "◆ asker · needs input · 12s"]);
    expect(panelOf(A.NARROW_WAITING_SCREEN)).toEqual(["● main", "◆ asker · needs input · 5s", "◯ worker · 1m", "  ⧗ shell · 1m"]);
  });

  test("focused in the prompt box's place: the ∀ cursor and the indented shell rows; it is Atomic's chrome, never the Latest line", () => {
    expect(panelOf(A.FOCUSED_FOUR_SCREEN)).toEqual([
      "● main",
      "∀ ◆ asker · needs input · 10s",
      "◯ worker · 14s · ↓ 52.3k tokens",
      "  ⧗ shell · 10s",
      "◯ worker · 14s · ↓ 52.4k tokens",
    ]);
    for (const screen of [A.FOCUSED_SCREEN, A.FOCUSED_FOUR_SCREEN, A.SHOWN_FOCUSED_SCREEN]) {
      const read = readScreen(screen);
      expect(read.rows[read.chromeStart].text).toMatch(/^ ∀ \S+ for \d+s/);
      expect(read.rows.filter((row) => /^(?:∀ | {2})[◆◯●]/.test(row.text)).every((row) => row.chrome)).toBe(true);
    }
    expect(latestLine(A.SHOWN_FOCUSED_SCREEN)).toStartWith('Answer: "hinged at the top"');
  });

  test("an older Atomic's list of runs is no agent panel and nothing waits", () => {
    for (const screen of [Atomic0990.ONE_QUESTION_SCREEN, Atomic0990.LIST_FOCUSED_SCREEN, Atomic0990.GENERAL_SCREEN]) {
      expect(agentPanel(readScreen(screen))).toBeNull();
      expect(waitingSubagent(readScreen(screen))).toBeNull();
    }
  });
});

describe("the agent on screen", () => {
  test("is named by the prompt box's top rule, its state from its panel row or the rule", () => {
    expect(shownAgent(readScreen(A.QUESTION_SCREEN))).toEqual({ name: "asker", task: "Call ask_user_question exactly once with header Roof,…", state: "needs input · 34s" });
    expect(shownAgent(readScreen(A.SHOWN_PAUSED_SCREEN))).toMatchObject({ name: "worker", state: "paused" });
    expect(shownAgent(readScreen(A.SHOWN_WORKING_SCREEN))).toMatchObject({ name: "worker", state: "17s · ↓ 16.6k tokens" });
    expect(shownAgent(readScreen(A.NARROW_DONE_SCREEN))).toMatchObject({ name: "asker", state: "done · 23s" });
  });

  test("is main when the rule names no agent", () => {
    for (const screen of [A.WAITING_SCREEN, A.MAIN_AGAIN_SCREEN, A.FOCUSED_SCREEN, A.RETRY_SCREEN]) expect(shownAgent(readScreen(screen))).toBeNull();
  });

  test("a narrow or cut rule still tops Atomic's chrome, so its rows are dimmed", () => {
    for (const screen of [A.NARROW_DONE_SCREEN, A.NARROWER_QUESTION_SCREEN, A.SHOWN_WORKING_SCREEN, A.SHOWN_PAUSED_SCREEN]) {
      const { rows } = readScreen(screen);
      const prompt = rows.findIndex((row) => /^❯ /.test(row.text));
      expect(rows[prompt].chrome).toBe(true);
      expect(rows[prompt - 1].kind).toBe("rule");
    }
  });
});

describe("a waiting subagent", () => {
  test("is read from the panel, /tasks or the footer, with its question when the main chat shows it", () => {
    expect(waitingSubagent(readScreen(A.WAITING_SCREEN))).toEqual({ name: "asker", task: "Call ask_user_question exactly once with header Roof,…", question: "Which roof should the shed get?" });
    expect(waitingSubagent(readScreen(A.TASKS_SCREEN))?.name).toBe("asker");
    expect(waitingSubagent(readScreen(A.QUESTION_SCREEN))?.name).toBe("asker");
    expect(waitingSubagent(readScreen(plainText(A.WAITING_SCREEN).replace(/\n[^\n]*◆ asker[^\n]*$/, "")))).toEqual({ name: null, task: null, question: null });
  });

  test("/tasks counts only where Atomic draws it, on its ▔ edge in the prompt box's place: a list quoted in the chat is the agent's words", () => {
    const quoted = plainText(A.TASKS_SCREEN).split("\n");
    const edge = quoted.findIndex((row) => row.startsWith("▔"));
    const hint = quoted.findIndex((row) => row.includes("esc/← close"));
    const list = quoted.slice(edge + 1, hint + 1);
    const chat = [...quoted.slice(0, edge - 2), "", ...list, "", ...plainText(A.RETRY_SCREEN).split("\n").slice(-12)].join("\n");
    expect(chat).toContain(" Tasks  1 needs input");
    expect(waitingSubagent(readScreen(chat))).toBeNull();
    expect(latestLine(chat)).not.toContain("needs you");
    expect(waitingSubagent(readScreen(plainText(A.TASKS_SCREEN)))?.name).toBe("asker");
  });

  test("none waits while subagents only run, pause or are done", () => {
    for (const screen of [A.RETRY_SCREEN, A.SHOWN_WORKING_SCREEN, A.SHOWN_PAUSED_SCREEN, A.PAUSED_ONLY_SCREEN, A.NARROW_DONE_SCREEN, A.MAIN_AGAIN_SCREEN]) expect(waitingSubagent(readScreen(screen))).toBeNull();
  });

  test("its agent's Latest line names it and its question", () => {
    expect(readLatest(A.WAITING_SCREEN)).toEqual({ line: "asker needs you: Which roof should the shed get?", waiting: true });
    expect(latestLine(A.NARROW_WAITING_SCREEN)).toBe("asker needs you: Hooks on the door?");
    expect(readLatest(A.RETRY_SCREEN)).toEqual({ line: "launched", waiting: false });
  });
});

describe("Atomic 0.10's other rows", () => {
  test("/tasks is kept as drawn, out of the chrome, and the Latest line stays the agent's words", () => {
    const { rows } = readScreen(A.TASKS_SCREEN);
    const title = rows.find((row) => row.text.startsWith(" Tasks  "));
    expect(title).toMatchObject({ chrome: false, kind: "box" });
    expect(readerParts(A.TASKS_SCREEN).some((part) => part.startsWith(`<div class="block">`) && plain(part).includes("Needs input"))).toBe(true);
  });

  test("the retry countdown is the turn line, never the Latest line", () => {
    const { rows, chromeStart } = readScreen(A.RETRY_SCREEN);
    expect(rows[chromeStart].text).toStartWith(" ∀ Retrying · response timed out · attempt 2/3 in 4s");
    expect(latestLine(A.RETRY_SCREEN)).toBe("launched");
  });

  test("the (ctrl+o …) hint and a queued steering message are never the Latest line", () => {
    expect(latestLine(A.FINISHED_HINT_SCREEN)).toStartWith("⎿  The command finished with output walked");
    expect(latestLine(A.STEERING_SCREEN)).toStartWith("I'm reading the request: write a 2,500-word story");
  });

  test("the trust prompt a resumed session draws without a footer is read as a question", () => {
    const { question } = readScreen(A.TRUST_RESUMED_SCREEN);
    expect(question?.form).toBe("trust");
    expect(question?.options.map((option) => option.label)).toEqual(["Trust", "Trust parent folder (~/projects)", "Trust (this session only)", "Do not trust", "Do not trust (this session only)"]);
    expect(question?.options.at(-1)?.selected).toBe(true);
    expect(latestLine(A.TRUST_RESUMED_SCREEN)).toBe("Trust project folder?");
  });
});

describe("bringing an agent to the screen", () => {
  const step = (screen: string, target: "main" | "waiting", progress?: Parameters<typeof stepTowards>[2]) => stepTowards(readScreen(screen), target, progress);
  const plainFocused = plainText(A.FOCUSED_SCREEN);

  test("opening the waiting subagent: ↓ from the empty prompt, then ⏎ alone on its row, then it is there", () => {
    expect(step(A.WAITING_SCREEN, "waiting")).toEqual({ keys: ["down"], then: { sent: "down" } });
    expect(step(A.FOCUSED_SCREEN, "waiting", { sent: "down" })).toEqual({ keys: ["enter"], then: { sent: "enter" } });
    expect(step(A.QUESTION_SCREEN, "waiting", { sent: "enter" })).toEqual({ done: true });
  });

  test("back to main: ↓ from the subagent's empty prompt, ↑ to the main row, then ⏎ alone", () => {
    expect(step(A.SHOWN_WORKING_SCREEN, "main")).toEqual({ keys: ["down"], then: { sent: "down" } });
    expect(step(A.SHOWN_PAUSED_SCREEN, "main")).toEqual({ keys: ["down"], then: { sent: "down" } });
    expect(step(A.SHOWN_FOCUSED_SCREEN, "main", { sent: "down" })).toEqual({ keys: ["up"], then: { sent: "moves", from: 1 } });
    expect(step(plainFocused.replace("  ● main", "∀ ● main").replace("∀ ◆ asker", "  ◆ asker"), "main", { sent: "moves", from: 1 })).toEqual({ keys: ["enter"], then: { sent: "enter" } });
    expect(step(A.MAIN_AGAIN_SCREEN, "main", { sent: "enter" })).toEqual({ done: true });
  });

  test("each step waits for the screen to show the last one took, so no key goes twice", () => {
    expect(step(A.WAITING_SCREEN, "waiting", { sent: "down" })).toEqual({ wait: true });
    expect(step(A.FOCUSED_SCREEN, "waiting", { sent: "enter" })).toEqual({ wait: true });
    expect(step(A.WAITING_SCREEN, "waiting", { sent: "enter" })).toEqual({ wait: true });
    expect(step(A.SHOWN_FOCUSED_SCREEN, "main", { sent: "moves", from: 1 })).toEqual({ wait: true });
    expect(step(A.SHOWN_WORKING_SCREEN, "main", { sent: "moves", from: 1 })).toEqual({ refused: expect.stringContaining("changed") });
  });

  test("nothing while a draft is in Atomic's prompt or a question takes the arrows", () => {
    expect(step(A.SHOWN_DRAFT_SCREEN, "main")).toEqual({ refused: expect.stringContaining("draft") });
    expect(step(A.QUESTION_SCREEN, "main")).toEqual({ refused: expect.stringContaining("question") });
    expect(step(A.MAIN_QUESTION_SCREEN, "waiting")).toEqual({ refused: expect.stringContaining("question") });
    expect(step(A.TASKS_SCREEN, "waiting")).toEqual({ refused: expect.stringContaining("isn't on screen") });
  });

  test("no step sends ⏎ with another key, or Esc", () => {
    const progresses = [undefined, { sent: "down" as const }, { sent: "moves" as const, from: 0 }];
    for (const [, screen] of SCREENS) {
      for (const target of ["main", "waiting"] as const) {
        for (const progress of progresses) {
          const next = stepTowards(readScreen(screen), target, progress);
          if (!("keys" in next)) continue;
          expect(next.keys).not.toContain("esc");
          if (next.keys.includes("enter")) expect(next.keys).toEqual(["enter"]);
          if (next.keys.includes("down") && next.keys.length > 1) expect(next.keys.every((key) => key === "down")).toBe(true);
        }
      }
    }
  });
});
