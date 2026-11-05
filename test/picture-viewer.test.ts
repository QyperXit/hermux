import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bindCopy, bindView, picturePaths } from "../web/links.js";
import { MAX_ZOOM, clampView, createPictureViewer, swipeStep, zoomAt } from "../web/picture-viewer.js";
import { readerHtml } from "../web/reader.js";
import { FakeDocument, FakeEvent, asPageElement, type FakeElement } from "./support/fake-dom";

const A = "/home/you/sketches/left.png";
const B = "/tmp/shots/middle.jpg";
const C = "~/right.webp";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

class Load {
  settle!: (answer: Blob | Error) => void;
  promise: Promise<Blob>;
  constructor(readonly path: string, readonly signal: AbortSignal | undefined) {
    this.promise = new Promise((resolve, reject) => {
      this.settle = (answer) => (answer instanceof Error ? reject(answer) : resolve(answer));
    });
  }
}

class FakeWindow {
  listeners: (() => void)[] = [];
  addEventListener(_type: "popstate", listener: () => void) {
    this.listeners.push(listener);
  }
  removeEventListener(_type: "popstate", listener: () => void) {
    this.listeners = this.listeners.filter((other) => other !== listener);
  }
  pop() {
    for (const listener of [...this.listeners]) listener();
  }
}

function screen(text = ` See ${A} and ${B}, then ${C} and ${A} again; and /tmp/notes.txt.`) {
  const doc = new FakeDocument("body");
  doc.root.innerHTML = `<main id="app" class="app"><div class="output" tabindex="0"><div class="live">${readerHtml(text)}</div></div></main><div id="picture-root" class="picture-layer" hidden></div>`;
  const find = (selector: string) => doc.root.querySelector(selector) as FakeElement;
  const all = (selector: string) => doc.root.querySelectorAll(selector);
  const loads: Load[] = [];
  const previews = { created: [] as string[], revoked: [] as string[] };
  const entries: unknown[] = [null];
  const history = {
    backs: 0,
    get state() {
      return entries[entries.length - 1];
    },
    pushState(state: unknown) {
      entries.push(state);
    },
    back() {
      this.backs++;
      this.userBack();
    },
    userBack() {
      entries.pop();
      win.pop();
    },
  };
  const win = new FakeWindow();
  const copied: string[] = [];
  let copyFails = false;
  const viewer = createPictureViewer({
    page: asPageElement(find("#app")),
    root: asPageElement(find("#picture-root")),
    client: {
      readPicture: (path: string, options?: { signal?: AbortSignal }) => {
        const load = new Load(path, options?.signal);
        loads.push(load);
        return load.promise;
      },
    },
    previews: {
      create: (blob) => {
        const url = `blob:picture-${previews.created.length + 1}-${blob.size}`;
        previews.created.push(url);
        return url;
      },
      revoke: (url) => void previews.revoked.push(url),
    },
    browser: { history, events: win, keys: asPageElement(doc.root) },
    copy: async (text) => {
      if (copyFails) throw new Error("denied");
      copied.push(text);
    },
  });
  bindView(asPageElement(find(".output")), viewer.open);
  const img = () => find(".picture-img");
  const transform = () => (img() as unknown as { style: { transform: string } }).style.transform;
  const press = (key: string, shiftKey = false) => (doc.activeElement ?? doc.root).dispatch("keydown", { key, shiftKey });
  const inert = () => (find("#app") as unknown as { inert?: boolean }).inert === true;
  const count = () => find(".picture-count").textContent;
  const arrive = async (width = 412, height = 915, bytes = 188_416) => {
    loads[loads.length - 1].settle(new Blob([new Uint8Array(bytes)]));
    await settle();
    Object.assign(img(), { naturalWidth: width, naturalHeight: height });
    img().dispatch("load");
  };
  const pointer = (type: string, pointerId: number, clientX: number, clientY: number) => {
    const event = Object.assign(new FakeEvent(type, { pointerId }), { clientX, clientY });
    find(".picture-stage").dispatchEvent(event);
  };
  const stageBox = () =>
    Object.assign(find(".picture-stage"), { getBoundingClientRect: () => ({ left: 0, top: 64, width: 412, height: 722, right: 412, bottom: 786 }) });
  return {
    doc,
    find,
    all,
    loads,
    previews,
    history,
    win,
    copied,
    failCopy: () => (copyFails = true),
    viewer,
    img,
    transform,
    press,
    inert,
    count,
    arrive,
    pointer,
    stageBox,
    layer: () => find("#picture-root"),
    key: (path: string) => all(".view-key").find((key) => key.getAttribute("data-view") === path)!,
  };
}

describe("the pictures on the open screen", () => {
  test("are the distinct picture paths in the order they first appear, Earlier messages before the Live screen", () => {
    const doc = new FakeDocument();
    doc.root.innerHTML = `<div class="history">${readerHtml(` ${B} and ${A}`)}</div><div class="live">${readerHtml(` ${A} ${C} ${B} /tmp/x.txt`)}</div>`;
    expect(picturePaths(asPageElement(doc.root))).toEqual([B, A, C]);
  });
});

describe("opening", () => {
  test("a view key opens a full-screen modal dialog named by the file, the page behind goes inert, and focus moves to the close key", () => {
    const { key, layer, find, inert, doc, count, loads, history } = screen();
    key(B).dispatch("click");
    expect(layer().hidden).toBe(false);
    const dialog = find('[role="dialog"]');
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(find(`#${dialog.getAttribute("aria-labelledby")}`).textContent).toBe("middle.jpg");
    expect(count()).toBe("2 of 3");
    expect(inert()).toBe(true);
    expect(doc.activeElement).toBe(find(".picture-close"));
    expect(find(".picture-close").getAttribute("aria-label")).toBe("Close picture");
    expect(find(".picture-close").querySelector("use")?.getAttribute("href")).toBe("#i-close");
    expect(loads.map((load) => load.path)).toEqual([B]);
    expect(history.state).toEqual({ picture: true });
  });

  test("once the picture arrives it shows fitted, with its size in the count", async () => {
    const { key, img, arrive, count, previews, find } = screen();
    key(A).dispatch("click");
    expect(img().hidden).toBe(true);
    expect(find(".picture-note").textContent).toBe("Opening…");
    await arrive(412, 915, 188_416);
    expect(img().getAttribute("src")).toBe(previews.created[0]);
    expect(img().getAttribute("alt")).toBe("left.png");
    expect(img().hidden).toBe(false);
    expect(find(".picture-note").hidden).toBe(true);
    expect(count()).toBe("1 of 3 · 412 × 915 · 184 KB");
  });

  test("a tap on a picture path in a box-drawn block opens it too, and Enter on it from the keyboard", () => {
    const text = ["╭──────────────────────╮", `│ ${B}    │`, "╰──────────────────────╯"].join("\n");
    const first = screen(text);
    first.find(".path[data-view]").dispatch("click");
    expect(first.count()).toBe("1 of 1");
    const second = screen(text);
    const event = second.find(".path[data-view]").dispatch("keydown", { key: "Enter" });
    expect(event.defaultPrevented).toBe(true);
    expect(second.count()).toBe("1 of 1");
  });

  test("a second tap while it is open does nothing", () => {
    const { key, loads, viewer } = screen();
    key(A).dispatch("click");
    viewer.open(asPageElement(key(B)), [B]);
    expect(loads).toHaveLength(1);
  });
});

describe("a long-press on a box-drawn picture path", () => {
  const boxed = () => {
    const page = screen(["╭──────────────────────╮", `│ ${B}    │`, "╰──────────────────────╯"].join("\n"));
    const written: string[] = [];
    bindCopy(asPageElement(page.find(".output")), { writeText: async (text) => void written.push(text), announce: () => {} });
    const at = (type: string, timeStamp: number) => {
      const event = Object.assign(new FakeEvent(type), { timeStamp });
      page.find(".path[data-view]").dispatchEvent(event);
      return event;
    };
    return { ...page, written, at };
  };

  test("copies the path, and the click the press may end with doesn't open the viewer", () => {
    const { at, written, loads } = boxed();
    expect(at("contextmenu", 1000).defaultPrevented).toBe(true);
    at("click", 1700);
    expect(written).toEqual([B]);
    expect(loads).toHaveLength(0);
  });

  test("a plain tap still opens it", () => {
    const { at, written, loads, count } = boxed();
    at("click", 1000);
    expect(loads).toHaveLength(1);
    expect(count()).toBe("1 of 1");
    expect(written).toEqual([]);
  });

  test("a new tap soon after a long-press opens it", () => {
    const { at, loads } = boxed();
    at("contextmenu", 1000);
    at("pointerdown", 1300);
    at("click", 1350);
    expect(loads).toHaveLength(1);
  });

  test("a tap well after a long-press opens it", () => {
    const { at, loads } = boxed();
    at("contextmenu", 1000);
    at("click", 4000);
    expect(loads).toHaveLength(1);
  });
});

describe("moving between pictures", () => {
  test("next and previous keys go through the screen's pictures in order and stop at the ends", async () => {
    const { key, find, count, loads } = screen();
    key(A).dispatch("click");
    expect([find(".picture-prev").disabled, find(".picture-next").disabled]).toEqual([true, false]);
    find(".picture-next").dispatch("click");
    expect(count()).toBe("2 of 3");
    find(".picture-next").dispatch("click");
    expect(count()).toBe("3 of 3");
    expect([find(".picture-prev").disabled, find(".picture-next").disabled]).toEqual([false, true]);
    find(".picture-next").dispatch("click");
    expect(count()).toBe("3 of 3");
    find(".picture-prev").dispatch("click");
    expect(count()).toBe("2 of 3");
    expect(loads.map((load) => load.path)).toEqual([A, B, C, B]);
    expect(find(".picture-name").textContent).toBe("middle.jpg");
  });

  test("the arrow keys do the same", () => {
    const { key, press, count } = screen();
    key(B).dispatch("click");
    press("ArrowRight");
    expect(count()).toBe("3 of 3");
    press("ArrowLeft");
    press("ArrowLeft");
    press("ArrowLeft");
    expect(count()).toBe("1 of 3");
  });

  test("with one picture there are no next and previous keys", () => {
    const { key, find } = screen(` Only ${A} here`);
    key(A).dispatch("click");
    expect([find(".picture-prev").hidden, find(".picture-next").hidden]).toEqual([true, true]);
  });

  test("a sideways swipe goes to the next or previous picture; a short or upright one doesn't", () => {
    const { key, pointer, count } = screen();
    key(B).dispatch("click");
    pointer("pointerdown", 1, 300, 400);
    pointer("pointermove", 1, 200, 410);
    pointer("pointerup", 1, 200, 410);
    expect(count()).toBe("3 of 3");
    pointer("pointerdown", 1, 100, 400);
    pointer("pointerup", 1, 250, 400);
    expect(count()).toBe("2 of 3");
    pointer("pointerdown", 1, 100, 400);
    pointer("pointerup", 1, 130, 400);
    pointer("pointerdown", 1, 100, 300);
    pointer("pointerup", 1, 160, 500);
    expect(count()).toBe("2 of 3");
  });

  test("moving on drops the old picture's address and stops its load; a late answer for it is ignored", async () => {
    const { key, find, loads, previews, arrive, img } = screen();
    key(A).dispatch("click");
    await arrive();
    find(".picture-next").dispatch("click");
    expect(previews.revoked).toEqual([previews.created[0]]);
    find(".picture-next").dispatch("click");
    expect(loads[1].signal?.aborted).toBe(true);
    loads[1].settle(new Blob(["late"]));
    await settle();
    expect(previews.created).toHaveLength(1);
    expect(img().hasAttribute("src")).toBe(false);
  });

  test("the list is the one the screen had when it opened, whatever the Reader redraws after", () => {
    const { key, find, count } = screen();
    key(A).dispatch("click");
    find(".live").innerHTML = readerHtml(" nothing now");
    find(".picture-next").dispatch("click");
    expect(count()).toBe("2 of 3");
  });
});

describe("zooming", () => {
  test("zooming keeps the point under the fingers still, and the picture can't be panned off the screen or zoomed out past fitted", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: -50 })).toEqual({ scale: 2, x: -100, y: 50 });
    const stage = { width: 400, height: 800 };
    const content = { width: 400, height: 600 };
    expect(clampView({ scale: 2, x: -1000, y: 1000 }, stage, content)).toEqual({ scale: 2, x: -200, y: 200 });
    expect(clampView({ scale: 9, x: 0, y: 0 }, stage, content).scale).toBe(MAX_ZOOM);
    expect(clampView({ scale: 0.5, x: 30, y: 30 }, stage, content)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(clampView({ scale: 1.2, x: 0, y: 100 }, stage, content)).toEqual({ scale: 1.2, x: 0, y: 0 });
  });

  test("a swipe counts only when it is long enough and more sideways than upright", () => {
    expect([swipeStep(-60, 10), swipeStep(60, -10), swipeStep(-30, 0), swipeStep(-60, 70)]).toEqual([1, -1, 0, 0]);
  });

  test("a double tap zooms in where it lands and a second one zooms back out; while zoomed a drag pans and doesn't swipe", async () => {
    const { key, pointer, transform, arrive, stageBox, count } = screen();
    key(A).dispatch("click");
    await arrive(412, 915);
    stageBox();
    pointer("pointerdown", 1, 206, 425);
    pointer("pointerup", 1, 206, 425);
    pointer("pointerdown", 1, 206, 425);
    pointer("pointerup", 1, 206, 425);
    expect(transform()).toBe("translate(0px, 0px) scale(2.5)");
    pointer("pointerdown", 1, 300, 400);
    pointer("pointermove", 1, 200, 400);
    pointer("pointerup", 1, 200, 400);
    expect(count()).toBe("1 of 3 · 412 × 915 · 184 KB");
    expect(transform()).toBe("translate(-100px, 0px) scale(2.5)");
    pointer("pointerdown", 1, 206, 425);
    pointer("pointerup", 1, 206, 425);
    pointer("pointerdown", 1, 206, 425);
    pointer("pointerup", 1, 206, 425);
    expect(transform()).toBe("");
  });

  test("a pinch zooms between the two fingers", async () => {
    const { key, pointer, transform, arrive, stageBox } = screen();
    key(A).dispatch("click");
    await arrive(412, 915);
    stageBox();
    pointer("pointerdown", 1, 156, 425);
    pointer("pointerdown", 2, 256, 425);
    pointer("pointermove", 2, 356, 425);
    pointer("pointermove", 1, 56, 425);
    pointer("pointerup", 1, 56, 425);
    pointer("pointerup", 2, 356, 425);
    expect(transform()).toBe("translate(0px, 0px) scale(3)");
  });

  test("moving to another picture starts it fitted again", async () => {
    const { key, pointer, transform, arrive, stageBox, find } = screen();
    key(A).dispatch("click");
    await arrive(412, 915);
    stageBox();
    for (const type of ["pointerdown", "pointerup", "pointerdown", "pointerup"]) pointer(type, 1, 206, 425);
    find(".picture-next").dispatch("click");
    expect(transform()).toBe("");
  });
});

describe("closing", () => {
  test("the close key closes it, takes back its history entry, and returns focus to the key that opened it", async () => {
    const { key, find, layer, inert, doc, history, previews, arrive, win } = screen();
    key(B).focus();
    key(B).dispatch("click");
    await arrive();
    find(".picture-close").dispatch("click");
    expect(layer().hidden).toBe(true);
    expect(layer().children).toEqual([]);
    expect(inert()).toBe(false);
    expect(doc.activeElement).toBe(key(B));
    expect(history.backs).toBe(1);
    expect(history.state).toBeNull();
    expect(previews.revoked).toEqual(previews.created);
    expect(win.listeners).toEqual([]);
  });

  test("Esc closes it the same way", () => {
    const { key, press, layer, history, doc } = screen();
    key(C).dispatch("click");
    press("Escape");
    expect([layer().hidden, history.backs, doc.activeElement]).toEqual([true, 1, key(C)]);
  });

  test("the phone's Back closes it without going back a second time", () => {
    const { key, layer, history, doc, inert } = screen();
    key(A).dispatch("click");
    history.userBack();
    expect([layer().hidden, inert(), history.backs, doc.activeElement]).toEqual([true, false, 0, key(A)]);
  });

  test("when the Reader redrew the key meanwhile, focus goes to the same path's new key, else to the output", () => {
    const { key, find, doc } = screen();
    key(B).dispatch("click");
    find(".live").innerHTML = readerHtml(` again ${B}`);
    find(".picture-close").dispatch("click");
    expect(doc.activeElement).toBe(key(B));
    key(B).dispatch("click");
    find(".live").innerHTML = readerHtml(" gone");
    find(".picture-close").dispatch("click");
    expect(doc.activeElement).toBe(find(".output"));
  });

  test("a change of screen closes it without touching history or focus", () => {
    const { key, viewer, layer, history, doc } = screen();
    key(A).dispatch("click");
    viewer.close({ restoreFocus: false, popHistory: false });
    expect([layer().hidden, history.backs, doc.activeElement === key(A)]).toEqual([true, 0, false]);
  });

  test("Tab and Shift+Tab stay on the dialog's keys", () => {
    const { key, press, doc, find } = screen();
    key(B).dispatch("click");
    const order = [".picture-close", ".picture-copy", ".picture-prev", ".picture-next"].map(find);
    const seen = [doc.activeElement];
    for (let i = 0; i < 4; i++) {
      press("Tab");
      seen.push(doc.activeElement);
    }
    expect(seen).toEqual([...order, order[0]]);
    press("Tab", true);
    expect(doc.activeElement).toBe(order[3]);
  });
});

describe("Copy path", () => {
  test("copies the shown picture's path and says so", async () => {
    const { key, find, copied } = screen();
    key(B).dispatch("click");
    find(".picture-next").dispatch("click");
    find(".picture-copy").dispatch("click");
    await settle();
    expect(copied).toEqual([C]);
    expect(find(".picture-copy").textContent).toBe("Copied");
    expect(find(".picture-said").textContent).toBe(`Copied ${C}`);
  });

  test("says so when the clipboard refuses", async () => {
    const { key, find, failCopy } = screen();
    failCopy();
    key(A).dispatch("click");
    find(".picture-copy").dispatch("click");
    await settle();
    expect(find(".picture-said").textContent).toBe(`Couldn't copy ${A}.`);
  });
});

const css = readFileSync(join(import.meta.dir, "../web/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/(?:^|\n)([^{}\n][^{}]*)\{([^}]*)\}/g)];
const declarations = (selector: string) => {
  const found = rules.find(([, selectors]) => selectors.split(",").map((each) => each.trim()).includes(selector));
  if (!found) throw new Error(`No rule for ${selector}`);
  return Object.fromEntries(found[2].split(";").map((line) => line.split(":").map((part) => part.trim())).filter((pair) => pair.length === 2));
};

describe("a picture that can't be shown", () => {
  test("shows the plain reason in the picture's place, and close and Copy path still work", async () => {
    const { key, find, loads, img, copied, layer } = screen();
    key(A).dispatch("click");
    loads[0].settle(Object.assign(new Error("Not found on the laptop."), { code: "picture_not_found" }));
    await settle();
    expect(find(".picture-note").textContent).toBe("Not found on the laptop.");
    expect(find(".picture-note").hidden).toBe(false);
    expect(img().hidden).toBe(true);
    find(".picture-copy").dispatch("click");
    await settle();
    expect(copied).toEqual([A]);
    find(".picture-close").dispatch("click");
    expect(layer().hidden).toBe(true);
  });

  test("bytes the browser can't draw read as not a picture", async () => {
    const { key, find, loads, img } = screen();
    key(A).dispatch("click");
    loads[0].settle(new Blob(["<html>"]));
    await settle();
    img().dispatch("error");
    expect(find(".picture-note").textContent).toBe("Not a picture. The laptop shows PNG, JPEG, WebP and GIF files.");
    expect(img().hidden).toBe(true);
  });

  test("its message is in ink, never the orange signal", () => {
    const pictureRules = rules.filter(([, selectors]) => selectors.includes(".picture"));
    expect(pictureRules.length).toBeGreaterThan(0);
    expect(pictureRules.filter(([, , body]) => body.includes("--signal")).map(([, selectors]) => selectors.trim())).toEqual([]);
  });
});

describe("the stylesheet's targets, read because the fake DOM has no layout", () => {
  test("the view key and every key of the viewer are at least 48px each way", () => {
    expect([declarations(".view-key")["min-width"], declarations(".view-key").height]).toEqual(["var(--key)", "var(--key)"]);
    for (const selector of [".picture-close", ".picture-prev", ".picture-next"]) expect([selector, declarations(selector).width, declarations(selector).height]).toEqual([selector, "var(--key)", "var(--key)"]);
    expect([declarations(".picture-copy")["min-width"], declarations(".picture-copy").height]).toEqual(["var(--key)", "var(--key)"]);
  });

  test("a box-drawn picture path has a transparent hit area 48px tall and wide, with no change to the block's own layout", () => {
    expect(declarations(".path[data-view]").position).toBe("relative");
    const hit = declarations(".path[data-view]::after");
    expect([hit.content, hit.position, hit["min-width"], hit.left, hit.right, hit.top, hit.bottom]).toEqual(['""', "absolute", "var(--key)", "0", "0", "calc((100% - var(--key)) / 2)", "calc((100% - var(--key)) / 2)"]);
    expect(hit.background).toBeUndefined();
  });

  test("the viewer covers the whole screen on its own dark surface, and the stage takes the fingers", () => {
    expect([declarations(".picture-layer").position, declarations(".picture-layer").inset]).toEqual(["fixed", "0"]);
    expect(declarations(".picture-viewer").background).toBe("var(--viewer)");
    expect(declarations(".picture-stage")["touch-action"]).toBe("none");
    expect(declarations(".picture-img")["object-fit"]).toBe("contain");
  });
});
