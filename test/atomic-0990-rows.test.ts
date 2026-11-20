import { describe, expect, test } from "bun:test";
import { latestLine } from "../server/latest-line";
import { readerParts } from "../web/reader.js";
import { plainText, readScreen } from "../web/screen.js";
import * as Atomic0990 from "./support/atomic-0990";
import { COLLAPSED_SCREEN, COMPACTED_SCREEN, MODEL_SCREEN, START_SCREEN, SUBAGENT_SCREEN } from "./support/atomic-0990-rows";
import { ASK_SCREEN } from "./support/atomic-0990-question";

const bandOf = (html: string) => /^<div class="band band-(you|tool)">/.exec(html)?.[1] ?? null;
const text = (html: string) => html.replace(/<button class="copy-key".*?<\/button>/g, "").replace(/<[^>]+>/g, "");
const bands = (screen: string) => readerParts(screen).flatMap((part) => (bandOf(part) ? [`${bandOf(part)}: ${text(part).slice(0, 24)}`] : []));

describe("Atomic 0.9.90's own rows on the Live screen", () => {
  test("the user's messages, shaded 45,45,48, are the Message Band; tool rows, unshaded, are the Tool Band", () => {
    expect(bands(COMPACTED_SCREEN)).toEqual([
      "tool: ● Bash(seq 1 120) · 0.1s",
      "you: Run these two bash comma",
      "tool: ● Bash(ls -la /usr/share",
      "tool: ✗ Bash(cat /nonexistent-",
      "tool: ✗ Read(missing.txt) · no",
      "you: Run bash: for i in 1 2 3",
      "tool: ● Bash(for i in 1 2 3 4 ",
      "tool: ● Bash(sleep 40) · backg",
      "tool: ✗ Wait(task-1-0-4) · fai",
      "tool: ⚛ Context cleared · 46.5",
    ]);
  });

  test("tool output keeps its rows and its columns, never joined into a paragraph", () => {
    const parts = readerParts(COMPACTED_SCREEN);
    const loop = parts.find((part) => part.includes("row 2 alpha"))!;
    const rows = [...loop.matchAll(/<div class="line"[^>]*>(.*?)<\/div>/g)].map(([, inner]) => text(inner));
    expect(rows.slice(2)).toEqual([2, 3, 4, 5, 6].map((n) => `row ${n} alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma`));
    expect(parts.join("")).toContain(">-rw-r--r--  20 root root    114 Oct  5 01:00 GMT+0</div>");
    expect(parts.some((part) => part.startsWith(`<p class="p">`) && part.includes("row 3 alpha"))).toBe(false);
  });

  test("a message Atomic 0.9.90 wrapped to the pane is joined again where it wrapped; an older Atomic's rows stay apart", () => {
    const you = readerParts(SUBAGENT_SCREEN).find((part) => part.startsWith(`<div class="band band-you">`))!;
    expect(you).toBe(
      `<div class="band band-you"><p class="p">First use the read tool on notes.md. Then launch exactly one subagent (the subagent tool, any general-purpose agent, haiku model if you can choose) with the task: run the bash command &#39;sleep 25; echo shed-ok&#39; and report its output. Wait for it, then reply only: done.</p></div>`,
    );
    const older = ["\u001b[48;2;30;46;30m Please run the whole test suite and then tell me which of the checks are failing now\u001b[0m", "\u001b[48;2;30;46;30m and why.\u001b[0m", "", "─".repeat(40), "❯", "─".repeat(40), "(anthropic) claude-opus-5-5 medium • ~/projects/shed"].join("\n");
    expect(readerParts(older)[0]).toBe(`<div class="band band-you"><p class="p">Please run the whole test suite and then tell me which of the checks are failing now</p><p class="p">and why.</p></div>`);
  });

  test("the question box's screen counts as Atomic 0.9.90's: the user's message over it is the Message Band", () => {
    expect(bands(ASK_SCREEN)).toEqual(["you: Call the ask_user_questi"]);
  });

  test("an older Atomic's 45,45,48 rows stay the Tool Band", () => {
    const older = ["\u001b[48;2;45;45;48m npm test\u001b[0m", " done.", "", "─".repeat(40), "❯", "─".repeat(40), "(anthropic) claude-opus-5-5 medium • ~/projects/shed"].join("\n");
    expect(readScreen(older).atomic0990).toBe(false);
    expect(bands(older)).toEqual(["tool: npm test"]);
  });

  test("a screen is Atomic 0.9.90's by its named rule, its keys footer, its /workflows edge or its question box", () => {
    for (const screen of [Atomic0990.IDLE_NAMED_SCREEN, Atomic0990.SPINNER_SCREEN, Atomic0990.PICKER_SCREEN, ASK_SCREEN, START_SCREEN]) expect(readScreen(screen).atomic0990).toBe(true);
  });
});

describe("Atomic 0.9.90's Latest line", () => {
  const cases: [string, string, string | null][] = [
    ["a fresh start: the logo, the lists, the warning and the update notice are Atomic's", START_SCREEN, null],
    ["the Model: notice after /model", MODEL_SCREEN, null],
    ["the ⚛ Context cleared notice after /compact", COMPACTED_SCREEN, "◼ Interrupted · bash"],
    ["a running tool's ticking time", SUBAGENT_SCREEN, "∀ Agent(wait · task-1-0-5)"],
    ["the lowercase (ctrl+o to expand)", COLLAPSED_SCREEN, "● Read 1 file, searched 1 pattern"],
  ];
  for (const [name, screen, line] of cases) {
    test(`skips ${name}, read plain or coloured`, () => {
      expect(latestLine(screen)).toBe(line);
      expect(latestLine(plainText(screen))).toBe(line);
    });
  }

  test("a tool row is never joined to the rows around it", () => {
    const working = COMPACTED_SCREEN.split("\n");
    const cut = working.findIndex((row) => row.includes("⚛"));
    const atLoop = [...working.slice(0, working.findIndex((row) => row.includes("Bash") && row.includes("sleep 40"))), ...working.slice(cut + 1)].join("\n");
    expect(latestLine(atLoop)).toBe("row 6 alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma");
  });
});
