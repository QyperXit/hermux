import { expect, test } from "bun:test";
import { nextStop } from "../web/dialog.js";
import { SHEET_EXIT_MS, createSheet, sheetFits } from "../web/sheet.js";
import { FakeDocument, FakeElement, asPageElement } from "./support/fake-dom";

const pane = (pane_id: string) => ({ pane_id, kind: "shell", status: null });

type Workspace = Parameters<ReturnType<typeof createSheet>["open"]>[0];
const hermux = { id: "wF", label: "hermux" };
const WORKSPACE = {
  ...hermux,
  terminals: ["wF:p1", "wF:p2", "wF:p3"].map((pane_id, index) => ({
    pane_id,
    kind: "shell",
    status: null,
    workspace: hermux,
    tab: { id: `${pane_id}-tab`, label: `term ${index + 1}`, number: index + 1 },
    cwd: "/home/you/projects/hermux",
    title: "you@laptop:~/hermux$",
  })),
} satisfies Workspace;

// The sheet uses the browser's own document and window, so `run` gets a fake
// page that stands in for them, with no layout and no slide, until it returns.
function withPage(run: (made: ReturnType<typeof sheetPage>) => void) {
  const made = sheetPage();
  const browser: Record<string, unknown> = {
    document: {
      addEventListener: made.doc.root.addEventListener.bind(made.doc.root),
      removeEventListener: made.doc.root.removeEventListener.bind(made.doc.root),
      get activeElement() {
        return made.doc.activeElement;
      },
    },
    window: { matchMedia: () => ({ matches: true }) },
    requestAnimationFrame: (frame: () => void) => void made.frames.push(frame),
    HTMLElement: FakeElement,
    Element: FakeElement,
  };
  const real = Object.keys(browser).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  Object.assign(globalThis, browser);
  Object.assign(FakeElement.prototype, { getBoundingClientRect: () => ({ bottom: 0 }) });
  try {
    run(made);
  } finally {
    Reflect.deleteProperty(FakeElement.prototype, "getBoundingClientRect");
    for (const [name, descriptor] of real) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

function sheetPage() {
  const doc = new FakeDocument("body");
  doc.root.innerHTML = `<main id="app"><button class="terminals-key" type="button" aria-expanded="false"></button></main><div id="switcher-root" class="switcher-layer" hidden></div>`;
  const find = (selector: string) => doc.root.querySelector(selector) as FakeElement;
  const swaps: string[] = [];
  const sheet = createSheet({ app: asPageElement(find("#app")), root: asPageElement(find("#switcher-root")), hrefOf: (paneId) => `#/terminal/${paneId}`, onSwap: (paneId) => void swaps.push(paneId) });
  return {
    doc,
    find,
    sheet,
    swaps,
    frames: [] as (() => void)[],
    layer: find("#switcher-root"),
    key: find(".terminals-key"),
    rows: () => doc.root.querySelectorAll(".pane-row"),
    press: (key: string, shiftKey = false) => (doc.activeElement ?? doc.root).dispatch("keydown", { key, shiftKey }),
    inert: () => (find("#app") as unknown as { inert?: boolean }).inert === true,
  };
}

test("the sheet stays open only while the workspace has another pane and still holds the open one", () => {
  const two = [pane("wF:p1"), pane("wF:p2")];
  expect(sheetFits(two, "wF:p1")).toBe(true);
  expect(sheetFits(two, "wF:p2")).toBe(true);
  expect(sheetFits(two, "wF:p9")).toBe(false);
  expect(sheetFits([pane("wF:p1")], "wF:p1")).toBe(false);
  expect(sheetFits([], "wF:p1")).toBe(false);
});

test("Tab goes round the rows forwards and Shift+Tab backwards; with no focused row Tab starts at the first and Shift+Tab at the last", () => {
  expect([0, 1, 2].map((at) => nextStop(at, 3, false))).toEqual([1, 2, 0]);
  expect([0, 1, 2].map((at) => nextStop(at, 3, true))).toEqual([2, 0, 1]);
  expect(nextStop(-1, 3, false)).toBe(0);
  expect(nextStop(-1, 3, true)).toBe(2);
  expect(nextStop(0, 1, false)).toBe(0);
  expect(nextStop(0, 1, true)).toBe(0);
});

test("making the sheet touches no page until it is opened; without a pane to switch to it does not open, and closing or drawing it does nothing", () => {
  const sheet = createSheet({ app: null, root: null, hrefOf: String, onSwap: () => {} });
  expect(Object.keys(sheet).sort()).toEqual(["close", "open", "render"]);
  sheet.open(null, undefined);
  sheet.close();
  sheet.render(null, undefined);
});

test("opening without its page or its layer says which is missing", () => {
  const { find } = sheetPage();
  expect(() => createSheet({ app: null, root: null, hrefOf: String, onSwap: () => {} }).open(WORKSPACE, "wF:p2")).toThrow("The switcher has no page.");
  expect(() => createSheet({ app: asPageElement(find("#app")), root: null, hrefOf: String, onSwap: () => {} }).open(WORKSPACE, "wF:p2")).toThrow("The switcher has no switcher root.");
});

test("opening it shows a modal dialog named by the workspace over an inert page, with the focus on the open pane's row", () => {
  withPage(({ sheet, find, layer, key, rows, inert, frames, doc }) => {
    key.focus();
    sheet.open(WORKSPACE, "wF:p2");
    const dialog = find('[role="dialog"]');
    expect([layer.hidden, dialog.getAttribute("aria-modal"), find(`#${dialog.getAttribute("aria-labelledby")}`).textContent]).toEqual([false, "true", "hermux · 3 terminals"]);
    expect([inert(), key.getAttribute("aria-expanded")]).toEqual([true, "true"]);
    expect(rows().map((row) => [row.getAttribute("data-pane"), row.getAttribute("aria-current")])).toEqual([
      ["wF:p1", null],
      ["wF:p2", "true"],
      ["wF:p3", null],
    ]);
    expect(doc.activeElement).toBe(rows()[1]);
    expect(layer.classList.contains("is-open")).toBe(false);
    frames.forEach((frame) => frame());
    expect(layer.classList.contains("is-open")).toBe(true);
  });
});

test("Tab goes round the sheet's rows and Shift+Tab back, never leaving it; from nowhere Tab starts at the first row and Shift+Tab at the last", () => {
  withPage(({ sheet, rows, press, doc, find }) => {
    sheet.open(WORKSPACE, "wF:p2");
    const [first, second, third] = rows();
    expect(doc.activeElement).toBe(second);
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(third);
    press("Tab");
    expect(doc.activeElement).toBe(first);
    expect(press("Tab", true).defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(third);
    press("Tab", true);
    expect(doc.activeElement).toBe(second);
    const focused = () => doc.activeElement;
    const fromNowhere = (shiftKey: boolean) => {
      doc.activeElement = null;
      press("Tab", shiftKey);
      return focused();
    };
    expect([fromNowhere(false), fromNowhere(true)]).toEqual([first, third]);
    expect(press("a").defaultPrevented).toBe(false);
    find(".switcher-list").innerHTML = "";
    doc.activeElement = null;
    expect(press("Tab").defaultPrevented).toBe(false);
  });
});

test("Esc closes the sheet, says it handled the key and gives the focus back to the terminals key; the keys are the page's again", () => {
  withPage(({ sheet, layer, key, press, inert, doc, swaps }) => {
    key.focus();
    sheet.open(WORKSPACE, "wF:p2");
    expect(press("Escape").defaultPrevented).toBe(true);
    expect([layer.hidden, layer.children.length, inert(), key.getAttribute("aria-expanded")]).toEqual([true, 0, false, "false"]);
    expect(doc.activeElement).toBe(key);
    expect([press("Escape").defaultPrevented, press("Tab").defaultPrevented]).toEqual([false, false]);
    expect(swaps).toEqual([]);
  });
});

test("the sheet is taken off the page only once its slide-out transition has finished", async () => {
  const css = await Bun.file(new URL("../web/app.css", import.meta.url)).text();
  const rule = css.match(/\n\.switcher \{[^}]*\}/)?.[0] ?? "";
  const slideMs = Number(rule.match(/transition: transform (\d+)ms/)?.[1]);
  expect(slideMs).toBeGreaterThan(0);
  expect(SHEET_EXIT_MS).toBeGreaterThanOrEqual(slideMs);
});
