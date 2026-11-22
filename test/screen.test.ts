import { describe, expect, test } from "bun:test";
import { isBoxTopRule, isRule, isUsage, plainText, proseEndingAt, readScreen, shellRows } from "../web/screen.js";
import {
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

type Row = ReturnType<typeof readScreen>["rows"][number];

const ESC = "\x1b";
const sgr = (params: string) => `${ESC}[${params}m`;
const RESET = sgr("0");
const TOOL = sgr("48;2;45;45;48");
const RULE = "─".repeat(101);
const RULE40 = "─".repeat(40);
const USAGE = "↑72M • ↓2.8M • R2408M • W7.8M • CH99.4% • $1027.186 (sub) • 36.3%/1.0M (auto)";
const FOOTER = "(anthropic) claude-opus-5-5 medium • ~/work/app (main)";
const PANEL = ["╭ BACKGROUND  1 run  ● 1 running ─────────╮", "│   ●  958abe02-f7b9-4e7b-a2d6-867a19b47275  │", "│     goal · chain · 8/9 · 55m 58s          │", "╰──────────────────────────────────────────╯"];

const texts = (text: string) => readScreen(text).rows.map((row) => row.text);
const chrome = (text: string) => {
  const screen = readScreen(text);
  return screen.rows.slice(screen.chromeStart).map((row) => row.text);
};
const prose = (text: string) => readScreen(text).prose.map((paragraph) => paragraph.runs.map((run) => run.text).join(""));

describe("rows", () => {
  test("Atomic's transcript scrollbar (│, with a ┃ or █ thumb) is cut from the last column of every row it is drawn on", () => {
    const row = (text: string, bar: string) => `${text.padEnd(97)}${bar}`;
    const rows = texts([row(" Matt doesn't run it every day.", "│"), row("", "│"), row(" So it's one setup by Matt.", "┃"), row(" For today, the command fixes it.", "█"), row(" Next.", "│")].join("\n"));
    expect(rows).toEqual([" Matt doesn't run it every day.", "", " So it's one setup by Matt.", " For today, the command fixes it.", " Next."]);
  });

  test("a panel's own right edge is not a scrollbar, fewer than 3 such rows are none, and █ in prose stays", () => {
    const panel = [PANEL[0], PANEL[2], PANEL[2], PANEL[2], PANEL[3]].map((row) => ` ${row}`);
    expect(texts(panel.join("\n"))).toEqual(panel);
    expect(texts([" one row ending in a bar │", " another one, same length│"].join("\n"))).toEqual([" one row ending in a bar │", " another one, same length│"]);
    expect(texts(" A block █ in prose.")).toEqual([" A block █ in prose."]);
  });

  test("Atomic's jump hint is cut with the rest of its row: at the end, mid-row in an unwrapped read, or as the whole row", () => {
    expect(texts(` ### What I checked           ${TOOL} ↓ Jump to latest message · ctrl+end ${RESET}     `)).toEqual([" ### What I checked"]);
    expect(texts(" What a good design looks like ↓ Jump to latest message · ctrl+end :")).toEqual([" What a good design looks like"]);
    expect(texts(" Done.\n↓ Jump to latest message · ctrl+end\n Next.")).toEqual([" Done.", "", " Next."]);
  });

  test("Atomic 0.9.90's scroll pill is cut the same way, as 'jump to bottom' or 'N new messages'", () => {
    for (const pill of ["↓ jump to bottom · ctrl+end", "↓ 3 new messages · ctrl+end", "↓ 1 new message · ctrl+end", "↓ jump to bottom"]) {
      expect(texts(` Done.\n${" ".repeat(60)}${TOOL} ${pill} ${RESET}\n Next.`)).toEqual([" Done.", "", " Next."]);
      expect(texts(` What a good design looks like ${pill} :`)).toEqual([" What a good design looks like"]);
    }
    expect(texts(" It went down ↓ 3 places.")).toEqual([" It went down ↓ 3 places."]);
  });

  test("row ends are trimmed and only one blank row in a row is kept; styles and shaded rows are read from the escape codes", () => {
    const screen = readScreen(` a.   \n\n\n\n${TOOL} b ${RESET}\n${sgr("1;38;2;0;255;255")}c${RESET} d`);
    expect(screen.rows.map((row) => [row.text, row.band])).toEqual([[" a.", null], ["", null], [" b", "tool"], ["c d", null]]);
    expect(screen.rows[3].runs).toEqual([{ text: "c", cls: "a-b a-code" }, { text: " d", cls: "" }]);
  });

  test("escape codes and control characters never reach the text; a broken escape is dropped up to where it stops", () => {
    expect(plainText(`${sgr("38;2;0;255;255")}cyan${RESET} ${ESC}]8;;https://x${ESC}\\link${ESC}]8;;${ESC}\\ bell\x07 tab\tkept`)).toBe("cyan link bell tab\tkept");
    expect(plainText(`a${ESC}(Bb${ESC}[2Kc${ESC}]0;title`)).toBe("abc");
    expect(plainText(`x${ESC}[38;2;0;255;255"><b>m y`)).toBe("x><b>m y");
  });
});

describe("where Atomic's chrome starts", () => {
  test("at the usage line: the prompt box, footer, 'esc to interrupt', task line, a panel and hints are all chrome", () => {
    const rows = [
      " The worker can find the detect command on its own.",
      "",
      `${" ".repeat(28)}↑20 • ↓5.1k • R377k • W55k • CH98.6% • $0.615 (sub) • 5.8%/1.0M (auto)`,
      "─".repeat(94),
      "❯ please also run",
      "  the tests",
      "─".repeat(94),
      `esc to interrupt${" ".repeat(60)}ctrl+x return to graph`,
      "Tasks  1 shell running · /tasks",
      ...PANEL,
      " ↑↓ scroll · Alt+k/Alt+j",
    ];
    expect(chrome(rows.join("\n"))).toEqual(rows.slice(2).map((row) => row.trimEnd()));
    expect(chrome(`  Done.\n\n${"↑10 • ↓1.8k • R163k • W37k • CH99.1% • $0.365 (sub) ..."}\n${RULE40}\n❯\n${RULE40}`)).toHaveLength(4);
  });

  test("without a usage line, at the last prompt box with Atomic's footer under it, however far from the end", () => {
    const rows = [" The run is on track.", "", RULE40, "❯", RULE40, FOOTER, "", ...PANEL, " ↑↓ scroll · Alt+k/Alt+j", " one more", "Tasks  1 shell running · /tasks"];
    expect(chrome(rows.join("\n"))).toEqual(rows.slice(2));
  });

  test("the agent's own rules and ❯ are not chrome: a box needs Atomic's footer under it, and only the last box counts", () => {
    const own = [" Here is what the prompt box looks like:", "", RULE40, "❯ hello", RULE40, "", " That is all."];
    expect(chrome(own.join("\n"))).toEqual([]);
    expect(chrome([...own, " More.", RULE40, "❯", RULE40, FOOTER].join("\n"))).toEqual([RULE40, "❯", RULE40, FOOTER]);
    expect(chrome([" Done.", RULE40, "❯ unfinished prompt box"].join("\n"))).toEqual([]);
    expect(chrome([" Done.", USAGE, " not a rule under it"].join("\n"))).toEqual([]);
  });

  test("a box under a usage line is the agent's own without Atomic's footer below it, and a usage line with neither a rule nor a box under it starts nothing", () => {
    const rows = [" Done.", USAGE, "╭── Notes ──╮", "│ one      │", "╰──────────╯", " More words."];
    expect(readScreen(rows.join("\n")).rows.some((row) => row.chrome)).toBe(false);
    expect(readScreen([" Done.", USAGE, " More words.", ...PANEL, FOOTER].join("\n")).rows.some((row) => row.chrome)).toBe(false);
  });

  test("Atomic's footer is found with the two spaces Atomic now puts before the thinking level", () => {
    const rows = [" The run is on track.", "", RULE40, "❯", RULE40, "anthropic/claude-opus-5-5  medium • /tmp/work"];
    expect(chrome(rows.join("\n"))).toEqual(rows.slice(2));
  });

  test("a rule is at least 8 of ─━═-, as Atomic draws it; a run of 3 to 7 dashes and a labelled line elsewhere are text", () => {
    for (const rule of ["────────", "  ━━━━━━━━━━  ", "════════", "--------", RULE]) expect(isRule(rule)).toBe(true);
    for (const text of ["---", "───────", "[label] ────────", "── a ──", ""]) expect(isRule(text)).toBe(false);
    expect(chrome([" Done.", "───────", "❯", "───────", FOOTER].join("\n"))).toEqual([]);
  });
});

describe("Atomic 0.9.90's prompt box", () => {
  const usage = "↑1k • ↓2k • 1.0%/1.0M (auto)";
  const bottom = (text: string) => {
    const screen = readScreen(text);
    return screen.rows.slice(screen.chromeStart).map((row) => [row.kind, row.text.trim().replace(/─{8,}/, "────────")]);
  };

  test("the rule named after its tab tops the prompt box, and chrome starts at the turn line straight over the usage line", () => {
    for (const [text, turn, name, footer] of [
      [IDLE_NAMED_SCREEN, "∀ Emancipated for 5s · ↓ 160 tokens", "garden", "anthropic/claude-opus-5-5  medium • ~/projects/weather-app (previ... · ? keys"],
      [IDLE_QUOTE_SCREEN, "∀ Yammered for 3s · ↓ 209 tokens", "draft one", "anthropic/claude-opus-5-5  high • ~/letters/cover · ? keys"],
      [WORKING_NAMED_SCREEN, "∀ Abyss staring back… (7s · ↓ 573 tokens)", "yard ?", "esc to interrupt · ? keys"],
    ]) {
      const rows = bottom(text);
      expect(rows.map(([kind]) => kind)).toEqual(["chrome", "chrome", "rule", "chrome", "rule", "chrome"]);
      expect(rows[0][1]).toBe(turn);
      expect(isUsage(rows[1][1])).toBe(true);
      expect(rows.slice(2).map(([, row]) => row)).toEqual([`──────── ${name} ─`, "❯", "────────", footer]);
    }
  });

  test("scrolled up, the pill row over the turn line is a gap, and chrome still starts at the turn line", () => {
    const screen = readScreen(JUMP_PILL_SCREEN);
    expect(screen.rows.slice(screen.chromeStart - 2, screen.chromeStart + 1).map((row) => [row.kind, row.text.trim()])).toEqual([
      ["prose", "started."],
      ["gap", ""],
      ["chrome", "∀ Read for 6s · ↓ 215 tokens"],
    ]);
    expect(screen.rows.some((row) => row.text.includes("jump to bottom"))).toBe(false);
    const drawnOver = readScreen(NEW_MESSAGES_SCREEN);
    expect(drawnOver.rows.slice(drawnOver.chromeStart - 3, drawnOver.chromeStart + 1).map((row) => [row.kind, row.text.trim()])).toEqual([
      ["prose", "9"],
      ["prose", "10"],
      ["gap", ""],
      ["chrome", "∀ Chattered for 6s · ↓ 61 tokens"],
    ]);
  });

  test("the rows under the footer, a list of runs, are chrome, and the agent's last words above the turn line are not", () => {
    const screen = readScreen(ONE_QUESTION_SCREEN);
    expect(bottom(ONE_QUESTION_SCREEN).slice(-3)).toEqual([
      ["chrome", "anthropic/claude-opus-5-5  medium • ~/projects/yard · 1 needs input · ? keys"],
      ["chrome", ""],
      ["chrome", "◆ lamp-check  Paint the new fence green, or keep the old brown? The paint s...  needs input · 9s"],
    ]);
    expect(screen.rows[screen.chromeStart - 2].text).toContain("to get it running.");
    expect(screen.rows[screen.chromeStart - 2].chrome).toBe(false);
  });

  test("a rule is named only at its end, after at least 8 of ─━═-, ending in ' ─'", () => {
    for (const rule of ["──────── shed ? ─", "──────── draft 2 ─", "  ──────── x ─  "]) expect(isBoxTopRule(rule)).toBe(true);
    for (const text of ["──────── shed ?", "─── shed ─", "──────── ─", "── a ──"]) expect(isBoxTopRule(text)).toBe(false);
    for (const rule of ["──────── shed ? ─", "──────── x ─"]) expect(isRule(rule)).toBe(false);
  });

  test("without a usage line, Atomic 0.9.90's footers still close the prompt box", () => {
    for (const footer of ["esc to interrupt · ? keys", "esc to interrupt · 1 needs input · ? keys", "anthropic/claude-opus-5-5  medium • /tmp/work · ? keys", "  ← graph · pgup/pgdn scroll · ctrl+o expand · ? keys"]) {
      const rows = [" The run is on track.", "", `${RULE40} shed ─`, "❯", RULE40, footer];
      expect(chrome(rows.join("\n"))).toEqual(rows.slice(2));
    }
    expect(chrome([" The run is on track.", "", RULE40, "❯", RULE40, "esc to interrupt"].join("\n"))).toEqual([]);
  });

  test("a turn line is chrome only straight over the usage line; a spinner without its token count, as before, is not", () => {
    expect(chrome([" Done.", " ∀ Emancipated for 5s · ↓ 160 tokens", "", usage, RULE40, "❯", RULE40].join("\n"))[0]).toBe(usage);
    expect(chrome([" Done.", " ∀ Working", usage, RULE40, "❯", RULE40].join("\n"))[0]).toBe(usage);
    expect(chrome([" Done.", " ∀ Tickled for 4s · ↓ 234 tokens", usage, RULE40, "❯", RULE40].join("\n"))[0]).toBe(" ∀ Tickled for 4s · ↓ 234 tokens");
  });

  test("every form of the turn line is chrome: no meta, elapsed only, ↑ or ↓ tokens, a note, finished with or without tokens", () => {
    for (const [text, turn] of [
      [SPINNER_SCREEN, "∀ Aligning the chakras…"],
      [SPINNER_ELAPSED_SCREEN, "∀ Aligning the chakras… (1s)"],
      [SPINNER_REQUESTING_SCREEN, "∀ Surfing the syntax waves… (4s · ↑ 55 tokens)"],
      [INTERRUPTED_SCREEN, "∀ Rustled for 0s"],
    ]) {
      const rows = bottom(text);
      expect(rows.map(([kind]) => kind)).toEqual(["chrome", "chrome", "rule", "chrome", "rule", "chrome"]);
      expect(rows[0][1]).toBe(turn);
    }
    for (const turn of [
      " ∀ Working…",
      " ∀ Compacting context… (3s · ctrl+c to cancel)",
      " ∀ Biffing… (1m 12s · ↓ 1.2m tokens)",
      " ∀ Biffing… (2h 4m · ↑ 3b tokens · ctrl+c to cancel)",
      " ∀ Thought for 1m 12s · ↓ 1.2m tokens",
      " ∀ Worked for 2h 4m",
    ]) {
      expect(chrome([" Done.", "", turn, usage, RULE40, "❯", RULE40, "esc to interrupt · ? keys"].join("\n"))[0]).toBe(turn);
      expect(chrome([" Done.", "", turn, usage, `${RULE40} shed ─`, "❯", RULE40, "(anthropic) claude-opus-5-5 medium • ~/projects/shed"].join("\n"))[0]).toBe(turn);
    }
  });

  test("without a footer ending '· ? keys' or a named rule, an older Atomic's spinner over its usage line stays the agent's row", () => {
    for (const turn of [" ∀ Gestating...", " ∀ Working… (3s)", " ∀ Worked for 2s"]) {
      expect(chrome([" Done.", turn, usage, RULE40, "❯", RULE40, "(anthropic) claude-opus-5-5 medium • ~/projects/shed"].join("\n"))[0]).toBe(usage);
    }
  });

  test("a row that only looks like a turn line, straight over the usage line, is the agent's", () => {
    for (const own of [" ∀ x ∈ S: x is fine", " ∀ Done for now", " ∀ Biffing (soon)"]) {
      expect(chrome([" Done.", own, usage, RULE40, "❯", RULE40, "esc to interrupt · ? keys"].join("\n"))[0]).toBe(usage);
    }
  });

  test("the /workflows picker in the prompt box's place: the usage line and its ▔ edge are chrome, the list is content, its key hint and the footer chrome", () => {
    const screen = readScreen(PICKER_SCREEN);
    const head = (text: string) => text.trim().slice(0, 20);
    const rows = screen.rows.map((row) => [row.chrome, row.kind, head(row.text)]);
    expect(rows.filter(([chrome]) => chrome)).toEqual([
      [true, "chrome", head("↑1.5k • ↓9.8k • R146k")],
      [true, "rule", "▔".repeat(20)],
      [true, "chrome", head("↑↓ select · space preview")],
      [true, "chrome", head("anthropic/claude-opus-5-5")],
    ]);
    expect(rows.filter(([chrome]) => !chrome).map(([, , text]) => text)).toEqual(
      ["started.", "Workflows  ⌕ Search…", "❯ slow-walk · 9c2e5a71", "running · 41s", "lamp-check · 4b7d2c19", "needs input · Paint the new"].map(head),
    );
  });

  test("its list of runs focused with ↓, in the prompt box's place, is chrome from the turn line over the usage line to the end", () => {
    const LIST_FINISHED_SCREEN = LIST_TWO_SCREEN.replace("  ↑↓ select · enter/→ to open · x stop · esc/← back to prompt · ? keys", "  kite-check finished · x to acknowledge");
    expect(LIST_FINISHED_SCREEN).not.toBe(LIST_TWO_SCREEN);
    for (const [text, turn, above, last] of [
      [LIST_FOCUSED_SCREEN, "∀ Freed for 6s · ↓ 201 tokens", "", "anthropic/claude-opus-5-5  medium • ~/projects/attic"],
      [LIST_FOCUSED_WORKING_SCREEN, "∀ Stumbling… (25s · ↓ 357 tokens)", "", "↑↓ select · enter/→ to open · x stop · esc/← back to prompt · ? keys"],
      [LIST_TWO_SCREEN, "∀ Recombobulated for 3s · ↓ 77 tokens", "", "anthropic/claude-opus-5-5  medium • ~/projects/porch"],
      [LIST_PRESS_AGAIN_SCREEN, "∀ Recombobulated for 3s · ↓ 77 tokens", "", "anthropic/claude-opus-5-5  medium • ~/projects/porch"],
      [LIST_FINISHED_SCREEN, "∀ Recombobulated for 3s · ↓ 77 tokens", "", "anthropic/claude-opus-5-5  medium • ~/projects/porch"],
    ]) {
      const screen = readScreen(text);
      const rows = screen.rows.slice(screen.chromeStart);
      expect(rows[0].text.trim()).toBe(turn);
      expect(isUsage(rows[1].text)).toBe(true);
      expect(rows.every((row) => row.chrome && (row.kind === "chrome" || row.kind === "gap"))).toBe(true);
      expect(rows.some((row) => row.text.startsWith("❯ ◆ "))).toBe(true);
      expect(rows[rows.length - 1].text.trim()).toBe(last);
      expect(screen.rows[screen.chromeStart - 1]).toMatchObject({ text: above, chrome: false });
    }
  });

  test("a row like the run list's under the usage line, without the list's key hint, is not the list", () => {
    const screen = readScreen([" Done.", "", " ∀ Freed for 6s · ↓ 201 tokens", usage, "❯ ◆ hat-check  Wear the red hat?  needs input · 2m", "  ↑↓ select · enter choose · esc cancel"].join("\n"));
    expect(screen.chromeStart).toBe(screen.rows.length);
  });

  test("a box in the prompt box's place, the keys help, starts the chrome at the turn line, with its footer under it or none while a turn runs", () => {
    for (const [text, turn, title] of [
      [KEYS_HELP_SCREEN, "∀ Pulsated for 3s · ↓ 181 tokens", "╭─ keys ─"],
      [LIST_HELP_WORKING_SCREEN, "∀ Stumbling… (27s · ↓ 357 tokens)", "╭─ keys · agents ─"],
    ]) {
      const screen = readScreen(text);
      expect(screen.rows[screen.chromeStart].text.trim()).toBe(turn);
      expect(screen.rows[screen.chromeStart - 1].chrome).toBe(false);
      expect(isUsage(screen.rows[screen.chromeStart + 1].text)).toBe(true);
      const box = screen.rows.findIndex((row) => row.text.startsWith(title));
      expect(box).toBe(screen.chromeStart + 2);
      expect(screen.rows[box]).toMatchObject({ kind: "box", chrome: false });
    }
  });

  test("a box under the usage line with nothing below it is the prompt box's stand-in only under a turn line", () => {
    const box = ["╭─ keys ────────╮", "│ enter  send │", "╰─────────────╯", ""];
    const older = readScreen([" Done.", "", usage, ...box].join("\n"));
    expect(older.chromeStart).toBe(older.rows.length);
    const working = readScreen([" Done.", "", " ∀ Stumbling… (27s · ↓ 357 tokens)", usage, ...box].join("\n"));
    expect(working.rows[working.chromeStart].text).toBe(" ∀ Stumbling… (27s · ↓ 357 tokens)");
    expect(working.rows.filter((row) => row.text.startsWith("│")).map((row) => row.chrome)).toEqual([false]);
  });
});

describe("prose", () => {
  test("Atomic's wraps join into one paragraph; short lines, sentence ends, list items and commands start their own", () => {
    const wrapped = " The backend checks the pass is real by comparing Google's signature against";
    expect(prose(`${wrapped}\n Google's keys. It's a stamp.\n Short line\n next line.`)).toEqual([`${wrapped.trim()} Google's keys. It's a stamp.`, "Short line", "next line."]);
    const long = " I'm going to run the focused chart tests now so we can see whether the fix holds up";
    expect(prose(`${long}\n $ bun test src/charts\n${long}\n 2. Keep it\n${long}\n - a bullet`)).toEqual([long.trim(), "$ bun test src/charts", long.trim(), "2. Keep it", long.trim(), "- a bullet"]);
  });

  test("a row joins the next only from 60 characters on, so a shorter row ends its paragraph", () => {
    const row = (length: number) => "w".repeat(length);
    expect(prose(`${row(60)}\nnext`)).toEqual([`${row(60)} next`]);
    expect(prose(`${row(59)}\nnext`)).toEqual([row(59), "next"]);
    // Counted on the trimmed row, not on its indent.
    expect(prose(`  ${row(58)}\nnext`)).toEqual([row(58), "next"]);
  });

  test("a row that ends a sentence (. ! ? : ; ) ] \" ' or `) does not join the next, whatever its length", () => {
    for (const end of [".", "!", "?", ":", ";", ")", "]", '"', "'", "`"]) expect(prose(`${"w".repeat(70)}${end}\nnext`)).toEqual([`${"w".repeat(70)}${end}`, "next"]);
    expect(prose(`${"w".repeat(70)},\nnext`)).toEqual([`${"w".repeat(70)}, next`]);
  });

  test("a paragraph joins at most 8 rows, counted from its first row", () => {
    const rows = Array.from({ length: 10 }, (_, n) => ` row ${n + 1} of a long paragraph that Atomic wrapped at the pane's width and`);
    const screen = readScreen(rows.join("\n"));
    expect(screen.prose.map(({ start, end }) => [start, end])).toEqual([
      [0, 8],
      [8, 10],
    ]);
  });

  test("code, box, shaded and dialog rows are never joined into prose, and nothing in the chrome is prose", () => {
    const long = " The next part is in the block below, which shows the exact command that I ran for it";
    expect(prose(`${long}\n \`\`\`\n echo hi\n \`\`\``)).toEqual([long.trim()]);
    expect(prose(`${long}\n │ a box row │`)).toEqual([long.trim()]);
    expect(prose(`${long}\n${TOOL} shaded ${RESET}`)).toEqual([long.trim()]);
    expect(prose(`${long}\n ❯ 1. Yes\n   2. No`)).toEqual([long.trim()]);
    expect(prose([" Done.", USAGE, RULE40, "❯ a draft long enough to look like it wraps onto the next row of text", "  more", RULE40].join("\n"))).toEqual(["Done."]);
  });
});

describe("the paragraph ending at a row", () => {
  const never = () => false;
  const ending = (text: string, last: number, stops: (row: Row) => boolean = never) => {
    const { rows } = readScreen(text);
    const { start, end, runs } = proseEndingAt(rows, last, stops);
    return { start, end, text: runs.map((run) => run.text).join("") };
  };
  const long = (n: number) => ` row ${n} of a long paragraph that Atomic wrapped at the pane's width and`;

  test("walks back over Atomic's wraps by the same rule as prose, at most 8 rows, so a long paragraph gives its last 8", () => {
    const rows = Array.from({ length: 10 }, (_, n) => long(n + 1));
    expect(ending(rows.join("\n"), 9)).toMatchObject({ start: 2, end: 10 });
    expect(ending(rows.slice(0, 8).join("\n"), 7)).toMatchObject({ start: 0, end: 8 });
    // The wrap rule: a short row or a sentence end above stops it; a list item doesn't join what is above it.
    expect(ending(` Short line\n${long(1)}\n next.`, 2)).toEqual({ start: 1, end: 3, text: `${long(1).trim()} next.` });
    expect(ending(` ${"w".repeat(70)}.\n next.`, 1)).toMatchObject({ start: 1 });
    expect(ending(`${long(1)}\n - a bullet`, 1)).toMatchObject({ start: 1 });
  });

  test("joins rows of any kind, code and box included, and stops at a row the caller says not to join", () => {
    const quote = " │ Hi Vai, you now have read-only access to the preview database, open the console and";
    expect(ending(`${quote}\n │ sign in.`, 1).text).toBe(`${quote.trim()} │ sign in.`);
    const afterFence = ` \`\`\`\n${long(1)}\n next.`;
    expect(readScreen(afterFence).rows[2].kind).toBe("code");
    expect(ending(afterFence, 2).text).toBe(`${long(1).trim()} next.`);
    const prompt = " ❯ a row that the caller treats as its own, long enough to look like a wrap";
    expect(ending(`${prompt}\n next.`, 1).start).toBe(0);
    expect(ending(`${prompt}\n next.`, 1, (row) => row.text.trim().startsWith("❯"))).toEqual({ start: 1, end: 2, text: "next." });
  });
});

describe("a plain shell", () => {
  test("its rows are styled and trimmed, with one blank row in a row; nothing of Atomic's is looked for", () => {
    const row = (text: string) => `${text.padEnd(40)}│`;
    const rows = [row("$ ls"), row("a"), row("b"), "", "", "↓ Jump to latest message · ctrl+end", RULE40, "❯", RULE40, FOOTER];
    expect(shellRows(rows.join("\n")).map((line) => line.text)).toEqual([row("$ ls"), row("a"), row("b"), "", ...rows.slice(5)]);
  });
});
