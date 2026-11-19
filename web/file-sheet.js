import { LAPTOP_UNREACHABLE, describeError, fileProblem } from "./api.js";
import { formatSize } from "./attach.js";
import { COPIED_MS, baseName, dialogLayer } from "./dialog.js";
import { find, findAll, need } from "./dom.js";
import { MAX_FILE_BYTES } from "./file-rules.js";
import { escapeHtml, icon } from "./html.js";
import { duration } from "./rows.js";
import { bindSwipeDown } from "./sheet.js";

/**
 * @typedef {import("./types.js").FileInfo} FileInfo
 * @typedef {"open" | "save" | "share" | "copy"} Action
 * @typedef {import("./dialog.js").KeyEvents} KeyEvents
 * @typedef {import("./dialog.js").BackEvents} BackEvents
 * @typedef {import("./dialog.js").PageHistory} PageHistory
 * @typedef {object} Phone what the phone's browser does with a file
 * @property {(files: File[]) => boolean} canShare
 * @property {(files: File[]) => Promise<void>} share
 * @property {(blob: Blob, name: string) => void} save
 * @property {(blob: Blob) => boolean} open whether the browser let it open
 */

// Long enough for the browser to start a download or the phone's viewer to
// read the file, after which the blob's address is dropped.
const KEEP_URL_MS = 60_000;
const OPENABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);
const LABELS = { open: "Open", save: "Save", share: "Share…", copy: "Copy path" };

/** @param {Blob} blob */
const keepUrl = (blob) => {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), KEEP_URL_MS);
  return url;
};

/** @type {Phone} */
export const BROWSER_PHONE = {
  canShare: (files) => typeof navigator.canShare === "function" && navigator.canShare({ files }),
  share: (files) => navigator.share({ files }),
  save(blob, name) {
    const link = document.createElement("a");
    link.href = keepUrl(blob);
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  },
  open: (blob) => window.open(keepUrl(blob), "_blank") !== null,
};

/**
 * @param {string} name
 * @param {string} kind
 */
function badgeOf(name, kind) {
  const extension = /\.([a-z0-9]{1,4})$/i.exec(name)?.[1];
  if (extension) return extension.toUpperCase();
  if (kind === "application/pdf") return "PDF";
  return kind.startsWith("image/") ? kind.slice("image/".length).toUpperCase() : "FILE";
}

/** @param {FileInfo} info */
function metaOf({ name, size, modified, kind }) {
  const ago = duration(modified);
  const changed = ago === "now" ? " · changed just now" : ago ? ` · changed ${ago} ago` : "";
  return `${badgeOf(name, kind)} · ${formatSize(size)}${changed}`;
}

/** @param {unknown} state */
const isOurs = (state) => typeof state === "object" && state !== null && "file" in state;

/** @param {unknown} error */
const errorName = (error) => (error instanceof Error ? error.name : "");

const SHEET = `
    <button class="switcher-dim" type="button" tabindex="-1" aria-label="Close file"></button>
    <section class="switcher file-sheet" role="dialog" aria-modal="true" aria-labelledby="file-name" aria-describedby="file-meta">
      <div class="switcher-head">
        <div class="switcher-grab" aria-hidden="true"></div>
      </div>
      <div class="file-body">
        <div class="file-top">
          <span class="file-badge" aria-hidden="true"></span>
          <div class="file-title">
            <h2 class="file-name" id="file-name"></h2>
            <p class="file-meta" id="file-meta"></p>
          </div>
          <button class="file-close" type="button" aria-label="Close">${icon("i-close")}</button>
        </div>
        <p class="file-path"></p>
        <div class="file-acts"></div>
        <p class="file-note" role="status" aria-live="polite"></p>
      </div>
    </section>`;

/**
 * The file sheet: a laptop file's name, size and age, and Open, Save, Share…
 * and Copy path. It reads the file through the client only when a button
 * needs it, once, and sits in its own layer outside the page.
 * @param {{
 *   page: HTMLElement | null,
 *   root: HTMLElement | null,
 *   client: Pick<import("./types.js").Client, "readFileInfo" | "readFile">,
 *   browser: { history: PageHistory, events: BackEvents, keys: KeyEvents },
 *   phone?: Phone,
 *   copy: (text: string) => Promise<void>,
 * }} options
 */
export function createFileSheet({ page: pageElement, root: rootElement, client, browser, phone = BROWSER_PHONE, copy }) {
  const { page, root, trapTab } = dialogLayer({ name: "file sheet", page: pageElement, root: rootElement, rootName: "file root" });

  /**
   * @typedef {object} Shown
   * @property {HTMLElement} trigger
   * @property {string} triggerKind
   * @property {string} path
   * @property {FileInfo | null} info
   * @property {Action[]} actions
   * @property {AbortController | null} reading
   * @property {Blob | null} blob
   * @property {Action | null} busy
   * @property {Partial<Record<Action, ReturnType<typeof setTimeout>>>} flashed
   */
  /** @type {Shown | null} */
  let shown = null;

  /** @param {HTMLElement} trigger */
  function open(trigger) {
    const path = trigger.getAttribute("data-file");
    if (shown || !path) return;
    /** @type {Shown} */
    const at = {
      trigger,
      triggerKind: trigger.classList.contains("file-key") ? "file-key" : "path",
      path,
      info: null,
      actions: [],
      reading: null,
      blob: null,
      busy: null,
      flashed: {},
    };
    shown = at;
    root().hidden = false;
    root().classList.add("is-open");
    root().innerHTML = SHEET;
    page().inert = true;
    need(root(), ".file-name").textContent = baseName(path);
    need(root(), ".file-badge").textContent = badgeOf(baseName(path), "");
    need(root(), ".file-path").textContent = path;
    need(root(), ".file-meta").textContent = "Looking it up…";
    need(root(), ".switcher-dim").addEventListener("click", () => close());
    need(root(), ".file-close").addEventListener("click", () => close());
    need(root(), ".file-acts").addEventListener("click", onActionClick);
    bindSwipeDown(need(root(), ".file-sheet"), need(root(), ".switcher-head"), need(root(), ".file-body"), () => close());
    browser.history.pushState({ file: true }, "");
    browser.events.addEventListener("popstate", onBack);
    browser.keys.addEventListener("keydown", onKey);
    drawActions();
    need(root(), ".file-close").focus();
    client.readFileInfo(path).then(
      (info) => {
        if (shown !== at) return;
        at.info = info;
        drawInfo();
      },
      (error) => {
        if (shown !== at) return;
        need(root(), ".file-meta").textContent = "";
        note(describeError(error, LAPTOP_UNREACHABLE).message, true);
      },
    );
  }

  /** @param {{ restoreFocus?: boolean, popHistory?: boolean }} [options] */
  function close({ restoreFocus = true, popHistory = true } = {}) {
    const closing = shown;
    if (!closing) return;
    shown = null;
    closing.reading?.abort();
    for (const timer of Object.values(closing.flashed)) clearTimeout(timer);
    browser.keys.removeEventListener("keydown", onKey);
    browser.events.removeEventListener("popstate", onBack);
    if (popHistory && isOurs(browser.history.state)) browser.history.back();
    root().hidden = true;
    root().classList.remove("is-open");
    root().replaceChildren();
    page().inert = false;
    if (restoreFocus) returnFocus(closing);
  }

  /** @param {Shown} closed */
  function returnFocus({ trigger, triggerKind, path }) {
    if (trigger.isConnected) {
      trigger.focus();
      return;
    }
    const same = findAll(page(), `.${triggerKind}[data-file]`).find((element) => element.getAttribute("data-file") === path);
    (same ?? find(page(), ".output"))?.focus();
  }

  const onBack = () => close({ popHistory: false });

  function drawInfo() {
    const info = shown?.info;
    if (!info) return;
    need(root(), ".file-name").textContent = info.name;
    need(root(), ".file-badge").textContent = badgeOf(info.name, info.kind);
    need(root(), ".file-meta").textContent = metaOf(info);
    if (info.size > MAX_FILE_BYTES) note(fileProblem(413), true);
    drawActions();
  }

  /**
   * @param {FileInfo | null} info
   * @returns {Action[]}
   */
  function actionsFor(info) {
    if (!info || info.size > MAX_FILE_BYTES) return ["copy"];
    const shareable = phone.canShare([new File([], info.name, { type: info.kind })]);
    return [...(OPENABLE.has(info.kind) ? /** @type {Action[]} */ (["open"]) : []), "save", ...(shareable ? /** @type {Action[]} */ (["share"]) : []), "copy"];
  }

  function drawActions() {
    if (!shown) return;
    shown.actions = actionsFor(shown.info);
    const keys = need(root(), ".file-acts");
    const active = root().ownerDocument.activeElement;
    const focused = active && keys.contains(active) ? active.getAttribute("data-act") : null;
    keys.innerHTML = shown.actions
      .map((action, index) => `<button class="act file-${action}${index === 0 && action !== "copy" ? " act-dark" : ""}" type="button" data-act="${action}">${escapeHtml(LABELS[action])}</button>`)
      .join("");
    if (focused) find(keys, `[data-act="${focused}"]`)?.focus();
  }

  /**
   * @param {string} text
   * @param {boolean} [error]
   */
  function note(text, error = false) {
    const element = need(root(), ".file-note");
    element.textContent = text;
    element.classList.toggle("is-error", error);
  }

  /** @param {Event} event */
  function onActionClick(event) {
    const button = /** @type {Element | null} */ (event.target)?.closest("[data-act]");
    const action = /** @type {Action | undefined} */ (button?.getAttribute("data-act") ?? undefined);
    if (action === "copy") copyPath();
    else if (action) act(action);
  }

  /** @param {Exclude<Action, "copy">} action */
  async function act(action) {
    const at = shown;
    if (!at?.info || at.busy) return;
    const name = at.info.name;
    let blob = at.blob;
    if (!blob) {
      const reading = new AbortController();
      Object.assign(at, { busy: action, reading });
      markBusy(action);
      note(`Getting ${name}…`);
      try {
        blob = await client.readFile(at.path, { signal: reading.signal });
      } catch (error) {
        if (shown !== at) return;
        Object.assign(at, { busy: null, reading: null });
        markBusy(null);
        note(describeError(error, LAPTOP_UNREACHABLE).message, true);
        return;
      }
      if (shown !== at) return;
      Object.assign(at, { busy: null, reading: null, blob });
      markBusy(null);
    }
    if (action === "open") openBlob(blob, name);
    else if (action === "save") {
      phone.save(blob, name);
      note(`Saved ${name} to Downloads. The phone says so at the top of the screen.`);
      flash(at, "save", "Saved");
    } else shareBlob(at, blob, name);
  }

  /**
   * @param {Blob} blob
   * @param {string} name
   */
  function openBlob(blob, name) {
    if (!OPENABLE.has(blob.type)) {
      note("The phone can't open this kind of file. Save it instead.", true);
      return;
    }
    note(phone.open(blob) ? `Opened ${name}.` : "Ready. Tap Open again.");
  }

  /**
   * @param {Shown} at
   * @param {Blob} blob
   * @param {string} name
   */
  function shareBlob(at, blob, name) {
    note("");
    phone.share([new File([blob], name, { type: blob.type })]).then(
      () => {
        if (shown === at) note("");
      },
      (error) => {
        if (shown !== at) return;
        const why = errorName(error);
        if (why === "AbortError") note("");
        else if (why === "NotAllowedError") note("Ready. Tap Share… again.");
        else note(`Couldn't share ${name}.`, true);
      },
    );
  }

  /**
   * @param {Shown} at
   * @param {Action} action
   * @param {string} label
   */
  function flash(at, action, label) {
    const key = find(root(), `.file-${action}`);
    if (!key) return;
    key.textContent = label;
    clearTimeout(at.flashed[action]);
    at.flashed[action] = setTimeout(() => {
      const restored = shown === at ? find(root(), `.file-${action}`) : null;
      if (restored) restored.textContent = LABELS[action];
    }, COPIED_MS);
  }

  /** @param {Action | null} busy */
  function markBusy(busy) {
    for (const button of findAll(root(), ".file-acts [data-act]")) {
      if (busy && button.getAttribute("data-act") === busy) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    }
  }

  function copyPath() {
    const at = shown;
    if (!at) return;
    /**
     * @param {string} said
     * @param {string} label
     * @param {boolean} error
     */
    const say = (said, label, error) => {
      if (shown !== at) return;
      note(said, error);
      flash(at, "copy", label);
    };
    copy(at.path).then(
      () => say(`Copied ${at.path}`, "Copied", false),
      () => say(`Couldn't copy ${at.path}.`, LABELS.copy, true),
    );
  }

  /** @param {KeyboardEvent} event */
  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      trapTab(event, [need(root(), ".file-close"), ...findAll(root(), ".file-acts button")]);
    }
  }

  return { open, close };
}
