import { describe, expect, test } from "bun:test";
import { historyHtml, historyNote, markdownHtml } from "../web/history.js";

describe("history in the Reader", () => {
  test("the user's messages sit on the you band, tool calls on the tool band one line each, the agent's markdown as Reader prose", () => {
    const html = historyHtml([
      { seq: 1, role: "user", blocks: [{ kind: "text", text: "first line\nsecond line" }] },
      { seq: 2, role: "assistant", blocks: [{ kind: "text", text: "Done. See `web/app.js`." }, { kind: "tool", name: "bash", summary: "git status" }, { kind: "tool", name: "read", summary: "a.ts" }] },
    ]);
    expect(html).toBe(
      `<div class="h-msg" data-seq="1"><div class="band band-you"><p class="p">first line</p><p class="p">second line</p></div></div>` +
        `<div class="h-msg" data-seq="2"><p class="p">Done. See <span class="a-code">web/app.js</span>.</p>` +
        `<div class="band band-tool"><div class="line"><span class="a-b">bash</span> git status</div><div class="line"><span class="a-b">read</span> a.ts</div></div></div>`,
    );
  });

  test("markdown: soft wraps join, lists hang, code blocks and tables stay mono, headings are bold", () => {
    expect(markdownHtml("## Plan\nOne line\nwraps here.\n\n- **a** item\n2. two\n\n```ts\nconst x = 1;\n```\n| a | b |\n|---|---|")).toBe(
      `<p class="p"><span class="a-b">Plan</span></p><p class="p">One line wraps here.</p><div class="gap"></div>` +
        `<p class="p li">• <span class="a-b">a</span> item</p><p class="p li">2. two</p><div class="gap"></div>` +
        `<div class="block">const x = 1;</div><div class="block">| a | b |\n|---|---|</div>`,
    );
  });
});

describe("the note above the earlier messages", () => {
  test("the note says unavailable, not none, when earlier messages are already shown", () => {
    expect(historyNote({ status: "none", reason: "no_match", count: 0, cap: 300 })).toBe("No earlier messages: this pane's Atomic session wasn't found.");
    expect(historyNote({ status: "none", reason: "no_match", count: 30, cap: 300 })).toBe("Earlier messages unavailable: this pane's Atomic session wasn't found.");
    expect(historyNote({ status: "none", reason: "unavailable", count: 0, cap: 300 })).toBe("No earlier messages: the laptop can't read Atomic's sessions.");
  });
});
