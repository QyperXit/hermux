import { describe, expect, test } from "bun:test";
import { drawLive } from "../web/live-render.js";
import { readerHtml, readerParts, shellParts } from "../web/reader.js";
import { asPageElement, fakePage, type FakeElement } from "./support/fake-dom";

// An agent screen: three status lines that scroll up by one each refresh, a
// panel whose timer ticks, and a closing line.
const screen = (n: number, panel = true) =>
  [
    ...[0, 1, 2].map((i) => ` Step ${n + i} done.`),
    "",
    ...(panel ? ["╭ PROGRESS ─────────────────────────────────────────────────────────────╮", `│ worker-1   ● running   ${n}m 0${n}s   a long row that scrolls sideways │`, "╰───────────────────────────────────────────────────────────────────────╯"] : []),
    "",
    ` Latest note ${n}.`,
  ].join("\n");

function livePage() {
  const { root } = fakePage(`<div class="output"><div class="live"></div></div>`);
  const live = root.querySelector(".live") as FakeElement;
  return { live, draw: (parts: string[]) => drawLive(asPageElement(live), parts) };
}

const blocksOf = (live: FakeElement) => live.querySelectorAll(".block");
const paragraph = (live: FakeElement, text: string) => live.querySelectorAll(".p").find((p) => p.textContent === text);

describe("drawing the Live screen in place", () => {
  test("a sideways-scrolled block keeps its element and scroll position through 3 refreshes that change it", () => {
    const { live, draw } = livePage();
    draw(readerParts(screen(0)));
    const [block] = blocksOf(live);
    block.scrollLeft = 140;
    block.scrollTop = 12;
    for (const n of [1, 2, 3]) {
      draw(readerParts(screen(n)));
      expect(blocksOf(live)).toEqual([block]);
      expect(block.scrollLeft).toBe(140);
      expect(block.scrollTop).toBe(12);
      expect(block.textContent).toContain(`${n}m 0${n}s`);
      // What the page shows is exactly what the Reader drew.
      expect(live.childNodes.length).toBe(readerParts(screen(n)).length);
      expect(live.children.map((child) => child.textContent)).toEqual(fakePage(readerHtml(screen(n))).root.children.map((child) => child.textContent));
    }
  });

  test("redrawn whole with innerHTML instead, the block would snap back to the start", () => {
    const { live } = livePage();
    live.innerHTML = readerHtml(screen(0));
    blocksOf(live)[0].scrollLeft = 140;
    live.innerHTML = readerHtml(screen(1));
    expect(blocksOf(live)[0].scrollLeft).toBe(0);
  });

  test("elements whose HTML didn't change are kept, not drawn again, even when the screen scrolled up", () => {
    const { live, draw } = livePage();
    draw(readerParts(screen(0)));
    const before = live.children;
    draw(readerParts(screen(0)));
    expect(live.children).toEqual(before);
    expect(live.children.every((child, index) => child === before[index])).toBe(true);
    const step2 = paragraph(live, "Step 2 done.");
    draw(readerParts(screen(1)));
    expect(paragraph(live, "Step 2 done.")).toBe(step2);
    expect(paragraph(live, "Step 0 done.")).toBeUndefined();
    expect(paragraph(live, "Step 3 done.")).toBeDefined();
  });

  test("each block keeps its own position by its kind and order, and a block that goes away takes its position with it", () => {
    const { live, draw } = livePage();
    const twoPanels = (n: number) => `${screen(n)}\n\n${screen(n + 10)}`;
    draw(readerParts(twoPanels(0)));
    const [first, second] = blocksOf(live);
    first.scrollLeft = 30;
    second.scrollLeft = 90;
    draw(readerParts(twoPanels(1)));
    expect(blocksOf(live)).toEqual([first, second]);
    expect([first.scrollLeft, second.scrollLeft]).toEqual([30, 90]);
    // The panel is closed, then opened again: the new one starts at the left.
    draw(readerParts(screen(2, false)));
    expect(blocksOf(live)).toEqual([]);
    draw(readerParts(screen(3)));
    expect(blocksOf(live)[0].scrollLeft).toBe(0);
  });

  test("after something else was drawn there (an error, 'Reading output…'), the next screen is drawn whole and right", () => {
    const { live, draw } = livePage();
    draw(readerParts(screen(0)));
    live.innerHTML = `<p class="output-empty">Couldn't read this agent's output.</p>`;
    draw(readerParts(screen(1)));
    expect(live.querySelector(".output-empty")).toBeNull();
    expect(live.children.map((child) => child.textContent)).toEqual(fakePage(readerHtml(screen(1))).root.children.map((child) => child.textContent));
    const [block] = blocksOf(live);
    block.scrollLeft = 50;
    draw(readerParts(screen(2)));
    expect(blocksOf(live)[0].scrollLeft).toBe(50);
  });

  test("an error with its Back link, then 'Reading output…', then a screen: each is drawn in place of the one before", () => {
    const { live, draw } = livePage();
    draw(readerParts(screen(0)));
    draw([`<p class="output-empty">Couldn't read this agent's output.</p>`, `<a class="link-key" href="#/">Back to agents</a>`]);
    expect(live.children.map((child) => child.textContent)).toEqual(["Couldn't read this agent's output.", "Back to agents"]);
    draw([`<p class="output-empty">Reading output…</p>`]);
    expect(live.children.map((child) => child.textContent)).toEqual(["Reading output…"]);
    draw(readerParts(screen(1)));
    expect(live.querySelector(".output-empty")).toBeNull();
    expect(live.children.map((child) => child.textContent)).toEqual(fakePage(readerHtml(screen(1))).root.children.map((child) => child.textContent));
  });

  test("a shell's rows are kept the same way", () => {
    const { live, draw } = livePage();
    draw(shellParts("$ ls\na.txt\nb.txt"));
    const first = live.children[0];
    draw(shellParts("$ ls\na.txt\nb.txt\n$ pwd"));
    expect(live.children[0]).toBe(first);
    expect(live.children.map((child) => child.textContent)).toEqual(["$ ls", "a.txt", "b.txt", "$ pwd"]);
  });
});

describe("a table in the Live screen", () => {
  const table = (note: string) => [" ┌──────┬──────┐", " │ Name │ Note │", " ├──────┼──────┤", ` │ one  │ ${note.padEnd(4)} │`, " └──────┴──────┘"];
  const withTable = (n: number, note: string) => [screen(n), "", ...table(note)].join("\n");
  const tableOf = (live: FakeElement) => live.querySelectorAll(".stacked");

  test("a refresh that changes the table redraws only the table: the panel block keeps its element and scroll position", () => {
    const { live, draw } = livePage();
    draw(readerParts(withTable(0, "a")));
    const [block] = blocksOf(live);
    block.scrollLeft = 140;
    draw(readerParts(withTable(1, "b")));
    expect(blocksOf(live)).toEqual([block]);
    expect(block.scrollLeft).toBe(140);
    expect(tableOf(live)).toHaveLength(1);
    expect(tableOf(live)[0].textContent).toContain("b");
    expect(live.childNodes.length).toBe(readerParts(withTable(1, "b")).length);
  });

  test("a table that is unchanged keeps its element", () => {
    const { live, draw } = livePage();
    draw(readerParts(withTable(0, "a")));
    const [stacked] = tableOf(live);
    draw(readerParts(withTable(0, "a")));
    expect(tableOf(live)).toEqual([stacked]);
  });
});
