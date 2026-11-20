import { describe, expect, test } from "bun:test";
import { latestLine } from "../server/latest-line";
import {
  CROWDED_SCREEN,
  GENERAL_SCREEN,
  IDLE_NAMED_SCREEN,
  IDLE_QUOTE_SCREEN,
  INTERRUPTED_SCREEN,
  JUMP_PILL_SCREEN,
  KEYS_HELP_SCREEN,
  LIST_FOCUSED_SCREEN,
  LIST_FOCUSED_WORKING_SCREEN,
  LIST_HELP_WORKING_SCREEN,
  LIST_PRESS_AGAIN_SCREEN,
  LIST_TWO_SCREEN,
  NEW_MESSAGES_SCREEN,
  ONE_QUESTION_SCREEN,
  PICKER_SCREEN,
  SPINNER_ELAPSED_SCREEN,
  SPINNER_REQUESTING_SCREEN,
  SPINNER_SCREEN,
  WORKING_NAMED_SCREEN,
} from "./support/atomic-0990";

const RULE = "─".repeat(101);

const finished = [
  " The only open item is the one-line doc fix. It passed CI and needs a review.",
  " If you request it, I'll merge it after the approval and check the",
  " release.",
  "",
  `${" ".repeat(24)}↑72M • ↓2.8M • R2408M • W7.8M • CH99.4% • $1027.186 (sub) • 36.3%/1.0M (auto)`,
  RULE,
  "❯",
  RULE,
  "(anthropic) claude-opus-5-5 high • ~/projects/usage-dashboard (preview/prototype-...",
].join("\n");

const working = [
  " Checking extension validation status",
  "",
  "",
  " ∀ Gestating...",
  "",
  `${" ".repeat(27)}↑220k • ↓11k • R3.4M • CH99.8% • $3.131 (sub) • 77.8%/272k (auto)`,
  RULE,
  "❯",
  RULE,
  "esc to interrupt",
  "",
  `╭ BACKGROUND  1 run  ● 1 running ${"─".repeat(60)}╮`,
  `│   ●  9665c474-371a-4dce-9e37-8ba74f9513ab${" ".repeat(50)}│`,
  `│     goal · single · 0/1 · 37m 34s${" ".repeat(58)}│`,
  `╰${"─".repeat(92)}╯`,
  " ↑↓ scroll · Alt+k/Alt+j",
].join("\n");

test("a finished agent's line skips the usage line, prompt box, rules and footer, and keeps its whole wrapped sentence", () => {
  expect(latestLine(finished)).toBe("If you request it, I'll merge it after the approval and check the release.");
});

test("a sentence Atomic wrapped over several lines comes back whole, starting after the previous sentence", () => {
  const wrapped = [
    " up. That's fine for development and demos. It isn't what causes the error.",
    " In short: keeping the protection as it is is fine, and turning it off would be hard, risky and",
    " wouldn't help.",
    "",
    "↑1k • ↓2k • 1.0%/1.0M (auto)",
    RULE,
    "❯",
    RULE,
  ].join("\n");
  expect(latestLine(wrapped)).toBe(
    "In short: keeping the protection as it is is fine, and turning it off would be hard, risky and wouldn't help.",
  );
});

test("Atomic's tool timers are chrome, so a working agent shows its last real line", () => {
  for (const timer of ["Elapsed 6.0s", "Took 7.8s", "Observed for 10.0s", "Elapsed 120ms"]) {
    expect(latestLine([" Writing web/app.js", "", ` ${timer}`, "", " ∀ Gestating...", "↑1k • ↓2k • 1.0%/1.0M (auto)", RULE, "❯", RULE].join("\n"))).toBe("Writing web/app.js");
  }
});

test("a working agent's line skips the spinner, 'esc to interrupt', the background panel and the scroll hint", () => {
  expect(latestLine(working)).toBe("Checking extension validation status");
});

test("a fresh agent with only Atomic's screen has no latest line", () => {
  const fresh = [...Array(9).fill(""), `${" ".repeat(70)}$0.000 (sub) • 0.0%/1.0M (auto)`, RULE, "❯", RULE, "gpt-5.6-sol high • ~/projects/todo-cli", ""].join("\n");
  expect(latestLine(fresh)).toBeNull();
  expect(latestLine("")).toBeNull();
});

test("the jump-to-latest hint, spinner variants and CRLF line ends are skipped", () => {
  const text = [
    " Vai now has read-only access to the preview database.",
    `${" ".repeat(90)}↓ Jump to latest message · ctrl+end`,
    " ⠋ Running... (esc Cancel)",
    " ∀ Maturing the methods...",
    " ✻ Thinking…",
    "",
    "?/1.0M",
  ].join("\r\n");
  expect(latestLine(text)).toBe("Vai now has read-only access to the preview database.");
});

// The shape of Atomic's question dialog (ask-user-question dialog-builder): rule,
// header badge, question, options, the "Type something." and "Chat about this"
// rows Atomic adds itself, the key hint, rule, footer.
test("in a question dialog, the key hint and Atomic's own rows are skipped; the agent's last option is the latest line", () => {
  const dialog = [
    RULE,
    "",
    "  Release track ",
    "",
    " Where should I upload the bundle?",
    "",
    " ❯ 1. Internal testing",
    "      Only your test group gets it.",
    "   2. Closed testing",
    "   3. Production",
    "   4. Type something.",
    "",
    "   5. Chat about this",
    "",
    " enter select · ↑/↓ navigate · esc cancel",
    RULE,
    "(anthropic) claude-opus-5-5 medium • ~/AndroidStudioProjects/weather-app",
  ].join("\n");
  expect(latestLine(dialog)).toBe("3. Production");
  // The prototype's sample dialog orders its hint differently; it is a hint all the same.
  expect(latestLine("Where should I upload the bundle?\n ↑↓ navigate • enter select • esc cancel")).toBe("Where should I upload the bundle?");
});

test("tool rows' ctrl+o expand hints are chrome", () => {
  expect(latestLine([" Writing web/app.js", " Took 0.3s", " ... (18 earlier lines, ctrl+o Expand)", " (ctrl+o Expand)"].join("\n"))).toBe("Writing web/app.js");
});

// The shape of a real Atomic pane showing its workflow graph (a full screen of
// Atomic's own drawing): no line on it is the agent's.
test("a pane showing Atomic's workflow graph has no latest line", () => {
  const graph = [
    " ╭──────────────╮",
    " │ ORCHESTRATOR │  goal                                                                 ✓ 1  ● 1",
    " ╰──────────────╯",
    "                                   ╭─── orchestrator-1 ───╮",
    "                                   │       24m 33s        │",
    "                                   │      ● running       │",
    "                                   ╰──────────────────────╯",
    "                                               │",
    " ╭───────╮",
    " │ GRAPH │      ctrl+x return to main chat  ·  ↵ open tool detail  ·  ↑↓←→ navigate  ·  / stages",
    " ╰───────╯",
    "",
  ].join("\n");
  expect(latestLine(graph)).toBeNull();
});

test("the agent's own words that only look a little like chrome are kept", () => {
  for (const line of [
    "- Running migrations...",
    "Waiting for the build...",
    "Press esc to interrupt it if it hangs.",
    "Cost so far: $3.131",
    "| a | b |",
    "50%/1.0M of the context is used",
    "-------",
  ]) {
    expect(latestLine(`${line}\n\n${RULE}\n❯\n${RULE}\n(anthropic) claude-opus-5-5 high • ~/x\n`)).toBe(line);
  }
});

test("Atomic's transcript scrollbar column is not part of the line, and the wrapped sentence still joins", () => {
  const row = (text: string, bar = "│") => `${text.padEnd(97)}${bar}`;
  const scrolled = [
    row(" Matt doesn't run it every day."),
    row(""),
    row(" So it's one setup by Matt, then automatic forever. For today, the command you're running now", "┃"),
    row(" fixes it.", "┃"),
    "",
    `${" ".repeat(21)}↑72M • ↓2.8M • R2425M • W7.8M • CH99.9% • $1032.124 (sub) • 43.1%/1.0M (auto)`,
    RULE,
    "❯",
    RULE,
  ].join("\n");
  expect(latestLine(scrolled)).toBe("So it's one setup by Matt, then automatic forever. For today, the command you're running now fixes it.");
});

test("without a usage line, nothing under Atomic's prompt box and footer is the agent's line", () => {
  expect(latestLine([" Tests pass.", "", RULE, "❯", RULE, "(anthropic) claude-opus-5-5 high • ~/x", "Tasks  1 shell running · /tasks"].join("\n"))).toBe("Tests pass.");
});

test("without a usage line, a prompt box with no footer under it is the agent's, draft included", () => {
  expect(latestLine([" Tests pass.", "", RULE, "❯", "release notes", RULE].join("\n"))).toBe("release notes");
});

test("a long row of Atomic's own (a ❯ row) above the line is not joined into it", () => {
  const echoed = "❯ this is a long prompt-like line that the agent echoed in its output text here";
  expect(latestLine([echoed, "continuation of it.", "", RULE, "❯", RULE, "(anthropic) claude-opus-5-5 high • ~/x"].join("\n"))).toBe("continuation of it.");
});

test("a labelled rule above the usage line is skipped, so the line above it is the latest", () => {
  const usage = `${" ".repeat(24)}↑72M • ↓2.8M • R2408M • W7.8M • CH99.4% • $1027.186 (sub) • 36.3%/1.0M (auto)`;
  expect(latestLine([" Tests pass.", "[stage: x] ────────", "", usage, RULE, "❯", RULE].join("\n"))).toBe("Tests pass.");
});

test("control characters are dropped", () => {
  expect(latestLine("bell\x07 and\x01 gone\ttab kept")).toBe("bell and gone\ttab kept");
});

test("a long paragraph's line is its last 8 rows", () => {
  const rows = Array.from({ length: 10 }, (_, n) => ` row ${n + 1} of a long paragraph that Atomic wrapped at the pane's width and`);
  expect(latestLine([...rows, " the end."].join("\n"))).toBe([...rows.slice(3), " the end."].map((row) => row.trim()).join(" "));
});

test("a wrapped sentence after an unmatched ``` fence still joins", () => {
  const screen = ["   ```", " Done.", "", " To check what survived, open the Context compacted cards in the chat, which show what", " was kept and the filtered markers.", "", RULE, "❯", RULE, "(anthropic) claude-opus-5-5 high • ~/x"];
  expect(latestLine(screen.join("\n"))).toBe("To check what survived, open the Context compacted cards in the chat, which show what was kept and the filtered markers.");
});

test("a wrapped │ quote joins into one line", () => {
  const quote = [" │ Hi Vai, you now have read-only access to the preview database, open the console and", " │ sign in with your Google account."];
  expect(latestLine([" Here's a message:", "", ...quote, "", RULE, "❯", RULE, "(anthropic) claude-opus-5-5 high • ~/x"].join("\n"))).toBe(
    "│ Hi Vai, you now have read-only access to the preview database, open the console and │ sign in with your Google account.",
  );
});

describe("Atomic 0.9.90", () => {
  const PROMPT_0990 = ["↑1k • ↓2k • 1.0%/1.0M (auto)", RULE, "❯", RULE, "esc to interrupt · ? keys"];

  test("the line is the agent's last words, never the rule named after its tab, the turn line or the list of runs under the footer", () => {
    expect(latestLine(IDLE_NAMED_SCREEN)).toBe("- Connect the rest of the wind page: charts, then filters.");
    expect(latestLine(IDLE_QUOTE_SCREEN)).toBe("│ I can meet on Thursday or Friday, any time after 2pm. If neither suits you, tell me │ a time that does.");
    expect(latestLine(ONE_QUESTION_SCREEN)).toBe(
      'Started. lamp-check wouldn\'t load at first with the error "outputs must be a schema map", so I added outputs: {}, to .atomic/workflows/lamp-check.ts to get it running.',
    );
    expect(latestLine(GENERAL_SCREEN)).toEndWith("If you want them fixed, tell me and I'll edit them and rerun.");
    for (const text of [CROWDED_SCREEN, PICKER_SCREEN]) expect(latestLine(text)).toBe("started.");
  });

  test("while it works, its running tool row is the line, as a tool row always was; the spinner and 'esc to interrupt · ? keys' are skipped", () => {
    expect(latestLine(WORKING_NAMED_SCREEN)).toBe('∀ Bash(ls ~/projects/yard && grep -rn "fence" ~/projects/yard/notes --include=*.md | head -…)');
  });

  test("a turn stopped before its first token: the finished line without a token count is skipped, Atomic's 'Interrupted' row is the line", () => {
    expect(latestLine(INTERRUPTED_SCREEN)).toBe("◼ Interrupted · response");
  });

  test("the spinner without meta, with only its elapsed time, or with '↑ N tokens' is skipped", () => {
    expect(latestLine(SPINNER_SCREEN)).toBe("Use the bash tool once to run: sleep 3; echo done. Then reply with one short sentence.");
    expect(latestLine(SPINNER_ELAPSED_SCREEN)).toBe("Use the bash tool once to run: sleep 3; echo done. Then reply with one short sentence.");
    expect(latestLine(SPINNER_REQUESTING_SCREEN)).toBe("⎿  done");
  });

  test("a finished line of a million tokens or more, or of minutes, is skipped", () => {
    for (const turn of [" ∀ Thought for 1m 12s · ↓ 1.2m tokens", " ∀ Worked for 2h 4m"]) {
      expect(latestLine([" All done.", "", turn, ...PROMPT_0990].join("\n"))).toBe("All done.");
    }
  });

  test("scrolled up, the pill 'jump to bottom' or 'N new messages' is skipped, alone on its row or drawn over the end of the last words", () => {
    expect(latestLine(JUMP_PILL_SCREEN)).toBe("started.");
    expect(latestLine(NEW_MESSAGES_SCREEN)).toBe("10");
    for (const pill of ["↓ 3 new messages · ctrl+end", "↓ 1 new message · ctrl+end"]) {
      const text = JUMP_PILL_SCREEN.replace("↓ jump to bottom · ctrl+end", pill);
      expect(text).not.toBe(JUMP_PILL_SCREEN);
      expect(latestLine(text)).toBe("started.");
    }
    for (const pill of ["↓ jump to bottom · ctrl+end", "↓ 3 new messages · ctrl+end"]) {
      expect(latestLine([` All done.${" ".repeat(40)}${pill}  :`, "", " ∀ Read for 6s · ↓ 215 tokens", ...PROMPT_0990].join("\n"))).toBe("All done.");
    }
  });

  test("with its list of runs focused or its keys box open, the line is still the agent's last words", () => {
    expect(latestLine(LIST_FOCUSED_SCREEN)).toBe("started.");
    for (const text of [LIST_TWO_SCREEN, LIST_PRESS_AGAIN_SCREEN]) expect(latestLine(text)).toBe("again.");
    expect(latestLine(KEYS_HELP_SCREEN)).toBe('The hat-check workflow finished after about 4 minutes. Its answer was "Blue hat", and nothing blocked the run.');
    expect(latestLine(LIST_FOCUSED_WORKING_SCREEN)).toBe("∀ Wait(task-1-0-0) · 8s");
    expect(latestLine(LIST_HELP_WORKING_SCREEN)).toBe("∀ Wait(task-1-0-0) · 10s");
  });

  test("a question dialog's key hint is skipped", () => {
    expect(latestLine([" Use red or blue?", "  ↑↓ select · enter choose · esc cancel"].join("\n"))).toBe("Use red or blue?");
  });
});
