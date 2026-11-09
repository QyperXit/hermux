import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readerHtml, readerParts, shellHtml } from "../web/reader.js";
import { ACTIVE_RUN, BACKGROUND, FINISHED_RUN, HINT, PICKER_FOOTER, PICKER_USAGE, SCROLL_HINT, WORKFLOW_PICKER_SCREEN } from "./support/workflow-picker";

const ESC = "\x1b";
const sgr = (params: string) => `${ESC}[${params}m`;
const CYAN = sgr("38;2;0;255;255");
const ORANGE = sgr("38;2;255;102;0");
const RESET = sgr("0");
const YOU = sgr("48;2;30;46;30");
const TOOL = sgr("48;2;45;45;48");

describe("colours, styles and escaping", () => {
  test("Atomic's palette maps to roles: cyan is code, orange is link, greys 240-245 are soft", () => {
    expect(readerHtml(`See ${CYAN}app.js${RESET} and ${ORANGE}PR #37${RESET}.`)).toBe(
      `<p class="p">See <span class="a-code">app.js</span> and <span class="a-link">PR #37</span>.</p>`,
    );
    for (const grey of [240, 242, 245]) {
      expect(readerHtml(`${sgr(`38;5;${grey}`)}Thinking level: medium${RESET}`)).toBe(`<p class="p"><span class="a-soft">Thinking level: medium</span></p>`);
    }
  });

  test("any other colour is ink, so Atomic's orange headings and greys outside 240-245 get no class", () => {
    for (const colour of ["38;2;255;170;0", "38;2;255;255;0", "38;5;8", "38;5;239", "38;5;246", "31", "91", "38;2;0;255;254"]) {
      expect(readerHtml(`${sgr(colour)}Next step${RESET}`)).toBe(`<p class="p">Next step</p>`);
    }
  });

  test("bold, italic, underline and inverse are kept, and each has its own reset", () => {
    expect(readerHtml(`${sgr("1")}b${sgr("3")}bi${sgr("22")}i${sgr("23")} ${sgr("4")}u${sgr("24")} ${sgr("7")}v${sgr("27")} x`)).toBe(
      `<p class="p"><span class="a-b">b</span><span class="a-b a-i">bi</span><span class="a-i">i</span> <span class="a-u">u</span> <span class="a-inv">v</span> x</p>`,
    );
    expect(readerHtml(`${sgr("1;3;38;2;0;255;255")}both${sgr("39")}plain${sgr("")}x`)).toBe(
      `<p class="p"><span class="a-b a-i a-code">both</span><span class="a-b a-i">plain</span>x</p>`,
    );
    expect(readerHtml(`${sgr("38:2::0:255:255")}colon form${RESET}`)).toBe(`<p class="p"><span class="a-code">colon form</span></p>`);
  });

  test("rows shaded 30,46,30 are a message band and 45,45,48 a mono tool band; a shade mid-row is not a band", () => {
    const text = [`${YOU} ${ORANGE}${YOU}npm test${RESET}${YOU}    ${RESET}`, `${TOOL} so ?   ${RESET}`, ` text ${TOOL} ↓ Jump ${RESET}`].join("\n");
    expect(readerHtml(text)).toBe(
      `<div class="band band-you"><p class="p"><span class="a-link">npm test</span></p></div>` +
        `<div class="band band-tool"><div class="line" style="padding-left:1ch">so ?</div></div>` +
        `<p class="p">text  ↓ Jump</p>`,
    );
  });

  test("control characters other than tab and newline never reach the page", () => {
    expect(readerHtml("bell\x07 and\x01 del\x7f gone\ttab kept")).toBe(`<p class="p">bell and del gone\ttab kept</p>`);
  });

  test("text with <, &, quotes and escape fragments renders as text, never markup", () => {
    const text = [
      `${CYAN}<script>alert("x")</script>${RESET} & 'q' "dq" &amp;`,
      `${ESC}]8;;https://evil.example/" onmouseover="x${ESC}\\link${ESC}]8;;${ESC}\\ <img src=x onerror=alert(1)>`,
      `${ESC}[38;2;0;255;255"><b>m broken${ESC}[ ${ESC} lone ${ESC}(B ${ESC}[2K${ESC}[?25l cursor`,
      `[38;2;0;255;255m already lost ESC ${ESC}`,
    ].join("\n");
    const html = readerHtml(text);
    expect(html).not.toContain(ESC);
    expect(html).not.toMatch(/<(?!\/?(?:p|span|div|hr)\b)/);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain(`<span class="a-code">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</span> &amp; &#39;q&#39; &quot;dq&quot; &amp;amp;`);
    expect(html).toContain("link &lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("[38;2;0;255;255m already lost ESC");
    for (const [, attribute] of html.matchAll(/ ([a-z-]+)="/g)) expect(["class", "style"]).toContain(attribute);
    for (const [, style] of html.matchAll(/style="([^"]*)"/g)) expect(style).toMatch(/^(?:padding|margin)-left:\d+ch$/);
  });
});

describe("paragraphs, lists, blocks and the screen's own marks", () => {
  test("plain text (the server's fallback) renders as ink paragraphs with no classes", () => {
    expect(readerHtml(" Hello <world> & you.\n\n - one")).toBe(`<p class="p">Hello &lt;world&gt; &amp; you.</p><div class="gap"></div><p class="p li">- one</p>`);
  });

  test("Atomic's wraps join into one paragraph by the latest-line rule; short lines and sentence ends don't", () => {
    const wrapped = " The backend checks the pass is real by comparing Google's signature against";
    expect(readerHtml(`${wrapped}\n Google's keys. It's a stamp.\n Short line\n next line.`)).toBe(
      `<p class="p">${wrapped.trim().replace(/'/g, "&#39;")} Google&#39;s keys. It&#39;s a stamp.</p><p class="p">Short line</p><p class="p">next line.</p>`,
    );
  });

  test("numbered and bulleted items get the hanging-indent class, and their wrapped lines join", () => {
    const html = readerHtml(
      [
        ` ${CYAN}1. ${RESET}${sgr("1")}Why sign-ins were refused${RESET} in the last 3 hours, as a reason code and a count. My`,
        "    tests will be in there.",
        ` ${CYAN}- ${RESET}Anything else means a different cause.`,
        "   - a nested item",
      ].join("\n"),
    );
    expect(html).toBe(
      `<p class="p li"><span class="a-code">1. </span><span class="a-b">Why sign-ins were refused</span> in the last 3 hours, as a reason code and a count. My tests will be in there.</p>` +
        `<p class="p li"><span class="a-code">- </span>Anything else means a different cause.</p>` +
        `<p class="p li" style="margin-left:2ch">- a nested item</p>`,
    );
  });

  test("tables and boxes are one unwrapped block, fenced code stays mono and unjoined; rules become 1px rules", () => {
    const long = "x".repeat(70);
    const html = readerHtml(
      [
        " ┌──────┬─────┐",
        ` │ Model ${long} │`,
        " └──────┴─────┘",
        " ```bash",
        `   gcloud run jobs execute ${long}`,
        " --project=p --wait",
        " ```",
        "────────────────────",
        " After.",
      ].join("\n"),
    );
    expect(html).toBe(
      `<div class="block"> ┌──────┬─────┐\n │ Model ${long} │\n └──────┴─────┘</div>` +
        `<div class="line" style="padding-left:1ch">\`\`\`bash</div>` +
        `<div class="line" style="padding-left:3ch">gcloud run jobs execute ${long}</div>` +
        `<div class="line" style="padding-left:1ch">--project=p --wait</div>` +
        `<div class="line" style="padding-left:1ch">\`\`\`</div>` +
        `<hr class="output-rule">` +
        `<p class="p">After.</p>`,
    );
  });

  test("Atomic's usage line, prompt box and footer stay dimmed mono, without colours", () => {
    const rule = `${CYAN}${"─".repeat(40)}${RESET}`;
    const html = readerHtml(
      [" Done.", `${sgr("38;5;240")}↑72M • ↓2.8M • 43.1%/1.0M (auto)${RESET}`, rule, `❯ ${sgr("7")} ${RESET}`, rule, `${sgr("38;5;240")}(anthropic) model • ~/x${RESET}`].join("\n"),
    );
    expect(html).toBe(
      `<p class="p">Done.</p><div class="line is-chrome">↑72M • ↓2.8M • 43.1%/1.0M (auto)</div>` +
        `<hr class="output-rule is-chrome"><div class="line is-chrome">❯</div><hr class="output-rule is-chrome">` +
        `<div class="line is-chrome">(anthropic) model • ~/x</div>`,
    );
  });

  test("blank runs collapse to one gap and a mono line's indent is capped at 12ch; a box keeps its own", () => {
    expect(readerHtml(" a.\n\n\n\n b.\n ```\n" + " ".repeat(30) + "deep\n ```\n" + " ".repeat(30) + "│ deep │")).toBe(
      `<p class="p">a.</p><div class="gap"></div><p class="p">b.</p>` +
        `<div class="line" style="padding-left:1ch">\`\`\`</div><div class="line" style="padding-left:12ch">deep</div><div class="line" style="padding-left:1ch">\`\`\`</div>` +
        `<div class="block">${" ".repeat(30)}│ deep │</div>`,
    );
  });

  test("Atomic's transcript scrollbar column is dropped, so wrapped lines still join", () => {
    const pad = (text: string, end: string) => `${text.padEnd(80)}${sgr("38;5;8")}${end}${RESET}`;
    const html = readerHtml(
      [pad(" It is one setup by Matt, then automatic forever. For today, the command", "│"), pad(" fixes it.", "┃"), pad("", "│"), pad(" Next.", "│")].join("\n"),
    );
    expect(html).toBe(`<p class="p">It is one setup by Matt, then automatic forever. For today, the command fixes it.</p><div class="gap"></div><p class="p">Next.</p>`);
  });

  test("Atomic's jump hint is dropped, drawn over the end of a row or alone on a row, where it leaves a gap, not a paragraph", () => {
    expect(readerHtml(` ### What I checked           ${TOOL} ↓ Jump to latest message · ctrl+end ${RESET}     \n Next.`)).toBe(`<p class="p">### What I checked</p><p class="p">Next.</p>`);
    expect(readerHtml(" Done.\n↓ Jump to latest message · ctrl+end\n Next.")).toBe(`<p class="p">Done.</p><div class="gap"></div><p class="p">Next.</p>`);
  });

});

const USAGE = "↑72M • ↓2.8M • R2408M • W7.8M • CH99.4% • $1027.186 (sub) • 36.3%/1.0M (auto)";
const RULE40 = "─".repeat(40);
const FOOTER = "(anthropic) claude-opus-5-5 medium • ~/work/app (main)";
const PANEL = ["╭ BACKGROUND  1 run  ● 1 running ─────────╮", "│   ●  958abe02-f7b9-4e7b-a2d6-867a19b47275  │", "│     goal · chain · 8/9 · 55m 58s          │", "╰──────────────────────────────────────────╯"];
const prose = [" The run is on track. The build landed.", "", " - 4f3969e: the shaded backgrounds now apply only to messages.", "", " Next step is review."];
const chromeCount = (html: string) => html.split("is-chrome").length - 1;

// A box-drawn region keeps its terminal layout in one mono block.
const unescape = (html: string) => html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const textOf = (html: string) => unescape(html.replace(/<[^>]+>/g, ""));
const blocks = (html: string) => [...html.matchAll(/<div class="block[^"]*">([\s\S]*?)<\/div>/g)].map(([, inner]) => textOf(inner));
const strip = (text: string) => text.replace(/\x1b\[[\d;:]*m/g, "");

// The shape of a real Atomic pane showing its full-screen workflow graph.
const GRAPH = [
  " ╭──────────────╮",
  " │ ORCHESTRATOR │  goal                                                                 ✓ 1  ● 1",
  " ╰──────────────╯",
  "",
  "                                   ╭─── orchestrator-1 ───╮",
  "                                   │       24m 33s        │",
  "                                   │      ● running       │",
  "                                   ╰──────────────────────╯",
  "                                               │",
  "                                               │",
  "                                               │",
  "                                   ╭────── worker-1 ──────╮",
  "                                   │      ● running       │",
  "                                   ╰──────────────────────╯",
  "",
  "",
  " ╭───────╮",
  " │ GRAPH │      ctrl+x return to main chat  ·  ↵ open tool detail  ·  ↑↓←→ navigate  ·  / stages",
  " ╰───────╯",
];

describe("Atomic's workflow graph", () => {
  test("Atomic's workflow graph screen is one block with every line, blank and connector rows as drawn", () => {
    const html = readerHtml([...GRAPH, "", ""].join("\n"));
    expect(blocks(html)).toEqual([GRAPH.join("\n")]);
    expect(html).toMatch(/^<div class="block">[\s\S]*<\/div>$/);
    expect(chromeCount(html)).toBe(0);
  });

  // Real shape (w9:pD, 2026-10-29): Atomic pins the GRAPH pill to the bottom of
  // the screen, so a small graph has 40 blank rows above it. That filler is
  // screen space, not layout, so a blank run keeps at most 3 rows.
  test("the screen filler between a small workflow graph and its pill shrinks to 3 blank rows", () => {
    const [top, pill] = [GRAPH.slice(0, 14), GRAPH.slice(16)];
    const html = readerHtml([...top, ...Array(40).fill(" ".repeat(98)), ...pill].join("\n"));
    expect(blocks(html)).toEqual([[...top, "", "", "", ...pill].join("\n")]);
  });
});

// From a real pane (w9:pD, 2026-10-29), with the pane's colours.
const HEARTBEAT = [
  `╭ ${sgr("1")}WORKFLOW HEARTBEAT${RESET} ${"─".repeat(76)}╮`,
  `│ ♥ Workflow "plan-sleep-charts" is still running${" ".repeat(47)}│`,
  `│ workflow  ${CYAN}plan-sleep-charts${RESET}${" ".repeat(68)}│`,
  `│ ▸ /workflow status 7366bce5-3e9f-42d2-a3b5-90af23a4aa2f${" ".repeat(40)}│`,
  `╰${"─".repeat(96)}╯`,
];

describe("panels and tables", () => {
  test("a ╭╮╰╯ panel is one block between Reader paragraphs, keeping its colours and every space", () => {
    const before = " Next I will make the filters shared across all the chart pages, so everything uses the";
    const html = readerHtml([before, " same filter system.", "", ...HEARTBEAT, "", " The run is still going."].join("\n"));
    expect(blocks(html)).toEqual([HEARTBEAT.map(strip).join("\n")]);
    expect(html).toStartWith(`<p class="p">Next I will make the filters shared across all the chart pages, so everything uses the same filter system.</p><div class="gap"></div><div class="block">`);
    expect(html).toEndWith(`</div><div class="gap"></div><p class="p">The run is still going.</p>`);
    expect(html).toContain(`<span class="a-b">WORKFLOW HEARTBEAT</span>`);
    expect(html).toContain(`<span class="a-code">plan-sleep-charts</span>`);
    expect(html).toContain(`│ ♥ Workflow &quot;plan-sleep-charts&quot; is still running${" ".repeat(47)}│`);
  });

  test("a ┌┐└┘ panel and a ├┼┤ table are each one block; padding after the right edge is dropped", () => {
    const panel = [" ┌ NOTE ──────────┐", " │ <b>raw</b> & x │", " └────────────────┘"];
    const table = [
      " ┌───────────────────────────┬───────────────┐",
      " │ Model (effort)            │ FrontierCode¹ │",
      " ├───────────────────────────┼───────────────┤",
      " │ Claude Opus 5.5 (medium)  │ 54.6          │",
      " └───────────────────────────┴───────────────┘",
    ];
    const html = readerHtml([" Benchmark results:", "", ...panel.map((row) => `${row}      `), "", ...table.map((row) => `${row}${" ".repeat(20)}`), " ¹ How often the code is merged."].join("\n"));
    expect(blocks(html)).toEqual([panel.join("\n"), table.join("\n")]);
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt; &amp; x");
    expect(html).not.toContain("<b>");
    expect(html).toStartWith(`<p class="p">Benchmark results:</p>`);
    expect(html).toEndWith(`</div><p class="p">¹ How often the code is merged.</p>`);
  });

  test("a Markdown table is one block too", () => {
    const table = [" | Model | Score |", " |-------|-------|", " | Opus  | 54.6  |"];
    expect(blocks(readerHtml(table.join("\n")))).toEqual([table.join("\n")]);
  });

  test("Atomic's BACKGROUND panel under the usage line is one dimmed block in the chrome", () => {
    const html = readerHtml([...prose, "", USAGE, RULE40, "❯", RULE40, FOOTER, "", ...PANEL, " ↑↓ scroll · Alt+k/Alt+j"].join("\n"));
    expect(html).toContain(`<div class="block is-chrome">${PANEL.join("\n")}</div>`);
  });
});

// Atomic's question dialogs (ask-user-question: wrapping-select.js and
// multi-select-view.js). The row under the cursor is drawn in the theme's accent
// (orange 255,102,0 in the default theme) and bold, from the "❯ " pointer to the end
// of the label; a multi-select row is "<pointer><n>. [✔] <label>" with the
// pointer and a ticked box in accent and "[ ]" muted. Descriptions are muted
// and indented under the label.
const BOLD = sgr("1");
const MUTED = sgr("38;5;244");
const selectedRow = (text: string) => ` ${ORANGE}${BOLD}${text}${sgr("22")}${sgr("39")}`;
const optionRow = (text: string) => `   ${text}`;
const describeRow = (text: string) => `      ${MUTED}${text}${RESET}`;

const SINGLE_DIALOG = [
  `${ORANGE}${"─".repeat(40)}${RESET}`,
  "",
  "  Release track ",
  "",
  " Where should I upload the bundle?",
  "",
  selectedRow("❯ 1. Internal testing (Recommended)"),
  describeRow("Only your test group gets it."),
  optionRow("2. Closed testing"),
  describeRow("Your beta list of about 40 people."),
  optionRow("3. Production"),
  optionRow("4. Type something."),
  "",
  " enter select · ↑/↓ navigate · esc cancel",
  `${ORANGE}${"─".repeat(40)}${RESET}`,
].join("\n");

const MULTI_DIALOG = [
  " Which platforms should the build cover?",
  "",
  ` ${ORANGE}❯ ${RESET}1. ${ORANGE}[✔]${RESET} ${ORANGE}${BOLD}Android${RESET}`,
  `   2. ${ORANGE}[✔]${RESET} Web`,
  `   3. ${MUTED}[ ]${RESET} iOS`,
  describeRow("Needs a Mac runner."),
  `   4. ${MUTED}[ ]${RESET} Windows`,
  "   Next",
  "",
  " enter select · ↑/↓ navigate · tab switch questions · esc cancel · space toggle",
].join("\n");

const optionRowsOf = (html: string) => [...html.matchAll(/<div class="(opt[^"]*)">(.*?)<\/div>/g)].map(([, cls, inner]) => ({ cls, inner }));
const visibleText = (html: string) => html.replace(/<span class="visually-hidden">.*?<\/span>/g, "").replace(/<[^>]+>/g, "");

describe("question dialogs", () => {
  test("the dialog's selected option is a selection row, not an orange-bold link; the others are plain option rows", () => {
    const html = readerHtml(SINGLE_DIALOG);
    const rows = optionRowsOf(html);
    expect(rows.map((row) => row.cls)).toEqual(["opt is-selected", "opt", "opt", "opt"]);
    expect(visibleText(rows[0].inner)).toBe("1.Internal testing (Recommended)");
    expect(visibleText(rows[1].inner)).toBe("2.Closed testing");
    expect(rows[0].inner).not.toContain("a-link");
    expect(html).not.toContain("a-link");
    expect(html).not.toContain("❯");
    expect(html).toContain(`<p class="p">Where should I upload the bundle?</p>`);
    expect(html).toContain("Only your test group gets it.");
  });

  test("in a multi-select, ticked and unticked boxes are different, and the bar sits on the row under the cursor", () => {
    const html = readerHtml(MULTI_DIALOG);
    const rows = optionRowsOf(html);
    expect(rows.map((row) => row.cls)).toEqual(["opt is-selected is-ticked", "opt is-ticked", "opt is-unticked", "opt is-unticked", "opt"]);
    expect(rows.map((row) => visibleText(row.inner))).toEqual(["1.Android", "2.Web", "3.iOS", "4.Windows", "Next"]);
    expect(rows[0].inner).toContain(`<span class="opt-box"><span class="visually-hidden">ticked</span></span>`);
    expect(rows[2].inner).toContain(`<span class="opt-box"><span class="visually-hidden">not ticked</span></span>`);
    expect(html).not.toContain("[✔]");
    expect(html).not.toContain("[ ]");
    expect(html).not.toContain("a-link");
    expect(html).toContain("Needs a Mac runner.");
  });

  test("a numbered list or a lone ❯ line in the agent's own prose is not a dialog", () => {
    const prose = [" Steps:", "   1. Build it", "   2. Ship it", "", " Then I ran it.", selectedRow("❯ 3. a lone cursor row"), " Done."].join("\n");
    const html = readerHtml(prose);
    expect(html).not.toContain('class="opt');
    expect(html).toContain("❯ 3. a lone cursor row");
    expect(readerHtml(["   1. Build it", "   2. Ship it", "   3. Test it"].join("\n"))).not.toContain('class="opt');
  });

  test("option text is escaped, and a wrapped selected label stays in its bar", () => {
    const html = readerHtml(
      [
        selectedRow(`❯ 1. Use <b onclick="x()">&</b> and a label that`),
        `      ${ORANGE}${BOLD}goes on to a second line${RESET}`,
        optionRow("2. Other <i>"),
      ].join("\n"),
    );
    expect(html).not.toContain("<b ");
    expect(html).not.toContain("<i>");
    expect(html).toContain("Use &lt;b onclick=&quot;x()&quot;&gt;&amp;&lt;/b&gt; and a label that goes on to a second line");
    expect(optionRowsOf(html).map((row) => row.cls)).toEqual(["opt is-selected", "opt"]);
    expect(html).not.toContain("a-link");
  });

  test("an answered option that Atomic marks with ✔ reads as a ticked row without the bar", () => {
    const html = readerHtml([selectedRow("❯ 1. Internal testing"), optionRow(`2. ${ORANGE}${BOLD}Closed testing ✔${RESET}`), optionRow("3. Production")].join("\n"));
    const rows = optionRowsOf(html);
    expect(rows.map((row) => row.cls)).toEqual(["opt is-selected", "opt is-ticked", "opt"]);
    expect(visibleText(rows[1].inner)).toBe("2.Closed testing");
    expect(html).not.toContain("✔");
  });

  test("with the cursor on Next, the bar is on Next and no option row is selected", () => {
    const html = readerHtml(
      [`   1. ${ORANGE}[✔]${RESET} Android`, `   2. ${MUTED}[ ]${RESET} iOS`, ` ${ORANGE}${BOLD}❯ Next${RESET}`].join("\n"),
    );
    const rows = optionRowsOf(html);
    expect(rows.map((row) => row.cls)).toEqual(["opt is-ticked", "opt is-unticked", "opt is-selected"]);
    expect(visibleText(rows[2].inner)).toBe("Next");
    expect(html).not.toContain("a-link");
  });
});

// Atomic's `/workflow connect` picker as herdr's `--format ansi` read shows it,
// escape for escape as captured from a real pane, with generic run ids
// and names and the inner width cut to 60. Each run is an id row and a name
// row; the run under the cursor is one bold run on the accent shade.
const PICKER_INNER = 60;
const P = { reset: sgr("0"), border: sgr("38;2;108;112;134"), panel: sgr("48;2;30;30;46") };
const cell = (fg: string, text: string) => `${P.reset}${sgr(fg)}${P.panel}${text}${P.reset}${P.panel}`;
const pickerRow = (content: string) => `${P.reset}${P.border}│${P.reset}${content}${P.reset}${P.border}│${P.reset}\r`;
const pad = (text: string) => text + " ".repeat(PICKER_INNER - text.length);
const pickerRun = (id: string, name: string, elapsed: string, selected: boolean) => {
  const right = `${elapsed.padStart(8)}   ${"0/0 stages".padStart(10)} `;
  const gap = " ".repeat(PICKER_INNER - 3 - name.length - right.length);
  if (selected) {
    const bar = `${sgr("1")}${sgr("38;2;49;50;68")}${sgr("48;2;137;180;250")}`;
    return [pickerRow(`${bar}${pad(` ● ${id}`)}`), pickerRow(`${bar}${pad(`   ${name}${gap}${right}`)}`)];
  }
  return [
    pickerRow(`${P.panel} ${cell("38;2;249;226;175", "●")} ${cell("38;2;127;132;156", id)}${" ".repeat(PICKER_INNER - 3 - id.length)}`),
    pickerRow(`${P.panel}   ${cell("38;2;205;214;244", name)}${gap}${cell("38;2;166;173;200", elapsed.padStart(8))}   ${cell("38;2;127;132;156", "0/0 stages".padStart(10))} `),
  ];
};
const blankPickerRow = pickerRow(`${P.panel}${" ".repeat(PICKER_INNER)}`);
const sectionRow = (label: string) =>
  pickerRow(`${P.panel} ${cell("38;2;203;166;247", " ")} ${P.reset}${sgr("1")}${sgr("38;2;166;173;200")}${P.panel}${label}${P.reset}${P.panel}${" ".repeat(PICKER_INNER - 3 - label.length)}`);
const PICKER_TOP = `${P.reset}${P.border}╭──${P.reset}${sgr("38;2;137;180;250")} Connect to workflow run ${P.reset}${P.border}${"─".repeat(PICKER_INNER - 27)}╮${P.reset}\r`;
const PICKER_FILTER = pickerRow(
  `${P.panel} ${cell("38;2;203;166;247", " ")} ${cell("38;2;166;173;200", "filter")}  ${cell("38;2;166;173;200", "(type to filter by name or id)")}${" ".repeat(PICKER_INNER - 41)}`,
);
const PICKER_BOTTOM = `${P.reset}${P.border}╰${"─".repeat(PICKER_INNER)}╯${P.reset}\r`;
const PICKER_HINT = `  ${P.reset}${sgr("38;2;205;214;244")}up/down${P.reset} ${P.reset}${sgr("38;2;166;173;200")}Navigate${P.reset}${sgr("38;2;127;132;156")} · ${P.reset}${sgr("38;2;205;214;244")}enter${P.reset} ${P.reset}${sgr("38;2;166;173;200")}Connect${P.reset}\r`;
const RUN_A = "11111111-2222-3333-4444-555555555555";
const RUN_B = "66666666-7777-8888-9999-000000000000";
// The picker with run `selected` (0 or 1, -1 for none) under the cursor, and a TERMINAL group when `finished` is set.
const picker = (selected: number, finished = false) =>
  [
    " Both runs are going.",
    "",
    PICKER_TOP,
    blankPickerRow,
    PICKER_FILTER,
    blankPickerRow,
    sectionRow("ACTIVE"),
    ...pickerRun(RUN_A, "docs-build", "14s", selected === 0),
    ...(finished ? [sectionRow("TERMINAL")] : []),
    ...pickerRun(RUN_B, "nightly-review", "19s", selected === 1),
    blankPickerRow,
    PICKER_BOTTOM,
    PICKER_HINT,
  ].join("\n");

describe("Atomic's /workflow connect picker", () => {
  test("the picker's selected run gets the question dialog's selection bar and the other run is a plain row", () => {
    for (const selected of [0, 1]) {
      const html = readerHtml(picker(selected));
      const rows = optionRowsOf(html);
      expect(rows.map((row) => row.cls)).toEqual(selected === 0 ? ["opt is-selected", "opt"] : ["opt", "opt is-selected"]);
      expect(rows.map((row) => visibleText(row.inner).replace(/\s+/g, " "))).toEqual([`● ${RUN_A} docs-build 14s 0/0 stages`, `● ${RUN_B} nightly-review 19s 0/0 stages`]);
      expect(rows[selected].inner).toContain(`<span class="opt-mark"><span class="visually-hidden">selected</span></span>`);
      expect(blocks(html).join("\n")).not.toContain(RUN_A);
      expect(blocks(html).join("\n")).not.toContain(RUN_B);
      expect(rows[selected].inner).not.toContain("a-b");
      expect(html).not.toContain("a-link");
      expect(blocks(html)[0]).toContain("Connect to workflow run");
      expect(blocks(html)[0]).toContain("ACTIVE");
      expect(blocks(html).at(-1)).toContain("╰");
      expect(html).toContain(`<p class="p">Both runs are going.</p>`);
    }
  });

  test("a TERMINAL heading between the groups stays a heading, not part of the run above it", () => {
    const html = readerHtml(picker(1, true));
    const rows = optionRowsOf(html);
    expect(rows.map((row) => row.cls)).toEqual(["opt", "opt is-selected"]);
    expect(visibleText(rows[0].inner)).not.toContain("TERMINAL");
    expect(blocks(html).join("\n")).toContain("TERMINAL");
  });

  test("a picker with no run under the cursor, and Atomic's BACKGROUND panel of runs, are left as drawn", () => {
    const none = readerHtml(picker(-1));
    expect(none).not.toContain('class="opt');
    expect(blocks(none).join("\n")).toContain(RUN_A);
    const panel = ["╭ BACKGROUND  1 run  ● 1 running ──────────────╮", `│   ●  ${RUN_A} │`, `│     ${sgr("1")}docs-build${RESET} · single · 14s       │`, "╰───────────────────────────────────────────────╯"].join("\n");
    expect(readerHtml(panel)).not.toContain('class="opt');
  });

  test("picker text is escaped", () => {
    const html = readerHtml(picker(0).replace("docs-build", `<b x="1">&`).replace("nightly-review", "<i>"));
    expect(html).not.toContain("<b ");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;b x=&quot;1&quot;&gt;&amp;");
    expect(html).toContain("&lt;i&gt;");
  });
});

// The Reader's stylesheet, read because the fake DOM has no layout.
const css = readFileSync(join(import.meta.dir, "../web/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const cssRules = [...css.matchAll(/(?:^|\n)([^{}\n@][^{}]*)\{([^}]*)\}/g)].map(([, selectors, body]) => ({
  selectors: selectors.split(",").map((each) => each.trim()),
  declarations: Object.fromEntries(body.split(";").map((line) => line.split(":").map((part) => part.trim())).filter((pair) => pair.length === 2)),
}));
const declarations = (selector: string): Record<string, string> =>
  Object.assign({}, ...cssRules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.declarations));

describe("Atomic's workflow picker in the prompt box's place", () => {
  const parts = readerParts(WORKFLOW_PICKER_SCREEN);
  const at = (text: string) => parts.findIndex((part) => textOf(part).includes(text));

  test("its hint line is a line of its own, and the usage line, footer, BACKGROUND panel and scroll hint are dimmed chrome, never prose", () => {
    expect(parts[at("Navigate")]).toBe(`<div class="line is-chrome" style="padding-left:2ch">${HINT.trim()}</div>`);
    expect(parts[at("claude-opus")]).toBe(`<div class="line is-chrome">${PICKER_FOOTER}</div>`);
    expect(parts[at("4.4%/1.0M")]).toBe(`<div class="line is-chrome" style="padding-left:12ch">${PICKER_USAGE}</div>`);
    expect(parts[at("BACKGROUND")]).toBe(`<div class="block is-chrome">${BACKGROUND.join("\n")}</div>`);
    expect(parts[at("Alt+k")]).toBe(`<div class="line is-chrome" style="padding-left:1ch">${SCROLL_HINT.trim()}</div>`);
    expect(parts.slice(at("Navigate")).join("")).not.toContain("copy-key");
  });

  test("the picker itself is not dimmed: its run under the cursor is the Selection Bar and the other run a plain row", () => {
    const html = parts.join("");
    expect(optionRowsOf(html).map((row) => [row.cls, visibleText(row.inner).replace(/\s+/g, " ")])).toEqual([
      ["opt is-selected", `● ${ACTIVE_RUN} lint-run 13s`],
      ["opt", `✓ ${FINISHED_RUN} docs-site 1s`],
    ]);
    expect(html).toContain(`<span class="opt-mark"><span class="visually-hidden">selected</span></span>`);
    const picker = parts.slice(at("Connect to workflow run"), at("Navigate")).join("");
    expect(picker).not.toContain("is-chrome");
    expect(picker).not.toContain("a-link");
  });

  test("the box's left edge runs unbroken from its title row to its bottom edge, past the Selection Bar and the plain run row", () => {
    const box = parts.slice(at("Connect to workflow run"), at("Navigate"));
    expect(box.map((part) => (part.startsWith(`<div class="block">`) ? "block" : part.match(/^<div class="(opt[^"]*)">/)?.[1]))).toEqual(["block", "opt is-selected", "block", "opt", "block"]);
    for (const part of box) {
      if (part.startsWith(`<div class="block">`)) for (const line of blocks(part)[0].split("\n")) expect(line).toMatch(/^[╭│╰]/);
      else expect(part).toMatch(/^<div class="opt[^"]*"><span class="opt-edge"><\/span>/);
    }
    expect(blocks(box[0])[0]).toStartWith("╭── Connect to workflow run");
    expect(blocks(box.at(-1) ?? "")[0].split("\n").at(-1)).toStartWith("╰");
  });

  test("a question dialog's options are not in a box and draw no edge", () => {
    expect(readerHtml(SINGLE_DIALOG)).not.toContain("opt-edge");
  });

  test("the edge is drawn in the row's own ink at the block's first column, so it shows on the ink Selection Bar", () => {
    expect(declarations(".opt-edge::before")["border-left"]).toBe("1px solid var(--opt-ink)");
    const font = (selector: string) => [declarations(selector)["font-family"], declarations(selector)["font-size"]];
    expect(font(".opt-edge")).toEqual(font(".block"));
    expect(declarations(".opt.is-selected")["--opt-ink"]).toBe("var(--key-dark-ink)");
  });
});

describe("sideways-scrolling rows", () => {
  test("box-drawn blocks and every other row that scrolls sideways still scroll but draw no scrollbar, as the key row does", () => {
    const sideways = cssRules.filter((rule) => ["auto", "scroll"].includes(rule.declarations["overflow-x"])).flatMap((rule) => rule.selectors);
    expect(sideways).toContain(".block");
    expect(sideways).toContain(".keys");
    for (const selector of sideways) {
      expect([selector, declarations(selector)["scrollbar-width"]]).toEqual([selector, "none"]);
      expect([selector, declarations(`${selector}::-webkit-scrollbar`).display]).toEqual([selector, "none"]);
    }
  });
});

describe("plain shells", () => {
  test("a shell's rows stay one mono row each: nothing is joined, boxed or dimmed, and colours and escaping are kept", () => {
    const text = [
      "you@laptop:~/proj$ ls -l",
      "-rw-r--r-- 1 you you 1204 Oct 30 09:12 a-long-file-name-that-is-over-sixty-characters.txt",
      "-rw-r--r-- 1 you you   88 Oct 30 09:12 b.txt",
      "",
      "",
      "",
      "\x1b[38;2;0;255;255mcyan\x1b[0m \x1b[38;2;255;102;0morange\x1b[0m <b>&</b>",
      "",
    ].join("\n");
    const html = shellHtml(text);
    expect(html.match(/class="line/g)?.length).toBe(4);
    expect(html).toContain("b.txt</div><div class=\"gap\">");
    expect(html.match(/class="gap"/g)).toHaveLength(1);
    expect(html.endsWith("</div>")).toBe(true);
    expect(html).toContain('class="a-code"');
    expect(html).not.toContain("255,102,0");
    expect(html).not.toContain("style=\"color");
    expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});
