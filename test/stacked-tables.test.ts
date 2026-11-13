import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markdownHtml } from "../web/history.js";
import { readerHtml, readerParts } from "../web/reader.js";
import { CUT_TOP_TABLE_SCREEN, TWO_TABLES_SCREEN } from "./support/atomic-tables";

const ESC = "\x1b";
const BOLD = `${ESC}[0m${ESC}[1m`;
const CYAN = `${ESC}[0m${ESC}[38;2;0;255;255m`;
const RESET = `${ESC}[0m`;

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

type Row = { title: string | null; fields: [string | null, string][] };

// What a reader of the page sees: each row's title and its lines, as plain text.
function rowsOf(html: string): Row[] {
  return [...html.matchAll(/<section class="stacked-row">(.*?)<\/section>/g)].map(([, inner]) => {
    const title = inner.match(/<strong class="stacked-title">(.*?)<\/strong>/)?.[1];
    const fields = [...inner.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>|<p class="stacked-line">(.*?)<\/p>/g)].map(
      (field): [string | null, string] => [field[1] === undefined ? null : text(field[1]), text(field[2] ?? field[3])],
    );
    return { title: title === undefined ? null : text(title), fields };
  });
}

const blocksOf = (html: string) => [...html.matchAll(/<div class="block">(.*?)<\/div>/gs)].map((match) => match[1]);

describe("Markdown tables in Earlier messages", () => {
  const TABLE = [
    "| Extra | Add? | Why |",
    "|---|:---:|---:|",
    "| **Research rule** | Yes | It's tiny: *cite* sources, see `notes.md` |",
    "| Prototype skill | Fold into **idea-to-build** | Picture at /tmp/shot.png and [the docs](https://example.com/a) |",
  ].join("\n");

  test("a header, a separator row and data rows become one stacked block: first cell as the title, the other cells as header: text lines", () => {
    const html = markdownHtml(TABLE);
    expect(html).toStartWith(`<div class="stacked">`);
    expect(html).not.toContain(`class="block"`);
    expect(rowsOf(html)).toEqual([
      { title: "Research rule", fields: [["Add?", "Yes"], ["Why", "It's tiny: cite sources, see notes.md"]] },
      { title: "Prototype skill", fields: [["Add?", "Fold into idea-to-build"], ["Why", "Picture at /tmp/shot.pngcopyview and the docs"]] },
    ]);
  });

  test("the title is bold once, the label is plain text, and each row is a section with a strong title and a definition list", () => {
    expect(markdownHtml(TABLE)).toStartWith(
      `<div class="stacked"><section class="stacked-row"><strong class="stacked-title">Research rule</strong><dl class="stacked-fields"><dt>Add?</dt><dd>Yes</dd><dt>Why</dt><dd>It&#39;s tiny: <span class="a-i">cite</span> sources, see <span class="a-code">notes.md</span></dd></dl></section>`,
    );
  });

  test("cell text keeps bold, italics, code chips, laptop-path copy and view keys and links", () => {
    const html = markdownHtml(TABLE);
    expect(html).toContain(`<span class="a-b">idea-to-build</span>`);
    expect(html).toContain(`data-copy="/tmp/shot.png"`);
    expect(html).toContain(`data-view="/tmp/shot.png"`);
    expect(html).toContain(`<a class="a-link" href="https://example.com/a" target="_blank" rel="noopener noreferrer">the docs</a>`);
  });

  test("a header's label is plain text in both kinds of table: no chips, styles or keys inside it", () => {
    const html = markdownHtml(["| Name | `code` *it* /tmp/a.png <b>&x |", "|---|---|", "| row | value |"].join("\n"));
    const label = html.match(/<dt>(.*?)<\/dt>/)?.[1];
    expect(label).toBe("code it /tmp/a.png &lt;b&gt;&amp;x");
  });

  test("a cell under an empty header cell is a plain line of its own, never a value with no label", () => {
    const html = markdownHtml(["| Name | | Why |", "|---|---|---|", "| row | loose | because |"].join("\n"));
    expect(html).not.toContain("stacked-bare");
    expect(html).not.toMatch(/<dl class="stacked-fields"><dd/);
    expect(html).not.toMatch(/<\/dd><dd/);
    expect(rowsOf(html)).toEqual([{ title: "row", fields: [[null, "loose"], ["Why", "because"]] }]);
  });

  test("an escaped pipe and a pipe inside a code span stay inside their cell", () => {
    const html = markdownHtml(["| Name | Value |", "|---|---|", "| a \\| b | `x | y` |", "| `c\\|d` | plain |"].join("\n"));
    expect(rowsOf(html)).toEqual([
      { title: "a | b", fields: [["Value", "x | y"]] },
      { title: "c|d", fields: [["Value", "plain"]] },
    ]);
  });

  test("an empty cell gives no line, and a row with an empty first cell has no title", () => {
    const html = markdownHtml(["| Name | A | B |", "|---|---|---|", "| one | | two |", "| | x | |", "| | | |"].join("\n"));
    expect(rowsOf(html)).toEqual([
      { title: "one", fields: [["B", "two"]] },
      { title: null, fields: [["A", "x"]] },
    ]);
  });

  test("a row with fewer cells than the header leaves the rest empty", () => {
    expect(rowsOf(markdownHtml(["| Name | A | B |", "|---|---|---|", "| one | 1 |"].join("\n")))).toEqual([{ title: "one", fields: [["A", "1"]] }]);
  });

  test("hostile cell text and headers stay text", () => {
    const html = markdownHtml(["| first | <img src=x onerror=alert(1)> \"q\" & 'a' |", "|---|---|", "| <script>alert(1)</script> | <b>x</b> [l](javascript:alert(1)) |"].join("\n"));
    expect(html).not.toMatch(/<(?!\/?(?:div|section|strong|dl|dt|dd|span|p)\b)/);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("href=\"javascript");
    expect(rowsOf(html)).toEqual([{ title: "<script>alert(1)</script>", fields: [[`<img src=x onerror=alert(1)> "q" & 'a'`, "<b>x</b> l)"]] }]);
    for (const [, attribute] of html.matchAll(/ ([a-z-]+)="/g)) expect(["class", "href", "target", "rel"]).toContain(attribute);
  });

  test("a header or title written wholly in bold, with ** or __, shows as plain text", () => {
    const html = markdownHtml(["| **Name** | **Note** |", "|---|---|", "| __one__ | text |"].join("\n"));
    expect(html).toBe(`<div class="stacked"><section class="stacked-row"><strong class="stacked-title">one</strong><dl class="stacked-fields"><dt>Note</dt><dd>text</dd></dl></section></div>`);
  });

  test("no separator row, no data row, a different separator or a row with extra cells is not a table: the mono block stays", () => {
    for (const rows of [
      ["| a | b |", "| c | d |"],
      ["| a | b |", "|---|---|"],
      ["| a | b |", "|--|", "| c | d |"],
      ["| a | b |", "| -- | text |", "| c | d |"],
      ["| a | b |", "|---|---|", "| c | d | e |"],
    ]) {
      expect(markdownHtml(rows.join("\n"))).toBe(`<div class="block">${rows.join("\n")}</div>`);
    }
  });

  test("a table sits between paragraphs, which join as before; pipes outside a table line are prose", () => {
    const html = markdownHtml(["Here is a choice: a | b stays prose.", "", "| k | v |", "|---|---|", "| x | y |", "", "After."].join("\n"));
    expect(html).toStartWith(`<p class="p">Here is a choice: a | b stays prose.</p><div class="gap"></div><div class="stacked">`);
    expect(html).toEndWith(`</div><div class="gap"></div><p class="p">After.</p>`);
  });
});

describe("Atomic's box-drawn tables on the Live screen", () => {
  test("a whole table (┌┬┐ ├┼┤ └┴┘) becomes stacked rows: the first cell is the title, wrapped lines are rejoined and header cells are the labels", () => {
    const html = readerHtml(TWO_TABLES_SCREEN);
    const whole = html.slice(html.lastIndexOf(`<div class="stacked">`));
    expect(rowsOf(whole)).toEqual([
      { title: "Alpha", fields: [["Status", "Done"], ["Notes", "Rule added and checked against current team conventions."]] },
      { title: "Beta", fields: [["Status", "Pending"], ["Notes", "Skill draft needs a clearer SKILL.md trigger description."]] },
      { title: "Gamma", fields: [["Status", "Skipped"], ["Notes", "Modeling deferred until project scope clearly justifies it."]] },
    ]);
    expect(whole).not.toContain("Table continues above");
    expect(whole).not.toMatch(/[│┌└├]/);
  });

  test("a table whose top is above the screen shows its visible rows in cell order under \"Table continues above\", with no labels", () => {
    const html = readerHtml(CUT_TOP_TABLE_SCREEN);
    expect(html).toContain(`<div class="stacked"><p class="stacked-note">Table continues above</p><section class="stacked-row">`);
    const rows = rowsOf(html);
    expect(rows.map((row) => row.title)).toEqual([null, "Beta skill", "Gamma modeling"]);
    expect(rows.every((row) => row.fields.every(([label]) => label === null))).toBe(true);
    expect(rows[0].fields.map(([, line]) => line)).toEqual(['done" during a well-scoped three-part review.', "as absolute even when a case-by-case judgment fits better."]);
    expect(rows[1].fields.map(([, line]) => line)[0]).toBe("Maybe");
  });

  test("a word Atomic split at the column's full width is rejoined; a line that merely fills the column keeps its space", () => {
    const [, beta, gamma] = rowsOf(readerHtml(CUT_TOP_TABLE_SCREEN));
    const why = beta.fields[1][1];
    expect(why).toContain("stored at /tmp/d40/shot.pngcopyview, so agents");
    expect(why).toStartWith("A skill bundles reusable instructions and assets,");
    expect(why).toContain("needed. It fits a two-step flow where SKILL.md");
    expect(beta.fields[2][1]).toContain("the \"optional\" framing can lead to inconsistent, hit-or-miss adoption");
    expect(gamma.fields[2][1]).toContain('and calling it "future-proof" can hide over-engineering, which turns a simple task');
    expect(gamma.fields[1][1]).toContain("make long-term reasoning easier. A schema.ts file");
    expect(gamma.fields[1][1]).toContain("well-documented foundation for future multi-layer features");
  });

  test("a path split by the wrap is one path again, with its copy key and picture view key", () => {
    const html = readerHtml(CUT_TOP_TABLE_SCREEN);
    expect(html).toContain(`data-copy="/tmp/d40/shot.png"`);
    expect(html).toContain(`data-view="/tmp/d40/shot.png"`);
  });

  test("Atomic's code colour stays a code span in a cell; bold in the first cell is not doubled", () => {
    const html = readerHtml(TWO_TABLES_SCREEN);
    expect(html).toContain(`<strong class="stacked-title">Alpha</strong>`);
    expect(html).not.toContain(`<strong class="stacked-title"><span class="a-b">`);
    const code = readerHtml(
      [
        " ┌───────┬────────────┐",
        ` │ ${BOLD}Item${RESET}  │ ${BOLD}Notes${RESET}      │`,
        " ├───────┼────────────┤",
        ` │ ${BOLD}Alpha${RESET} │ see ${CYAN}a.md${RESET}   │`,
        " └───────┴────────────┘",
      ].join("\n"),
    );
    expect(code).toContain(`<dd>see <span class="a-code">a.md</span></dd>`);
  });

  test("the rest of the screen is as before: the agent's reply, the prompt echo band and Atomic's chrome", () => {
    const parts = readerParts(TWO_TABLES_SCREEN);
    expect(parts.filter((part) => part.startsWith(`<div class="stacked">`))).toHaveLength(2);
    expect(parts.some((part) => part.startsWith(`<div class="band band-tool">`))).toBe(true);
    expect(parts.filter((part) => part.includes("is-chrome")).length).toBeGreaterThanOrEqual(3);
  });

  const GRID = [
    " ┌──────┬──────┐",
    " │ Name │ Note │",
    " ├──────┼──────┤",
    " │ one  │ a b  │",
    " │      │ c    │",
    " └──────┴──────┘",
  ];

  test("the plain synthetic grid parses, wrapped lines joined with single spaces", () => {
    expect(rowsOf(readerHtml(GRID.join("\n")))).toEqual([{ title: "one", fields: [["Note", "a b c"]] }]);
  });

  // A drawn table, one line per entry of each row's cells.
  const drawn = (widths: number[], header: string[], ...rows: string[][][]) => {
    const rule = (left: string, mid: string, right: string) => ` ${left}${widths.map((w) => "─".repeat(w)).join(mid)}${right}`;
    const line = (cells: string[]) => ` │ ${cells.map((cell, i) => cell.padEnd(widths[i] - 2)).join(" │ ")} │`;
    return [rule("┌", "┬", "┐"), line(header), ...rows.flatMap((cells) => [rule("├", "┼", "┤"), ...Array.from({ length: Math.max(...cells.map((cell) => cell.length)) }, (_, n) => line(cells.map((cell) => cell[n] ?? "")))]), rule("└", "┴", "┘")];
  };

  test("a long path or address cut over several lines is one word again, whatever the length of its tails", () => {
    const grid = drawn([6, 12], ["N", "Link"], [["a"], ["https://ex", "ample.com/", "aaaa/b c"]]);
    expect(rowsOf(readerHtml(grid.join("\n")))).toEqual([{ title: "a", fields: [["Link", "https://example.com/aaaa/b c"]] }]);
    expect(readerHtml(grid.join("\n"))).toContain(`href="https://example.com/aaaa/b"`);
  });

  test("a short line, or a line of several words, is never a cut word, however short the next line", () => {
    const grid = drawn([6, 9], ["N", "Note"], [["a"], ["go", "to", "fits it", "a"]]);
    expect(rowsOf(readerHtml(grid.join("\n")))).toEqual([{ title: "a", fields: [["Note", "go to fits it a"]] }]);
  });

  test("a cut line whose tail is a short word plus punctuation (abc.),) is glued; a plain four-character tail is not", () => {
    const glued = drawn([12, 12], ["N", "Note"], [["a"], ["supercalif", "abc.), ef"]]);
    expect(rowsOf(readerHtml(glued.join("\n")))).toEqual([{ title: "a", fields: [["Note", "supercalifabc.), ef"]] }]);
    const spaced = drawn([12, 12], ["N", "Note"], [["a"], ["supercalif", "abcd ef"]]);
    expect(rowsOf(readerHtml(spaced.join("\n")))).toEqual([{ title: "a", fields: [["Note", "supercalif abcd ef"]] }]);
  });

  test("a row with text left of its first border is not a table", () => {
    const rows = GRID.map((row, i) => (i === 3 ? "x│ one  │ a b  │" : row));
    const html = readerHtml(rows.join("\n"));
    expect(html).not.toContain("stacked");
    expect(blocksOf(html)).toEqual([rows.map((row) => row.trimEnd()).join("\n")]);
  });

  test("a table drawn with rounded corners becomes stacked rows", () => {
    const rounded = GRID.map((row, i) => (i === 0 ? " ╭──────┬──────╮" : i === 5 ? " ╰──────┴──────╯" : row));
    expect(rowsOf(readerHtml(rounded.join("\n")))).toEqual([{ title: "one", fields: [["Note", "a b c"]] }]);
  });

  test("a ragged or inconsistent grid stays the mono block: a missing border, a shifted border, text past the edge, a corner mismatch", () => {
    const broken = [
      GRID.map((row, i) => (i === 3 ? " │ one  │ a b   " : row)),
      GRID.map((row, i) => (i === 3 ? " │ one   │ a b │" : row)),
      GRID.map((row, i) => (i === 4 ? " │      │ c    │ x" : row)),
      GRID.map((row, i) => (i === 5 ? " └──────┴─────┘" : row)),
      GRID.map((row, i) => (i === 2 ? " ├──────┼───────┤" : row)),
    ];
    for (const rows of broken) {
      const html = readerHtml(rows.join("\n"));
      expect(html).not.toContain("stacked");
      expect(blocksOf(html)).toEqual([rows.map((row) => row.trimEnd()).join("\n")]);
    }
  });

  test("a grid with no junction rule, one column, only a header, or a stray line inside is not a table", () => {
    const notTables = [
      [" │ a │ b │", " │ c │ d │"],
      [" ┌───────┐", " │ one   │", " ├───────┤", " │ two   │", " └───────┘"],
      [" ┌──────┬──────┐", " │ Name │ Note │", " └──────┴──────┘"],
      [" ┌──────┬──────┐", " │ Name │ Note │", " │ stray │", " ├──────┼──────┤", " │ one  │ two  │", " └──────┴──────┘"],
      [" ┌──────┬──────┐", " │ Name │ Note │", " ├──────┼──────┤", " ├──────┼──────┤", " │ one  │ two  │", " └──────┴──────┘"],
    ];
    for (const rows of notTables) expect(readerHtml(rows.join("\n"))).not.toContain("stacked");
  });

  test("two tables with no gap between them are one run that doesn't parse, so each stays as drawn", () => {
    const rows = [...GRID, ...GRID];
    const html = readerHtml(rows.join("\n"));
    expect(html).not.toContain("stacked");
    expect(blocksOf(html)).toEqual([rows.map((row) => row.trimEnd()).join("\n")]);
  });

  test("a top or bottom rule in the middle of a table, with rows on both sides, is not a table", () => {
    const [top, head, sep, one, bottom] = [GRID[0], GRID[1], GRID[2], GRID[3], GRID[5]];
    for (const rows of [
      [top, head, sep, one, bottom, one, bottom],
      [sep, one, top, head, sep, one, bottom],
    ]) {
      const html = readerHtml(rows.join("\n"));
      expect(html).not.toContain("stacked");
      expect(blocksOf(html)).toEqual([rows.map((row) => row.trimEnd()).join("\n")]);
    }
  });

  test("a table in a code fence, or in a shaded band, is left alone", () => {
    expect(readerHtml(["```", ...GRID, "```"].join("\n"))).not.toContain("stacked");
    expect(readerHtml(GRID.map((row) => `${ESC}[48;2;45;45;48m${row}${RESET}`).join("\n"))).not.toContain("stacked");
  });

  test("hostile cell text stays text", () => {
    const hostile = readerHtml(drawn([20, 30], ["<b>Name</b>", `"q" & <i>`], [["<script>x</script>"], ["<img src=x onerror=alert(1)>"]]).join("\n"));
    expect(hostile).not.toContain("<script");
    expect(hostile).not.toContain("<img");
    expect(hostile).not.toContain("<b>");
    expect(rowsOf(hostile)).toEqual([{ title: "<script>x</script>", fields: [['"q" & <i>', "<img src=x onerror=alert(1)>"]] }]);
    for (const [, attribute] of hostile.matchAll(/ ([a-z-]+)="/g)) expect(["class", "href", "target", "rel"]).toContain(attribute);
  });

  test("a table next to another box without a gap is one run that doesn't parse, so it stays as drawn", () => {
    const rows = [" ╭ NOTE ──────────╮", " │ a note         │", " ╰────────────────╯", ...GRID];
    const html = readerHtml(rows.join("\n"));
    expect(html).not.toContain("stacked");
    expect(blocksOf(html)).toEqual([rows.map((row) => row.trimEnd()).join("\n")]);
  });

  test("a table inside Atomic's chrome (below its usage line) stays dimmed and as drawn", () => {
    const chrome = [" Done.", "", "↑4 • ↓604 • W43k • CH0.0% • $0.355 (sub) • 4.3%/1.0M (auto)", "─".repeat(40), "❯", "─".repeat(40), "(anthropic) claude-opus-5-5 high • ~/x", "", ...GRID];
    const html = readerHtml(chrome.join("\n"));
    expect(html).not.toContain("stacked");
    expect(html).toContain(`<div class="block is-chrome">${GRID.map((row) => row.trimEnd()).join("\n")}</div>`);
  });
});

describe("the stylesheet for stacked rows", () => {
  const css = readFileSync(join(import.meta.dir, "../web/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/(?:^|\n)([^{}\n@][^{}]*)\{([^}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(",").map((each) => each.trim()),
    declarations: Object.fromEntries(body.split(";").map((line) => line.split(":").map((part) => part.trim())).filter((pair) => pair.length === 2)),
  }));
  const declarations = (selector: string): Record<string, string> => Object.assign({}, ...rules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.declarations));

  test("the title is 15px 650 ink, the label 13px 600 Legend Grey, and rows are divided by 1px Rule Grey rules", () => {
    expect(declarations(".stacked-title")["font-size"]).toBe("var(--text-m)");
    expect(declarations(".stacked-title")["font-weight"]).toBe("650");
    expect(declarations(".stacked-fields dt")["font-size"]).toBe("var(--text-s)");
    expect(declarations(".stacked-fields dt")["font-weight"]).toBe("600");
    expect(declarations(".stacked-fields dt").color).toBe("var(--ink-soft)");
    expect(declarations(".stacked-row")["border-top"]).toBe("1px solid var(--rule)");
    expect(declarations(".stacked-row:last-child")["border-bottom"]).toBe("1px solid var(--rule)");
    expect(declarations(".stacked-note").color).toBe("var(--ink-soft)");
    expect(declarations(".stacked-note")["font-size"]).toBe("var(--text-s)");
  });

  test("a stacked table never scrolls sideways and its text wraps inside the screen", () => {
    for (const selector of [".stacked", ".stacked-row", ".stacked-fields", ".stacked-fields dd"]) expect(["auto", "scroll"]).not.toContain(declarations(selector)["overflow-x"]);
    expect(declarations(".stacked-fields dd")["overflow-wrap"]).toBe("anywhere");
    expect(declarations(".stacked-fields dd")["min-width"]).toBe("0");
  });
});
