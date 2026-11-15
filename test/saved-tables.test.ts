import { describe, expect, test } from "bun:test";
import { holdsAnchor, pipeTables } from "../web/pipe-table.js";
import { readLive, readerHtml, readerParts } from "../web/reader.js";
import { createSavedTables } from "../web/saved-tables.js";
import { CUT_TOP_TABLE_SCREEN, NARROW_TABLE_2_SCREEN, NARROW_TABLE_SCREEN, TWO_TABLES_SCREEN } from "./support/atomic-tables";
import { SAVED_CUT_TOP_TABLE, SAVED_NARROW_TABLE, SAVED_NARROW_TABLE_2, SAVED_SHORT_TABLE } from "./support/saved-tables";
import { BOLD, CYAN, RESET, rowsOf } from "./support/stacked";

const saved = (...markdown: string[]) => markdown.flatMap(pipeTables);
const lineOf = (html: string, label: string) => rowsOf(html).map((row) => row.fields.find(([name]) => name === label)?.[1]);
const NOTE = `<p class="stacked-note">Table continues above</p>`;

// A box table as Atomic draws it: `rows` holds each row's cells, each cell its lines.
const drawn = (widths: number[], rows: string[][][], { top = true, bottom = true } = {}) => {
  const rule = (left: string, mid: string, right: string) => ` ${left}${widths.map((w) => "─".repeat(w)).join(mid)}${right}`;
  const shown = (cell: string) => cell.replace(/\x1b\[[0-9;]*m/g, "").length;
  const line = (cells: string[]) => ` │ ${cells.map((cell, i) => cell + " ".repeat(widths[i] - 2 - shown(cell))).join(" │ ")} │`;
  const body = rows.flatMap((cells, index) => [
    ...(index ? [rule("├", "┼", "┤")] : []),
    ...Array.from({ length: Math.max(...cells.map((cell) => cell.length)) }, (_, n) => line(cells.map((cell) => cell[n] ?? ""))),
  ]);
  return [...(top ? [rule("┌", "┬", "┐")] : []), ...body, ...(bottom ? [rule("└", "┴", "┘")] : [])].join("\n");
};

const FRUIT = ["| Fruit | Colour | Notes |", "|---|---|---|", "| Plumcot | Red | Sweet and **very** tart, see `notes.md` |", "| Quincelet | Gold | Firm, [docs](https://example.com/q) |", "| Figlet | Purple | Soft |"].join("\n");
const FRUIT_SCREEN = drawn([11, 8, 13], [[["Fruit"], ["Colour"], ["Notes"]], [["Plumcot"], ["Red"], ["Sweet and", "very tart,", "see notes.m", "d"]], [["Quincelet"], ["Gold"], ["Firm, docs"]], [["Figlet"], ["Purple"], ["Soft"]]]);

describe("a live table takes its cells from Atomic's saved message", () => {
  test("the second narrow capture reads every word as saved, under the saved header's labels", () => {
    const html = readerHtml(NARROW_TABLE_2_SCREEN, saved(SAVED_NARROW_TABLE_2));
    const rows = rowsOf(html);
    expect(rows.map((row) => row.title)).toEqual(["Copperkumquat", "Starfallcherry", "Driftwoodguava"]);
    expect(rows[1].fields).toEqual([
      ["Colour", "Midnight black"],
      ["Taste", "Deep and winey"],
      ["Notes", "These cherries form only on trees struck during meteor showers, according to growers, which explains their rarity and remarkably high price."],
    ]);
    expect(lineOf(html, "Notes")[2]).toStartWith("Found growing near rocky coastlines,");
    expect(html).toStartWith(`<div class="stacked">${NOTE}`);
  });

  test("the first narrow capture reads Ripplequince and Bramblebells, and the exact-fit words keep their spaces", () => {
    const html = readerHtml(NARROW_TABLE_SCREEN, saved(SAVED_NARROW_TABLE));
    const rows = rowsOf(html);
    expect(rows.map((row) => row.title)).toEqual(["Honeyhusk", "Ripplequince", "Bramblebell"]);
    expect(rows[1].fields).toEqual([
      ["Colour", "Marbled cream"],
      ["Taste", "Mellow"],
      ["Notes", "Ripplequinces have swirling patterns on their skin, and no two fruits ever look exactly alike, according to local orchard keepers."],
    ]);
    expect(rows[2].fields.at(-1)?.[1]).toBe("Bramblebells hang like tiny lanterns from thorny hedges, and birds compete fiercely with villagers to gather them each spring.");
  });

  test("without a saved copy the same screens keep the screen's reading, glued exact fits and all", () => {
    const [, cherry, guava] = rowsOf(readerHtml(NARROW_TABLE_2_SCREEN));
    expect(cherry.title).toBe("Starfallcherry");
    expect(guava.title).toBe("Driftwoodguava");
    expect(cherry.fields.at(-1)?.[1]).toContain("These cherriesform only");
    expect(cherry.fields.at(-1)?.[1]).toContain("which explainstheir rarity");
  });

  test("the cut-top and two-table captures: a table whose header alone is off screen gets its labels and no note; a whole table matches from its header", () => {
    const tables = saved(SAVED_CUT_TOP_TABLE, SAVED_SHORT_TABLE);
    const cut = readerHtml(CUT_TOP_TABLE_SCREEN, tables);
    expect(cut).not.toContain(NOTE);
    expect(rowsOf(cut).map((row) => row.title)).toEqual(["Alpha rule", "Beta skill", "Gamma modeling"]);
    expect(rowsOf(cut)[0].fields.map(([label]) => label)).toEqual(["Add?", "Why", "Possible problems"]);
    expect(lineOf(cut, "Why")[2]).toContain("a structured, well-documented foundation for future multi-layer features");
    expect(cut).toContain(`<span class="a-code">rules.md</span>`);
    expect(cut).toContain(`data-copy="/tmp/d40/shot.png"`);
    expect(cut).toContain(`data-view="/tmp/d40/shot.png"`);
    expect(cut).not.toContain(`<strong class="stacked-title"><span class="a-b">`);
    const both = readerParts(TWO_TABLES_SCREEN, tables).filter((part) => part.startsWith(`<div class="stacked">`));
    expect(both).toHaveLength(2);
    expect(rowsOf(both[1])).toEqual([
      { title: "Alpha", fields: [["Status", "Done"], ["Notes", "Rule added and checked against current team conventions."]] },
      { title: "Beta", fields: [["Status", "Pending"], ["Notes", "Skill draft needs a clearer SKILL.md trigger description."]] },
      { title: "Gamma", fields: [["Status", "Skipped"], ["Notes", "Modeling deferred until project scope clearly justifies it."]] },
    ]);
  });

  test("inline styles are the Reader's: bold, code chips and links in a saved cell", () => {
    const html = readerHtml(FRUIT_SCREEN, saved(FRUIT));
    expect(html).toContain(`<dd>Sweet and <span class="a-b">very</span> tart, see <span class="a-code">notes.md</span></dd>`);
    expect(html).toContain(`<dd>Firm, <a class="a-link" href="https://example.com/q" target="_blank" rel="noopener noreferrer">docs</a></dd>`);
    expect(rowsOf(html).map((row) => row.title)).toEqual(["Plumcot", "Quincelet", "Figlet"]);
  });

  test("a table whose top is off screen matches a run of the saved rows by their cells, with the saved labels and the note", () => {
    const screen = drawn([11, 8, 13], [[[""], [""], ["d"]], [["Quincelet"], ["Gold"], ["Firm, docs"]], [["Figlet"], ["Purple"], ["Soft"]]], { top: false });
    const html = readerHtml(screen, saved(FRUIT));
    expect(rowsOf(html)).toEqual([
      { title: "Plumcot", fields: [["Colour", "Red"], ["Notes", "Sweet and very tart, see notes.md"]] },
      { title: "Quincelet", fields: [["Colour", "Gold"], ["Notes", "Firm, docs"]] },
      { title: "Figlet", fields: [["Colour", "Purple"], ["Notes", "Soft"]] },
    ]);
    expect(html).not.toContain(NOTE);
    const lower = readerHtml(drawn([11, 8, 13], [[["Quincelet"], ["Gold"], ["Firm, docs"]], [["Figlet"], ["Purple"], ["Soft"]]], { top: false }), saved(FRUIT));
    expect(lower).toStartWith(`<div class="stacked">${NOTE}`);
    expect(rowsOf(lower).map((row) => row.title)).toEqual(["Quincelet", "Figlet"]);
  });

  test("the anchor is the first row drawn whole: the header when drawn, never a row cut by the screen's top; a table read from its saved copy has none", () => {
    expect(readLive(FRUIT_SCREEN).anchors).toEqual(["Fruit Colour Notes"]);
    expect(readLive(drawn([11, 8, 13], [[[""], [""], ["d"]], [["Quincelet"], ["Gold"], ["Firm, docs"]]], { top: false })).anchors).toEqual(["Quincelet Gold Firm,docs"]);
    expect(readLive(drawn([11, 8, 13], [[[""], [""], ["d"]]], { top: false })).anchors).toEqual([]);
    expect(readLive(FRUIT_SCREEN, saved(FRUIT)).anchors).toEqual([]);
    expect(readLive(NARROW_TABLE_2_SCREEN).anchors).toEqual([
      "Starfallcherry Midnightblack Deepandwiney Thesecherriesformonlyontreesstruckduringmeteorshowers,accordingtogrowers,whichexplainstheirrarityandremarkablyhighprice.",
    ]);
  });
});

describe("with any doubt the table is read from the screen as before", () => {
  const unchanged = (screen: string, tables: ReturnType<typeof saved>) => expect(readerParts(screen, tables)).toEqual(readerParts(screen));

  test("no saved table, another table, or the right table with one cell changed", () => {
    for (const screen of [NARROW_TABLE_SCREEN, NARROW_TABLE_2_SCREEN, CUT_TOP_TABLE_SCREEN, TWO_TABLES_SCREEN, FRUIT_SCREEN]) {
      unchanged(screen, []);
      unchanged(screen, saved(FRUIT.replace("Plumcot", "Plum")));
    }
    unchanged(NARROW_TABLE_2_SCREEN, saved(SAVED_NARROW_TABLE_2.replace("Midnight black", "Midnight blue")));
    unchanged(NARROW_TABLE_SCREEN, saved(SAVED_NARROW_TABLE_2));
    unchanged(FRUIT_SCREEN, saved(FRUIT.replace("| Notes |", "| Notes | More |").replace("|---|---|---|", "|---|---|---|---|")));
  });

  test("two saved tables that both fit but read differently", () => {
    const screen = drawn([11, 8, 13], [[["Quincelet"], ["Gold"], ["Firm, docs"]], [["Figlet"], ["Purple"], ["Soft"]]], { top: false });
    unchanged(screen, saved(FRUIT, FRUIT.replace("| Fruit | Colour | Notes |", "| Name | Hue | About |")));
    expect(readerParts(screen, saved(FRUIT, FRUIT))).toEqual(readerParts(screen, saved(FRUIT)));
  });

  test("a drawn header must be the saved header, and a drawn bottom the saved table's last row", () => {
    unchanged(drawn([11, 8, 13], [[["Quincelet"], ["Gold"], ["Firm, docs"]], [["Figlet"], ["Purple"], ["Soft"]]]), saved(FRUIT));
    unchanged(drawn([11, 8, 13], [[["Fruit"], ["Colour"], ["Notes"]], [["Plumcot"], ["Red"], ["Sweet and", "very tart,", "see notes.m", "d"]]]), saved(FRUIT));
  });

  test("a screen with only part of a row has nothing to match", () => {
    unchanged(drawn([11, 8, 13], [[[""], [""], ["d"]]], { top: false }), saved(FRUIT));
  });

  test("a box that is not a table is untouched", () => {
    const panel = [" ╭ NOTE ──────────╮", " │ a note         │", " ╰────────────────╯"].join("\n");
    unchanged(panel, saved(FRUIT));
  });
});

describe("hostile saved cells", () => {
  test("stay text", () => {
    const hostile = [
      "| <b>Name</b> | Note |",
      "|---|---|",
      `| <script>x</script> | <img src=x onerror=alert(1)> "q" & |`,
    ].join("\n");
    const screen = drawn([22, 36], [[["<b>Name</b>"], ["Note"]], [["<script>x</script>"], ["<img src=x onerror=alert(1)>", `"q" &`]]]);
    const html = readerHtml(screen, saved(hostile));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(rowsOf(html)).toEqual([{ title: "<script>x</script>", fields: [["Note", `<img src=x onerror=alert(1)> "q" &`]] }]);
    for (const [, attribute] of html.matchAll(/ ([a-z-]+)="/g)) expect(["class", "href", "target", "rel"]).toContain(attribute);
  });

  test("bold and code drawn as styles compare equal to their saved marks", () => {
    const screen = drawn([9, 14], [[[`${BOLD}Name${RESET}`], [`${BOLD}Note${RESET}`]], [[`${BOLD}Alpha${RESET}`], [`see ${CYAN}a_b.md${RESET}`]]]);
    expect(rowsOf(readerHtml(screen, saved("| Name | Note |\n|---|---|\n| **Alpha** | see `a_b.md` |")))).toEqual([{ title: "Alpha", fields: [["Note", "see a_b.md"]] }]);
  });
});

describe("the tables in a saved message", () => {
  test("a code fence right after a table is still a fence, so the table after it is found", () => {
    const headers = (markdown: string) => pipeTables(markdown).map((table) => table.header);
    expect(headers(["| A | B |", "|---|---|", "| one | two |", "```", "code", "```", "", "| C | D |", "|---|---|", "| after | fence |"].join("\n"))).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
    expect(headers(["| A | B |", "|---|---|", "| one | two |", "```", "| C | D |", "|---|---|", "| in | fence |", "```"].join("\n"))).toEqual([["A", "B"]]);
  });
});

describe("asking the laptop for saved tables", () => {
  const PLUMCOT = "Plumcot Red Sweetandverytart,seenotes.md";
  const fruit = saved(FRUIT);

  function setup() {
    const asked: { paneId: string; anchors: string[] }[] = [];
    const answers: { resolve: (tables: ReturnType<typeof saved>) => void; reject: (error: Error) => void }[] = [];
    const timeouts = new Map<number, () => void>();
    let nextId = 1;
    let found = 0;
    const module = createSavedTables({
      client: {
        readSavedTables: (paneId: string, anchors: string[]) => {
          asked.push({ paneId, anchors });
          return new Promise((resolve, reject) => answers.push({ resolve: (tables) => resolve({ tables }), reject }));
        },
      },
      timers: {
        setTimeout: (run: () => void) => (timeouts.set(nextId, run), nextId++),
        clearTimeout: (id: number) => timeouts.delete(id),
      },
      onFound: () => found++,
    });
    const answer = async (tables: ReturnType<typeof saved>) => {
      answers.shift()?.resolve(tables);
      await Bun.sleep(0);
    };
    const fail = async () => {
      answers.shift()?.reject(new Error("The laptop didn't answer."));
      await Bun.sleep(0);
    };
    const settle = () => {
      const runs = [...timeouts.values()];
      timeouts.clear();
      for (const run of runs) run();
    };
    return { module, asked, answer, fail, settle, found: () => found, waiting: () => timeouts.size };
  }

  function page() {
    const parts = setup();
    const store: ReturnType<typeof saved> = [];
    const show = (screen: string) => {
      const { parts: html, anchors, read } = readLive(screen, parts.module.tables());
      parts.module.live(screen, anchors, read);
      return html.join("");
    };
    const answerFromStore = () => {
      const anchors = new Set(parts.asked.at(-1)?.anchors);
      return parts.answer([...store].reverse().filter((table) => holdsAnchor(table, anchors)));
    };
    return { ...parts, store, show, answerFromStore };
  }

  test("the screen an Agent opens on is asked about at once, and a table read from its saved copy is not asked about again", async () => {
    const { module, asked, answerFromStore, found, settle, waiting, store, show } = page();
    store.push(...fruit);
    show(FRUIT_SCREEN);
    expect(asked).toEqual([]);
    module.open("w1:p1", "agent");
    expect(asked).toEqual([{ paneId: "w1:p1", anchors: ["Fruit Colour Notes"] }]);
    await answerFromStore();
    expect([found(), module.tables()]).toEqual([1, fruit]);
    expect(rowsOf(show(FRUIT_SCREEN)).map((row) => row.title)).toEqual(["Plumcot", "Quincelet", "Figlet"]);
    show(`${FRUIT_SCREEN}\n status`);
    show(`${FRUIT_SCREEN}\n status`);
    settle();
    expect([asked.length, waiting()]).toEqual([1, 0]);
  });

  test("a second table with the same header gets its own saved words once it is saved", async () => {
    const plum = "| Fruit | Notes |\n|---|---|\n| Plum | Plums ripen late |";
    const pear = "| Fruit | Notes |\n|---|---|\n| Pear | Pears grow quickly in sun |";
    const plumScreen = drawn([7, 18], [[["Fruit"], ["Notes"]], [["Plum"], ["Plums ripen late"]]]);
    const pearScreen = drawn([7, 18], [[["Fruit"], ["Notes"]], [["Pear"], ["Pears grow", "quickly in sun"]]]);
    const { module, asked, answerFromStore, settle, store, show } = page();
    store.push(...saved(plum));
    module.open("w1:p1", "agent");
    show(plumScreen);
    await answerFromStore();
    expect(readLive(plumScreen, module.tables()).anchors).toEqual([]);
    show(`${plumScreen}\n\n${pearScreen}`);
    settle();
    await answerFromStore();
    expect(asked.map(({ anchors }) => anchors)).toEqual([["Fruit Notes"], ["Fruit Notes"]]);
    store.push(...saved(pear));
    show(`${plumScreen}\n\n${pearScreen}\n status`);
    settle();
    await answerFromStore();
    expect(module.tables()).toEqual(saved(pear, plum));
    expect(rowsOf(show(`${plumScreen}\n\n${pearScreen}\n status`))).toEqual([
      { title: "Plum", fields: [["Notes", "Plums ripen late"]] },
      { title: "Pear", fields: [["Notes", "Pears grow quickly in sun"]] },
    ]);
    settle();
    expect(asked).toHaveLength(3);
  });

  test("of more saved tables than are kept, the newest are kept: a common header still finds the table just written", async () => {
    const change = (n: number) => `| File | Change |\n|---|---|\n| f${n}.ts | changed \`the\` thing number ${n} here |`;
    const screen = drawn([10, 18], [[["File"], ["Change"]], [["f25.ts"], ["changed the", "thing number 25", "here"]]]);
    const { module, answerFromStore, store, show } = page();
    store.push(...saved(...Array.from({ length: 25 }, (_, n) => change(n + 1))));
    module.open("w1:p1", "agent");
    show(screen);
    await answerFromStore();
    expect(module.tables()).toEqual(saved(...Array.from({ length: 20 }, (_, n) => change(25 - n))));
    expect(show(screen)).toBe(readerHtml(screen, saved(change(25))));
    expect(show(screen)).not.toBe(readerHtml(screen));
  });

  test("a table read on the screen is kept past the cap, so two tables with common headers don't take turns", async () => {
    const change = (n: number) => `| File | Change |\n|---|---|\n| f${n}.ts | changed thing ${n} |`;
    const note = (n: number) => `| Name | Note |\n|---|---|\n| n${n} | noted thing ${n} |`;
    const files = drawn([10, 18], [[["File"], ["Change"]], [["f25.ts"], ["changed thing 25"]]]);
    const notes = drawn([10, 18], [[["Name"], ["Note"]], [["n25"], ["noted thing 25"]]]);
    const { module, asked, answerFromStore, settle, store, show } = page();
    store.push(...saved(...Array.from({ length: 25 }, (_, n) => change(n + 1))));
    module.open("w1:p1", "agent");
    show(files);
    await answerFromStore();
    store.push(...saved(...Array.from({ length: 25 }, (_, n) => note(n + 1))));
    show(`${files}\n\n${notes}`);
    settle();
    await answerFromStore();
    expect(module.tables()).toHaveLength(21);
    for (let tick = 0; tick < 3; tick++) {
      const screen = `${files}\n\n${notes}\n status ${tick}`;
      expect(show(screen)).toBe(readerHtml(screen, saved(change(25), note(25))));
      settle();
    }
    expect(asked.map(({ anchors }) => anchors)).toEqual([["File Change"], ["Name Note"]]);
  });

  test("nothing is asked while the screen stays the same, or for a screen with no table", async () => {
    const { module, asked, answer, settle } = setup();
    module.open("w1:p1", "agent");
    module.live("no table here", []);
    module.live("no table here", []);
    settle();
    expect(asked).toEqual([]);
    module.live("screen 1", [PLUMCOT]);
    await answer([]);
    for (let i = 0; i < 5; i++) module.live("screen 1", [PLUMCOT]);
    settle();
    expect(asked).toHaveLength(1);
  });

  test("a missed table is asked for again once the changed screen has settled, one ask however many refreshes", async () => {
    const { module, asked, answer, settle, found } = setup();
    module.open("w1:p1", "agent");
    module.live("screen 1", [PLUMCOT]);
    await answer([]);
    for (let i = 2; i < 8; i++) module.live(`screen ${i}`, [PLUMCOT]);
    expect(asked).toHaveLength(1);
    settle();
    expect(asked).toHaveLength(2);
    await answer(fruit);
    expect(found()).toBe(1);
  });

  test("an anchor longer than the laptop takes is never asked about, so it can't sink the others", () => {
    const { module, asked } = setup();
    module.open("w1:p1", "agent");
    module.live("screen 1", ["x".repeat(4001), PLUMCOT]);
    expect(asked).toEqual([{ paneId: "w1:p1", anchors: [PLUMCOT] }]);
  });

  test("with more unread tables than one ask holds, the ones never asked about go first next time", async () => {
    const { module, asked, answer, settle } = setup();
    module.open("w1:p1", "agent");
    module.live("screen 1", ["a", "b", "c", "d", "e"]);
    await answer([]);
    module.live("screen 2", ["a", "b", "c", "d", "e"]);
    settle();
    expect(asked.map(({ anchors }) => anchors)).toEqual([
      ["a", "b", "c", "d"],
      ["e", "a", "b", "c"],
    ]);
  });

  test("a failed ask counts as a miss", async () => {
    const { module, asked, fail, settle, found } = setup();
    module.open("w1:p1", "agent");
    module.live("screen 1", [PLUMCOT]);
    await fail();
    settle();
    expect([asked.length, found(), module.tables()]).toEqual([1, 0, []]);
  });

  test("a shell is never asked about, and its tables stay the same empty list however often it is opened", () => {
    const { module, asked, settle } = setup();
    module.open("w1:p2", "shell");
    const none = module.tables();
    module.live("screen 1", [PLUMCOT]);
    module.open("w1:p2", "shell");
    settle();
    expect(asked).toEqual([]);
    expect(module.tables()).toBe(none);
  });

  test("an answer after leaving, or after opening another Terminal, is dropped", async () => {
    const { module, asked, answer, found } = setup();
    module.open("w1:p1", "agent");
    module.live("screen 1", [PLUMCOT]);
    module.leave();
    await answer(fruit);
    module.open("w1:p3", "agent");
    module.live("screen 1", [PLUMCOT]);
    expect(asked.map(({ paneId }) => paneId)).toEqual(["w1:p1", "w1:p3"]);
    module.open("w1:p1", "agent");
    await answer(fruit);
    await answer(fruit);
    expect([found(), module.tables()]).toEqual([0, []]);
  });
});
