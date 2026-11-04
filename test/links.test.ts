import { describe, expect, test } from "bun:test";
import { bindCopy } from "../web/links.js";
import { messageHtml } from "../web/history.js";
import { readerHtml, shellHtml } from "../web/reader.js";
import { asPageElement, fakePage } from "./support/fake-dom";

const sgr = (params: string) => `\x1b[${params}m`;
const CYAN = sgr("38;2;0;255;255");
const ORANGE = sgr("38;2;255;102;0");
const RESET = sgr("0");

const link = (url: string, text = url) => `<a class="a-link" href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const copyKey = (path: string) => `<button class="copy-key" type="button" data-copy="${path}" aria-label="Copy ${path}">copy</button>`;
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map(([, href]) => href);

describe("links in the Reader", () => {
  test("http and https addresses in prose are links that open in a new tab without an opener", () => {
    expect(readerHtml(" See https://example.com/docs and http://localhost:3000/app for it")).toBe(
      `<p class="p">See ${link("https://example.com/docs")} and ${link("http://localhost:3000/app")} for it</p>`,
    );
  });

  test("only http(s) is linked: javascript:, data:, ftp: and a bare host stay text", () => {
    const html = readerHtml(" javascript:alert(1) data:text/html,<b>x</b> ftp://example.com example.com https://");
    expect(html).not.toContain("<a ");
    expect(html).toContain("javascript:alert(1) data:text/html,&lt;b&gt;x&lt;/b&gt;");
  });

  test("punctuation after an address isn't part of it, but brackets it opens and closes are", () => {
    const text = [
      " Read https://example.com/a.",
      " Then https://example.com/b, https://example.com/c; https://example.com/d: https://example.com/e! https://example.com/f?",
      " (see https://example.com/g) and [https://example.com/h] and https://en.example.org/wiki/Foo_(bar).",
      " Quoted 'https://example.com/i' and \"https://example.com/j\" and <https://example.com/k>.",
      " Query https://example.com/l?x=1&y=2#top...",
    ].join("\n\n");
    expect(hrefs(readerHtml(text))).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
      "https://example.com/d",
      "https://example.com/e",
      "https://example.com/f",
      "https://example.com/g",
      "https://example.com/h",
      "https://en.example.org/wiki/Foo_(bar)",
      "https://example.com/i",
      "https://example.com/j",
      "https://example.com/k",
      "https://example.com/l?x=1&amp;y=2#top",
    ]);
  });

  test("an address is escaped in its href and its text, and can't break out of either", () => {
    const html = readerHtml(` Go https://example.com/?a=1&b='x'"><img src=x onerror=alert(1)> now`);
    expect(html).toContain(link("https://example.com/?a=1&amp;b="));
    expect(html).toContain("&#39;x&#39;&quot;&gt;&lt;img src=x onerror=alert(1)&gt; now");
    expect(html).not.toContain("<img");
  });

  test("an address in a code chip stays text, never a link; Atomic's orange link text is linked inside its own span", () => {
    expect(readerHtml(` Run ${CYAN}curl https://example.com/x${RESET} now`)).toBe(`<p class="p">Run <span class="a-code">curl https://example.com/x</span> now</p>`);
    expect(readerHtml(` Open ${ORANGE}https://example.com/pr/37${RESET}.`)).toBe(
      `<p class="p">Open <span class="a-link">${link("https://example.com/pr/37")}</span>.</p>`,
    );
  });

  test("addresses in a box-drawn block are links and the block's text is unchanged", () => {
    const panel = ["╭ LINKS ─────────────────────────────╮", "│ docs  https://example.com/docs     │", "╰────────────────────────────────────╯"].join("\n");
    const html = readerHtml(panel);
    expect(html).toBe(
      `<div class="block">╭ LINKS ─────────────────────────────╮\n│ docs  ${link("https://example.com/docs")}     │\n╰────────────────────────────────────╯</div>`,
    );
  });

  test("Atomic's chrome and a plain shell's output stay as printed", () => {
    const footer = ["", "─".repeat(40), "❯", "─".repeat(40), "(anthropic) claude-opus-5-5 high • ~/work/app (main)"].join("\n");
    const html = readerHtml(` Done.${footer}`);
    expect(html).toContain("• ~/work/app (main)</div>");
    expect(html).not.toContain("copy-key");
    expect(shellHtml("you@laptop:~/proj$ curl https://example.com/")).toBe(`<div class="line">you@laptop:~/proj$ curl https://example.com/</div>`);
  });
});

describe("laptop paths", () => {
  test("/tmp, /home and ~ paths get a copy key after them, not a link; punctuation after them is left out", () => {
    expect(readerHtml(" Wrote /tmp/out/report.txt, then ~/notes/today.md and /home/you/proj/a b.")).toBe(
      `<p class="p">Wrote /tmp/out/report.txt${copyKey("/tmp/out/report.txt")}, then ~/notes/today.md${copyKey("~/notes/today.md")} and /home/you/proj/a${copyKey("/home/you/proj/a")} b.</p>`,
    );
  });

  test("a path in a code chip keeps its chip and gets its key after it; a path inside an address is part of the link", () => {
    expect(readerHtml(` Edited ${CYAN}/home/you/proj/app.js${RESET} today`)).toBe(
      `<p class="p">Edited <span class="a-code">/home/you/proj/app.js</span>${copyKey("/home/you/proj/app.js")} today</p>`,
    );
    expect(readerHtml(" At https://example.com/home/you/x now")).toBe(`<p class="p">At ${link("https://example.com/home/you/x")} now</p>`);
    expect(readerHtml(" and/or ./tmp/x a/home/b")).not.toContain("copy");
  });

  test("a path is escaped in its key's attributes", () => {
    const html = readerHtml(` Saved /tmp/a&b"c<d>`);
    expect(html).toContain(`data-copy="/tmp/a&amp;b"`);
    expect(html).not.toContain("<d>");
  });

  test("in a box-drawn block a path is long-pressed to copy, so no key moves the columns", () => {
    const html = readerHtml(["╭ FILES ─────────────────╮", "│ /tmp/out/report.txt    │", "╰────────────────────────╯"].join("\n"));
    expect(html).toContain(`│ <span class="path" data-copy="/tmp/out/report.txt">/tmp/out/report.txt</span>    │`);
    expect(html).not.toContain("copy-key");
  });
});

describe("Earlier messages", () => {
  const agent = (text: string) => messageHtml({ seq: 1, role: "assistant", blocks: [{ kind: "text", text }] });

  test("an agent's addresses and markdown links to http(s) open in a new tab; other markdown links stay text", () => {
    const html = agent("See https://example.com/a. Also [the docs](https://example.com/docs) and [bad](javascript:alert(1)) and **https://example.com/b**");
    expect(html).toContain(`See ${link("https://example.com/a")}.`);
    expect(html).toContain(link("https://example.com/docs", "the docs"));
    expect(html).toContain(`<span class="a-link">bad</span>`);
    expect(html).not.toContain("javascript:");
    expect(html).toContain(`<span class="a-b">${link("https://example.com/b")}</span>`);
  });

  test("code spans never hold a link; paths in prose, code spans and tables are copyable", () => {
    const html = agent("Run `curl https://example.com/x` on `/tmp/a.txt` from ~/proj.\n\n| file |\n| /home/you/b.md |");
    expect(html).toContain(`<span class="a-code">curl https://example.com/x</span>`);
    expect(html).toContain(`<span class="a-code">/tmp/a.txt</span>${copyKey("/tmp/a.txt")}`);
    expect(html).toContain(`~/proj${copyKey("~/proj")}.`);
    expect(html).toContain(`<span class="path" data-copy="/home/you/b.md">/home/you/b.md</span>`);
    expect(hrefs(html)).toEqual([]);
  });

  test("the user's own messages and tool rows get links and copy keys too, escaped", () => {
    const user = messageHtml({ seq: 2, role: "user", blocks: [{ kind: "text", text: `look at https://example.com/?q="x"&y and /tmp/l&g` }] });
    expect(user).toContain(link("https://example.com/?q="));
    expect(user).toContain(`&quot;x&quot;&amp;y`);
    expect(user).toContain(copyKey("/tmp/l&amp;g"));
    const tool = messageHtml({ seq: 3, role: "assistant", blocks: [{ kind: "tool", name: "read", summary: "/home/you/proj/app.js" }] });
    expect(tool).toContain(`<span class="a-b">read</span> /home/you/proj/app.js${copyKey("/home/you/proj/app.js")}`);
  });
});

describe("copying a path", () => {
  const page = () => {
    const { root } = fakePage(`<div class="output"><p class="p">Wrote /tmp/a.txt${copyKey("/tmp/a.txt")}</p><div class="block"><span class="path" data-copy="/tmp/b.txt">/tmp/b.txt</span></div></div>`);
    const written: string[] = [];
    const said: { message: string; error: boolean }[] = [];
    let fail = false;
    bindCopy(asPageElement(root), {
      writeText: async (text) => {
        if (fail) throw new Error("denied");
        written.push(text);
      },
      announce: (message, { error = false } = {}) => said.push({ message, error }),
    });
    return { root, written, said, failNext: () => (fail = true) };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("tapping a copy key copies its path and says so", async () => {
    const { root, written, said } = page();
    root.querySelector(".copy-key")!.dispatch("click");
    await settle();
    expect(written).toEqual(["/tmp/a.txt"]);
    expect(said).toEqual([{ message: "Copied /tmp/a.txt", error: false }]);
  });

  test("a long-press on a path in a block copies it instead of opening the menu; elsewhere nothing is copied", async () => {
    const { root, written } = page();
    const menu = root.querySelector(".path")!.dispatch("contextmenu");
    expect(menu.defaultPrevented).toBe(true);
    const other = root.querySelector(".p")!.dispatch("contextmenu");
    expect(other.defaultPrevented).toBe(false);
    root.querySelector(".p")!.dispatch("click");
    await settle();
    expect(written).toEqual(["/tmp/b.txt"]);
  });

  test("when the clipboard refuses, the page says it couldn't copy", async () => {
    const { root, said, failNext } = page();
    failNext();
    root.querySelector(".copy-key")!.dispatch("click");
    await settle();
    expect(said).toEqual([{ message: "Couldn't copy /tmp/a.txt.", error: true }]);
  });
});
