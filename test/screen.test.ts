import { describe, expect, test } from "bun:test";
import { isRule, plainText, proseEndingAt, readScreen, shellRows } from "../web/screen.js";

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
  test("at the usage line: the labelled prompt box, footer, 'esc to interrupt', task line, background panel and hints are all chrome", () => {
    const rows = [
      " The worker can find the detect command on its own.",
      "",
      `${" ".repeat(28)}↑20 • ↓5.1k • R377k • W55k • CH98.6% • $0.615 (sub) • 5.8%/1.0M (auto)`,
      `[stage: orchestrator-1] ${"─".repeat(70)}`,
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

  test("a rule is at least 8 of ─━═-, as Atomic draws it; a run of 3 to 7 dashes and a labelled line elsewhere are text", () => {
    for (const rule of ["────────", "  ━━━━━━━━━━  ", "════════", "--------", RULE]) expect(isRule(rule)).toBe(true);
    for (const text of ["---", "───────", "[label] ────────", "── a ──", ""]) expect(isRule(text)).toBe(false);
    expect(chrome([" Done.", "───────", "❯", "───────", FOOTER].join("\n"))).toEqual([]);
  });
});

// The shape of a real Atomic pane showing its full-screen workflow graph.
const GRAPH = [
  " ╭──────────────╮",
  " │ ORCHESTRATOR │  goal                                                                 ✓ 1  ● 1",
  " ╰──────────────╯",
  "",
  "                                   ╭─── orchestrator-1 ───╮",
  "                                   │      ● running       │",
  "                                   ╰──────────────────────╯",
  "                                               │",
  "                                               │",
  "                                               │",
  "                                   ╭────── worker-1 ──────╮",
  "                                   ╰──────────────────────╯",
  "",
  "",
  "",
  " ╭───────╮",
  " │ GRAPH │      ctrl+x return to main chat  ·  ↵ open tool detail  ·  ↑↓←→ navigate  ·  / stages",
  " ╰───────╯",
];

describe("Atomic's workflow graph", () => {
  test("with its GRAPH pill among the last rows, the screen is a graph: all chrome, every row as drawn", () => {
    const screen = readScreen([...GRAPH, "", ""].join("\n"));
    expect(screen.graph).toBe(true);
    expect(screen.chromeStart).toBe(0);
    expect(screen.prose).toEqual([]);
    // The connector rows keep their │ (they look like a scrollbar), and the blank rows stay.
    expect(screen.rows.map((row) => row.text)).toEqual([...GRAPH, "", ""]);
  });

  test("a pill further up is not a graph screen, and jump-hint rows after a graph don't make it one: the graph is found on the rows as drawn", () => {
    expect(readScreen([...GRAPH, " The graph above is from earlier.", " Then I", " went on."].join("\n")).graph).toBe(false);
    const hint = `${" ".repeat(60)}↓ Jump to latest message · ctrl+end`;
    expect(readScreen([...GRAPH, hint, hint, hint].join("\n")).graph).toBe(false);
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
