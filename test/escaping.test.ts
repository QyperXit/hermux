// HTML escaping: escapeHtml itself (web/html.js) with hostile inputs, and
// hostile server text pushed through the page's own renderers for the home
// and All rows, the switcher sheet, the Reader's links and copy keys, Earlier
// messages and the key bar. None of them may let a tag or an attribute through.
import { describe, expect, test } from "bun:test";
import { memoryStorage } from "../web/home.js";
import { escapeHtml } from "../web/html.js";
import { messageHtml } from "../web/history.js";
import { readerHtml } from "../web/reader.js";
import { allRowHtml, homeBodyHtml, rowHtml, shellRowHtml } from "../web/rows.js";
import { lineErrorHtml, sheetRowsHtml, switcherRows } from "../web/terminals.js";
import type { FakeElement } from "./support/fake-dom";
import { keyBarScreen } from "./support/key-bar";

// Markup, attribute breakers in both quote styles, entity-looking text and
// backticks.
const HOSTILE = [
  `<script>alert("x")</script>`,
  `"><img src=x onerror=alert(1)>`,
  `' onmouseover='alert(1)`,
  "`${alert(1)}`",
  "&lt;b&gt; &amp; &#39; &quot;",
  `</a></span><a href="javascript:alert(1)">`,
];

// No tag or attribute can come from the hostile text: after removing the
// renderer's own markup, no < > or " is left, and every & starts an entity.
const ownTags = /<\/?(a|span|small|svg|use|li|section|h2|div|p|button|label|textarea)\b(?:[^<>"]|"[^"<>]*")*>/g;
function expectInert(html: string) {
  const text = html.replace(ownTags, "");
  expect(text).not.toMatch(/[<>"]/);
  expect(text.replace(/&(amp|lt|gt|quot|#39);/g, "")).not.toContain("&");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript');
}

describe("escapeHtml", () => {
  test("turns every character that could start markup or end an attribute into an entity", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });

  test("escapes entity-looking text again, so it shows as written", () => {
    expect(escapeHtml("&lt;b&gt; &amp; &#39;")).toBe("&amp;lt;b&amp;gt; &amp;amp; &amp;#39;");
  });

  test("keeps backticks, ${} and other text as they are, and turns non-strings into text", () => {
    expect(escapeHtml("`${alert(1)}` é 🚀")).toBe("`${alert(1)}` é 🚀");
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(null)).toBe("null");
  });

  test("leaves nothing of a hostile string that could be a tag or an attribute", () => {
    for (const value of HOSTILE) {
      const html = escapeHtml(value);
      expect([value, /[<>"']/.test(html)]).toEqual([value, false]);
    }
  });
});

describe("the page's renderers with hostile server text", () => {
  const agent = (value: string) => ({
    pane_id: "w9:pD",
    agent: "atomic",
    agent_status: "working",
    cwd: `/home/you/${value}`,
    terminal_title_stripped: `atomic - ${value} - ${value}`,
    latest_line: value,
  });
  const shell = (value: string) => ({
    pane_id: "w9:p2",
    kind: "shell",
    status: null,
    workspace: { id: "w9", label: value },
    tab: { id: "w9:t2", label: value },
    cwd: `/home/${value}`,
    title: value,
    latest_line: value,
  });
  const failed = (value: string) => ({ ...shell(value), latest_line: null, latest_line_error: { code: "herdr_failed", message: value } });

  for (const value of HOSTILE) {
    test(`home, All and shell rows keep ${JSON.stringify(value)} as text`, () => {
      const row = agent(value);
      expectInert(rowHtml(row, { line: "" }));
      expectInert(allRowHtml(row));
      expectInert(allRowHtml({ ...row, latest_line: undefined, agent_status: "idle" }));
      expectInert(homeBodyHtml({ blocked: [{ ...row, agent_status: "blocked" }], finished: [{ ...row, agent_status: "done" }], activity: [{ agent: row, older: false }, { agent: { ...row, agent_status: "idle" }, older: true }], working: [row], olderCount: 1 }));
      expectInert(shellRowHtml(shell(value)));
      expectInert(shellRowHtml(failed(value)));
      expect(rowHtml(row, { line: "" })).toContain(escapeHtml(value));
    });

    test(`the switcher sheet and a row's line error keep ${JSON.stringify(value)} as text`, () => {
      const html = sheetRowsHtml(switcherRows([shell(value), failed(value), { ...agent(value), kind: "atomic", status: "working", workspace: { id: null, label: null }, tab: { id: "t", label: value }, title: null }], "w9:p2"), (paneId: string) => `#/agent/${encodeURIComponent(paneId)}`);
      expectInert(html);
      expectInert(lineErrorHtml(failed(value)));
      expect(lineErrorHtml(failed(value))).toContain(escapeHtml(value));
    });

    test(`Reader links, copy keys and Earlier messages keep ${JSON.stringify(value)} as text (D29)`, () => {
      const text = `See https://example.com/${value} and /tmp/${value} or ~/${value}.`;
      expectInert(readerHtml(` ${text}\n╭ BOX ─╮\n│ ${text} │\n╰──────╯`));
      expectInert(messageHtml({ seq: 1, role: "assistant", blocks: [{ kind: "text", text: `${text} [${value}](https://example.com/${value}) \`${text}\`` }] }));
      expectInert(messageHtml({ seq: 2, role: "user", blocks: [{ kind: "text", text }] }));
    });
  }

  // The key bar draws into a fake DOM that parses its markup, so hostile text
  // that escaped its escaping would come out as elements or attributes the
  // key bar never draws, or as a different label.
  test("the key bar keeps hostile key labels and saved commands as text, and sends the commands as written", () => {
    const shape = (root: FakeElement) => new Set([root, ...root.descendants()].map((element) => [element.localName, ...element.attributes.keys()].join(" ")));
    // What the key bar draws for ordinary labels and commands, through the same steps.
    const clean = keyBarScreen();
    clean.click(clean.button("Add a key"));
    clean.tap(clean.button("Edit Esc"));
    clean.click(clean.button("Edit saved commands"));
    const drawn = shape(clean.root);

    // A saved bar keeps labels of up to 12 characters; the picker adds a longer one.
    const labels = HOSTILE.map((value) => value.slice(0, 12));
    const bar = labels.map((label, index) => ({ key: `f${index + 1}`, label }));
    const storage = memoryStorage();
    storage.setItem("agents.keys", JSON.stringify(bar));
    storage.setItem("agents.commands", JSON.stringify(HOSTILE));
    const screen = keyBarScreen({ storage });
    expect(screen.names("Terminal keys").slice(6, -1)).toEqual(labels.map((label) => `Send ${label}`));
    expect(screen.names("Saved commands").slice(1)).toEqual(HOSTILE);
    for (const value of HOSTILE) screen.click(screen.button(value));
    expect(screen.sentTexts).toEqual(HOSTILE);

    screen.click(screen.button("Add a key"));
    screen.choose(screen.field("Key"), "f12");
    screen.tick(screen.field("Ctrl"), false);
    screen.type(screen.field("Label"), HOSTILE[1]);
    screen.click(screen.button("Add key"));
    screen.tap(screen.button(`Edit ${HOSTILE[1]}`));
    expect(screen.group(`Edit the ${HOSTILE[1]} key`).shown).toBe(true);
    screen.click(screen.button("Edit saved commands"));
    expect(HOSTILE.map((_, index) => screen.field(`Command ${index + 1}`).value)).toEqual(HOSTILE);

    expect([...shape(screen.root)].filter((element) => !drawn.has(element))).toEqual([]);
  });

  test("a hostile agent status stays inside its data-status attribute as text", () => {
    for (const value of HOSTILE) {
      const row = { ...agent("folder"), agent_status: value, latest_line: "a line" };
      expectInert(rowHtml(row, { line: "" }));
      expectInert(allRowHtml(row));
      expectInert(allRowHtml({ ...row, latest_line: undefined }));
      expectInert(homeBodyHtml({ blocked: [], finished: [], activity: [{ agent: row, older: false }], working: [], olderCount: 0 }));
      expect(rowHtml(row, { line: "" })).toContain(`data-status="${escapeHtml(value)}"`);
    }
  });

  test("herdr's real statuses reach data-status as they are", () => {
    for (const status of ["blocked", "working", "idle", "done", "unknown"]) {
      expect(rowHtml({ ...agent("folder"), agent_status: status }, { line: "" })).toContain(`data-status="${status}"`);
    }
  });
});
