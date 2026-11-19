import { describe, expect, test } from "bun:test";
import type { FileInfo } from "../server/files";
import { createFileSheet, type Phone } from "../web/file-sheet.js";
import { COPIED_MS } from "../web/dialog.js";
import { MAX_FILE_BYTES } from "../web/file-rules.js";
import { bindFile } from "../web/links.js";
import { readerHtml } from "../web/reader.js";
import { cssRules, declarations } from "./support/css";
import { FakeDocument, FakeEvent, asPageElement, type FakeElement } from "./support/fake-dom";

const PDF = "/tmp/hermux/invoice-november.pdf";
const ZIP = "/tmp/hermux/photos-backup.zip";
const BOXED = "/tmp/hermux/boxed.pdf";
const MINUTE = 60_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

class Pending<T> {
  settle!: (answer: T | Error) => void;
  promise: Promise<T>;
  constructor(readonly path: string, readonly signal?: AbortSignal) {
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

const pdfInfo = (extra: Partial<FileInfo> = {}): FileInfo => ({ name: "invoice-november.pdf", size: 212 * 1024, modified: Date.now() - 2 * MINUTE, kind: "application/pdf", ...extra });
const zipInfo = (extra: Partial<FileInfo> = {}): FileInfo => ({ name: "photos-backup.zip", size: 18.4 * 1024 * 1024, modified: Date.now() - 3 * 60 * MINUTE, kind: "application/octet-stream", ...extra });

const named = (name: string, error = "Error") => Object.assign(new Error(name), { name: error });

function screen({ canShare = true, phone: phoneOptions = true }: { canShare?: boolean; phone?: boolean } = {}) {
  const doc = new FakeDocument("body");
  const text = ` Done. I made ${PDF} and zipped ${ZIP} for you.\n\n ╭──────────────────────────────╮\n │ ${BOXED}        │\n ╰──────────────────────────────╯`;
  doc.root.innerHTML = `<main id="app" class="app"><div class="output" tabindex="0"><div class="live">${readerHtml(text)}</div></div></main><div id="file-root" class="switcher-layer" hidden></div>`;
  const find = (selector: string) => doc.root.querySelector(selector) as FakeElement;
  const all = (selector: string) => doc.root.querySelectorAll(selector);
  const infos: Pending<FileInfo>[] = [];
  const reads: Pending<Blob>[] = [];
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
  const did = { opened: [] as Blob[], saved: [] as [Blob, string][], shared: [] as File[][], asked: [] as File[][] };
  let opens = true;
  let sharing: Pending<void> | null = null;
  const phone: Phone = {
    canShare: (files) => {
      did.asked.push(files);
      return canShare;
    },
    share: (files) => {
      did.shared.push(files);
      sharing = new Pending<void>("share");
      return sharing.promise;
    },
    save: (blob, name) => void did.saved.push([blob, name]),
    open: (blob) => {
      did.opened.push(blob);
      return opens;
    },
  };
  const sheet = createFileSheet({
    page: asPageElement(find("#app")),
    root: asPageElement(find("#file-root")),
    client: {
      readFileInfo: (path: string) => {
        const info = new Pending<FileInfo>(path);
        infos.push(info);
        return info.promise;
      },
      readFile: (path: string, options?: { signal?: AbortSignal }) => {
        const read = new Pending<Blob>(path, options?.signal);
        reads.push(read);
        return read.promise;
      },
    },
    browser: { history, events: win, keys: asPageElement(doc.root) },
    ...(phoneOptions ? { phone } : {}),
    copy: async (path) => {
      if (copyFails) throw new Error("denied");
      copied.push(path);
    },
  });
  bindFile(asPageElement(find(".output")), sheet.open);
  const key = (path: string) => all(".file-key").find((element) => element.getAttribute("data-file") === path)!;
  const press = (keyName: string, shiftKey = false) => (doc.activeElement ?? doc.root).dispatch("keydown", { key: keyName, shiftKey });
  const inert = () => (find("#app") as unknown as { inert?: boolean }).inert === true;
  const layer = () => find("#file-root");
  const buttons = () => all("#file-root .file-acts button").map((button) => button.textContent);
  const button = (label: string) => all("#file-root .file-acts button").find((each) => each.textContent === label)!;
  const note = () => find(".file-note");
  const tap = async (label: string) => {
    button(label).dispatch("click");
    await settle();
  };
  const openWith = async (path: string, info: FileInfo | Error) => {
    key(path).dispatch("click");
    infos[infos.length - 1].settle(info);
    await settle();
  };
  const arrive = async (blob: Blob) => {
    reads[reads.length - 1].settle(blob);
    await settle();
  };
  return {
    doc,
    find,
    all,
    infos,
    reads,
    history,
    win,
    copied,
    did,
    failCopy: () => (copyFails = true),
    blockOpen: () => (opens = false),
    allowOpen: () => (opens = true),
    endShare: (answer?: Error) => sharing?.settle(answer ?? undefined),
    sheet,
    key,
    press,
    inert,
    layer,
    buttons,
    button,
    note,
    tap,
    openWith,
    arrive,
  };
}

describe("opening the sheet", () => {
  test("a file key raises a modal sheet over an inert page, named by the file, with focus on its close key", () => {
    const { key, layer, find, inert, doc, infos, history, buttons } = screen();
    key(PDF).dispatch("click");
    expect(layer().hidden).toBe(false);
    const dialog = find(".file-sheet");
    expect([dialog.getAttribute("role"), dialog.getAttribute("aria-modal"), dialog.getAttribute("aria-labelledby"), dialog.getAttribute("aria-describedby")]).toEqual(["dialog", "true", "file-name", "file-meta"]);
    expect(find("#file-name").textContent).toBe("invoice-november.pdf");
    expect(find(".file-path").textContent).toBe(PDF);
    expect(find(".file-badge").textContent).toBe("PDF");
    expect(find("#file-meta").textContent).toBe("Looking it up…");
    expect(inert()).toBe(true);
    expect(doc.activeElement).toBe(find(".file-close"));
    expect(find(".file-close").getAttribute("aria-label")).toBe("Close");
    expect(infos.map((info) => info.path)).toEqual([PDF]);
    expect(buttons()).toEqual(["Copy path"]);
    expect(history.state).toEqual({ file: true });
  });

  test("the info fills in the badge, the size and when it changed, and Open, Save, Share… and Copy path in that order", async () => {
    const { openWith, find, buttons, button, did } = screen();
    await openWith(PDF, pdfInfo());
    expect(find(".file-badge").textContent).toBe("PDF");
    expect(find("#file-meta").textContent).toBe("PDF · 212 KB · changed 2 min ago");
    expect(buttons()).toEqual(["Open", "Save", "Share…", "Copy path"]);
    expect(button("Open").classList.contains("act-dark")).toBe(true);
    expect(button("Save").classList.contains("act-dark")).toBe(false);
    expect(did.asked.map((files) => files.map((file) => [file.name, file.type]))).toEqual([[["invoice-november.pdf", "application/pdf"]]]);
  });

  test("a file the phone can't show has no Open, so Save leads; Share is hidden where the browser can't share the file", async () => {
    const { openWith, find, buttons, button, did } = screen({ canShare: false });
    await openWith(ZIP, zipInfo());
    expect(find(".file-badge").textContent).toBe("ZIP");
    expect(find("#file-meta").textContent).toBe("ZIP · 18.4 MB · changed 3 h ago");
    expect(buttons()).toEqual(["Save", "Copy path"]);
    expect(button("Save").classList.contains("act-dark")).toBe(true);
    expect(did.asked.map((files) => files.map((file) => [file.name, file.type]))).toEqual([[["photos-backup.zip", "application/octet-stream"]]]);
  });

  test("without navigator.canShare, as in a desktop browser, Share… never shows", async () => {
    const { openWith, buttons } = screen({ phone: false });
    await openWith(PDF, pdfInfo());
    expect(buttons()).toEqual(["Open", "Save", "Copy path"]);
  });

  test("the badge and meta follow the name, then the type, and a just-changed file says so", async () => {
    const { openWith, find } = screen();
    await openWith(PDF, pdfInfo({ name: "README", kind: "application/octet-stream", size: 900, modified: Date.now() }));
    expect([find(".file-badge").textContent, find("#file-meta").textContent]).toEqual(["FILE", "FILE · 900 B · changed just now"]);
  });

  test("a box-drawn file path opens the sheet on a tap or Enter, and a long-press copies it without opening", async () => {
    const { find, layer, sheet, doc } = screen();
    const path = find(`.path[data-file="${BOXED}"]`);
    path.dispatch("click");
    expect(layer().hidden).toBe(false);
    sheet.close();
    expect(layer().hidden).toBe(true);
    path.dispatch("keydown", { key: "Enter" });
    expect(layer().hidden).toBe(false);
    sheet.close();
    const at = (type: string, timeStamp: number) => path.dispatchEvent(Object.assign(new FakeEvent(type), { timeStamp }));
    at("contextmenu", 1000);
    at("click", 1700);
    expect(layer().hidden).toBe(true);
    expect(doc.activeElement).toBe(path);
  });
});

describe("getting the file", () => {
  test("Open reads the file once through the client and hands the phone a blob of the file's own type", async () => {
    const { openWith, tap, reads, note, arrive, did, button } = screen();
    await openWith(PDF, pdfInfo());
    await tap("Open");
    expect(reads.map((read) => [read.path, read.signal instanceof AbortSignal])).toEqual([[PDF, true]]);
    expect(note().textContent).toBe("Getting invoice-november.pdf…");
    expect(button("Open").getAttribute("aria-busy")).toBe("true");
    await arrive(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    expect(did.opened.map((blob) => blob.type)).toEqual(["application/pdf"]);
    expect(await did.opened[0].text()).toBe("%PDF-1.7");
    expect(note().textContent).toBe("Opened invoice-november.pdf.");
    expect(button("Open").hasAttribute("aria-busy")).toBe(false);
    await tap("Save");
    expect(reads).toHaveLength(1);
    expect(did.saved.map(([blob, name]) => [blob.type, name])).toEqual([["application/pdf", "invoice-november.pdf"]]);
    expect(note().textContent).toBe("Saved invoice-november.pdf to Downloads. The phone says so at the top of the screen.");
    expect(button("Saved")).toBeDefined();
  });

  test("Save reads Saved on its own key for a moment, then Save again", async () => {
    const { openWith, tap, arrive, buttons } = screen();
    await openWith(PDF, pdfInfo());
    await tap("Save");
    await arrive(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    expect(buttons()).toEqual(["Open", "Saved", "Share…", "Copy path"]);
    await Bun.sleep(COPIED_MS + 50);
    expect(buttons()).toEqual(["Open", "Save", "Share…", "Copy path"]);
  });

  test("a second tap while the file is still coming asks nothing more", async () => {
    const { openWith, tap, reads } = screen();
    await openWith(PDF, pdfInfo());
    await tap("Save");
    await tap("Save");
    await tap("Open");
    expect(reads).toHaveLength(1);
  });

  test("a bytes type the phone can't show is never opened as one", async () => {
    const { openWith, tap, arrive, did, note } = screen();
    await openWith(PDF, pdfInfo());
    await tap("Open");
    await arrive(new Blob(["<!doctype html><script>alert(1)</script>"], { type: "text/html" }));
    expect(did.opened).toEqual([]);
    expect(note().textContent).toBe("The phone can't open this kind of file. Save it instead.");
  });

  test("when the browser blocks Open after the wait, a second tap opens it at once", async () => {
    const { openWith, tap, arrive, did, note, blockOpen, allowOpen, reads } = screen();
    await openWith(PDF, pdfInfo());
    blockOpen();
    await tap("Open");
    await arrive(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    expect(note().textContent).toBe("Ready. Tap Open again.");
    allowOpen();
    await tap("Open");
    expect(did.opened).toHaveLength(2);
    expect(reads).toHaveLength(1);
    expect(note().textContent).toBe("Opened invoice-november.pdf.");
  });

  test("Share hands the phone's share menu the file under its name and type; a cancel says nothing, a lost tap asks for another", async () => {
    const { openWith, tap, arrive, did, note, endShare } = screen();
    await openWith(PDF, pdfInfo());
    await tap("Share…");
    await arrive(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    expect(did.shared.map((files) => files.map((file) => [file.name, file.type, file.size]))).toEqual([[["invoice-november.pdf", "application/pdf", 8]]]);
    endShare(named("cancelled", "AbortError"));
    await settle();
    expect(note().textContent).toBe("");
    await tap("Share…");
    endShare(named("no activation", "NotAllowedError"));
    await settle();
    expect(note().textContent).toBe("Ready. Tap Share… again.");
    await tap("Share…");
    endShare(new Error("broken"));
    await settle();
    expect(note().textContent).toBe("Couldn't share invoice-november.pdf.");
    await tap("Share…");
    endShare();
    await settle();
    expect(note().textContent).toBe("");
  });

  test("Copy path copies the path, says so, and the key reads Copied", async () => {
    const { openWith, tap, copied, note, button, failCopy } = screen();
    await openWith(PDF, pdfInfo());
    await tap("Copy path");
    expect(copied).toEqual([PDF]);
    expect(note().textContent).toBe(`Copied ${PDF}`);
    expect(button("Copied")).toBeDefined();
    failCopy();
    await tap("Copied");
    expect(note().textContent).toBe(`Couldn't copy ${PDF}.`);
  });

  test("Copy path works before the info arrives and when it fails", async () => {
    const { key, tap, copied, infos } = screen();
    key(ZIP).dispatch("click");
    await tap("Copy path");
    infos[0].settle(Object.assign(new Error("Not found on the laptop."), { code: "file_not_found" }));
    await settle();
    await tap("Copied");
    expect(copied).toEqual([ZIP, ZIP]);
  });
});

describe("when the file can't be had", () => {
  test("a refused info reads as a plain error, with only Copy path left", async () => {
    const { openWith, note, buttons, find } = screen();
    await openWith(PDF, Object.assign(new Error("Not allowed. The laptop sends files from your home folder or /tmp only, never from a hidden folder."), { code: "path_not_allowed" }));
    expect(note().textContent).toBe("Not allowed. The laptop sends files from your home folder or /tmp only, never from a hidden folder.");
    expect(note().classList.contains("is-error")).toBe(true);
    expect(buttons()).toEqual(["Copy path"]);
    expect([find("#file-meta").textContent, find(".file-badge").textContent]).toEqual(["", "PDF"]);
  });

  test("a file over 100 MB says so, and nothing is fetched", async () => {
    const { openWith, note, buttons, find, reads } = screen();
    await openWith(ZIP, zipInfo({ size: MAX_FILE_BYTES + 1 }));
    expect(find("#file-meta").textContent).toBe("ZIP · 100.0 MB · changed 3 h ago");
    expect(note().textContent).toBe("Too big to get. The limit is 100 MB.");
    expect(buttons()).toEqual(["Copy path"]);
    expect(reads).toHaveLength(0);
  });

  test("a failed read says why and keeps the buttons for another try", async () => {
    const { openWith, tap, reads, note, buttons } = screen();
    await openWith(PDF, pdfInfo());
    await tap("Save");
    reads[0].settle(Object.assign(new Error("Can't reach the laptop."), { code: "unreachable" }));
    await settle();
    expect([note().textContent, note().classList.contains("is-error")]).toEqual(["Can't reach the laptop.", true]);
    expect(buttons()).toEqual(["Open", "Save", "Share…", "Copy path"]);
    await tap("Save");
    expect(reads).toHaveLength(2);
  });

  test("no error is ever orange, and the buttons are 56px", () => {
    const fileRules = cssRules.filter((rule) => rule.selectors.some((selector) => selector.includes(".file-")));
    expect(fileRules.length).toBeGreaterThan(0);
    expect(fileRules.filter((rule) => Object.entries(rule.declarations).flat().some((part) => part.includes("--signal"))).map((rule) => rule.selectors)).toEqual([]);
    expect(declarations(".file-acts .act").height).toBe("var(--row)");
    expect([declarations(".file-close").width, declarations(".file-close").height]).toEqual(["var(--key)", "var(--key)"]);
    expect([declarations(".file-key")["min-width"], declarations(".file-key").height]).toEqual(["var(--key)", "var(--key)"]);
    expect(declarations(".path[data-file]").position).toBe("relative");
  });

  test("the sheet's body scrolls inside the sheet's 60dvh, so Copy path is never cut off", () => {
    expect(declarations(".switcher")["max-height"]).toBe("60dvh");
    expect([declarations(".file-body")["min-height"], declarations(".file-body")["overflow-y"]]).toEqual(["0", "auto"]);
  });
});

describe("closing", () => {
  test("the close key, Esc and a tap on the scrim close it, take the history entry back and return focus to the key", async () => {
    for (const how of ["key", "escape", "scrim"] as const) {
      const { key, find, layer, inert, doc, history, press } = screen();
      key(PDF).dispatch("click");
      if (how === "key") find(".file-close").dispatch("click");
      else if (how === "escape") press("Escape");
      else find("#file-root .switcher-dim").dispatch("click");
      expect([how, layer().hidden, inert(), history.backs, history.state]).toEqual([how, true, false, 1, null]);
      expect(doc.activeElement).toBe(key(PDF));
    }
  });

  test("the phone's Back closes it without going back again", () => {
    const { key, layer, history, doc } = screen();
    key(PDF).dispatch("click");
    history.userBack();
    expect([layer().hidden, history.backs]).toEqual([true, 0]);
    expect(doc.activeElement).toBe(key(PDF));
  });

  test("a swipe down on the sheet closes it; a short one doesn't", () => {
    const { key, find, layer } = screen();
    key(PDF).dispatch("click");
    const head = find(".file-sheet .switcher-head");
    const drag = (type: string, clientY: number) => head.dispatchEvent(Object.assign(new FakeEvent(type), { clientY }));
    drag("pointerdown", 100);
    drag("pointermove", 120);
    drag("pointerup", 120);
    expect(layer().hidden).toBe(false);
    drag("pointerdown", 100);
    drag("pointermove", 200);
    drag("pointerup", 200);
    expect(layer().hidden).toBe(true);
  });

  test("closing stops a file still coming, and its late answer changes nothing", async () => {
    const { openWith, tap, reads, sheet, arrive, did } = screen();
    await openWith(PDF, pdfInfo());
    await tap("Open");
    sheet.close();
    expect(reads[0].signal?.aborted).toBe(true);
    await arrive(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
    expect(did.opened).toEqual([]);
  });

  test("Tab and Shift+Tab stay on the sheet's keys", async () => {
    const { openWith, press, doc, find, button } = screen();
    await openWith(PDF, pdfInfo());
    const order = [find(".file-close"), button("Open"), button("Save"), button("Share…"), button("Copy path")];
    for (const next of [...order.slice(1), order[0]]) {
      press("Tab");
      expect(doc.activeElement).toBe(next);
    }
    press("Tab", true);
    expect(doc.activeElement).toBe(order[4]);
  });

  test("focus on a key stays on that key when the info redraws the keys", async () => {
    const { key, press, doc, infos, button } = screen();
    key(PDF).dispatch("click");
    press("Tab");
    expect(doc.activeElement).toBe(button("Copy path"));
    infos[0].settle(pdfInfo());
    await settle();
    expect(doc.activeElement).toBe(button("Copy path"));
  });

  test("focus goes back to the same path's new key when the screen redrew under the sheet", () => {
    const { key, find, doc, sheet } = screen();
    key(ZIP).dispatch("click");
    find(".live").innerHTML = readerHtml(` Again: ${ZIP}`);
    sheet.close();
    expect(doc.activeElement).toBe(key(ZIP));
  });

  test("leaving the screen closes it without touching history or focus", () => {
    const { key, layer, history, sheet, doc } = screen();
    key(PDF).dispatch("click");
    const focused = doc.activeElement;
    sheet.close({ restoreFocus: false, popHistory: false });
    expect([layer().hidden, history.backs, doc.activeElement]).toEqual([true, 0, focused]);
  });
});
