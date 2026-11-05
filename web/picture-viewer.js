import { NOT_A_PICTURE, PICTURE_UNREACHABLE, describeError } from "./api.js";
import { formatSize } from "./attach.js";
import { find, findAll, need } from "./dom.js";
import { icon } from "./html.js";
import { nextRow } from "./sheet.js";

/**
 * @typedef {{ scale: number, x: number, y: number }} View the picture's zoom, and its offset from the stage's centre in px
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ addEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void, removeEventListener(type: "keydown", listener: (event: KeyboardEvent) => void): void }} KeyEvents
 * @typedef {{ addEventListener(type: "popstate", listener: () => void): void, removeEventListener(type: "popstate", listener: () => void): void }} BackEvents
 * @typedef {{ readonly state: unknown, pushState(data: unknown, unused: string): void, back(): void }} PageHistory
 * @typedef {{ create: (blob: Blob) => string, revoke: (url: string) => void }} Previews
 */

export const MAX_ZOOM = 4;
const TAP_ZOOM = 2.5;
const SWIPE_PX = 48;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 12;
const DOUBLE_TAP_SLOP_PX = 32;
const COPIED_MS = 1500;
const FITTED = Object.freeze({ scale: 1, x: 0, y: 0 });

/** @type {Previews} */
const BROWSER_PREVIEWS = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

const VIEWER = `
    <section class="picture-viewer" role="dialog" aria-modal="true" aria-labelledby="picture-name" aria-describedby="picture-count">
      <div class="picture-bar">
        <button class="picture-close" type="button" aria-label="Close picture">${icon("i-close")}</button>
        <div class="picture-title">
          <h2 class="picture-name" id="picture-name"></h2>
          <p class="picture-count" id="picture-count"></p>
        </div>
        <button class="picture-copy" type="button">Copy path</button>
      </div>
      <div class="picture-stage">
        <img class="picture-img" alt="" draggable="false" hidden>
        <p class="picture-note" aria-live="polite"></p>
      </div>
      <div class="picture-nav">
        <button class="picture-prev" type="button" aria-label="Previous picture">${icon("i-left")}</button>
        <p class="picture-hint"></p>
        <button class="picture-next" type="button" aria-label="Next picture">${icon("i-right")}</button>
      </div>
      <p class="picture-said visually-hidden" role="status"></p>
    </section>`;

/**
 * @param {number} dx
 * @param {number} dy
 * @returns {-1 | 0 | 1} 1 to the next picture, -1 to the previous, 0 nowhere
 */
export const swipeStep = (dx, dy) => (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : -1) : 0);

/**
 * `view` zoomed to `scale` around `point` (from the stage's centre), which stays where it is.
 * @param {View} view
 * @param {number} scale
 * @param {Point} point
 * @returns {View}
 */
export function zoomAt(view, scale, point) {
  const ratio = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}

/**
 * `view` kept between fitted and MAX_ZOOM, with no edge of the picture pulled inside the stage.
 * @param {View} view
 * @param {Size} stage
 * @param {Size} content the picture's fitted size
 * @returns {View}
 */
export function clampView({ scale, x, y }, stage, content) {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, scale));
  if (zoom === 1) return { ...FITTED };
  /** @param {number} at @param {number} room */
  const keep = (at, room) => Math.min(Math.max(0, room), Math.max(-Math.max(0, room), at)) || 0;
  return { scale: zoom, x: keep(x, (content.width * zoom - stage.width) / 2), y: keep(y, (content.height * zoom - stage.height) / 2) };
}

/** @param {string} path */
const baseName = (path) => path.slice(path.lastIndexOf("/") + 1) || path;

/** @param {unknown} state */
const isOurs = (state) => typeof state === "object" && state !== null && "picture" in state;

/** @param {Point} a @param {Point} b */
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** @param {Point} a @param {Point} b */
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The full-screen picture viewer: the screen's pictures one at a time, read
 * from the laptop, with zoom, swipe and Copy path. It sits in its own layer
 * outside the page, so the Reader can redraw under it.
 * @param {{
 *   page: HTMLElement | null,
 *   root: HTMLElement | null,
 *   client: Pick<import("./types.js").Client, "readPicture">,
 *   previews?: Previews,
 *   browser: { history: PageHistory, events: BackEvents, keys: KeyEvents },
 *   copy: (text: string) => Promise<void>,
 * }} options
 */
export function createPictureViewer({ page: pageElement, root: rootElement, client, previews = BROWSER_PREVIEWS, browser, copy }) {
  /** @returns {HTMLElement} */
  const page = () => pageElement ?? missing("page");
  /** @returns {HTMLElement} */
  const root = () => rootElement ?? missing("picture root");
  /** @param {string} what @returns {never} */
  const missing = (what) => {
    throw new Error(`The picture viewer has no ${what}.`);
  };

  /**
   * @typedef {object} Shown
   * @property {HTMLElement} trigger
   * @property {string} triggerKind
   * @property {string} triggerPath
   * @property {string[]} paths
   * @property {number} index
   * @property {number} load
   * @property {AbortController | null} reading
   * @property {string | null} url
   * @property {number | null} bytes
   * @property {Size | null} natural
   * @property {View} view
   * @property {ReturnType<typeof setTimeout> | undefined} copied
   */
  /** @type {Shown | null} */
  let shown = null;

  /**
   * @param {HTMLElement} trigger
   * @param {string[]} paths
   */
  function open(trigger, paths) {
    const path = trigger.getAttribute("data-view");
    if (shown || !path) return;
    const list = paths.includes(path) ? paths : [path];
    shown = {
      trigger,
      triggerKind: trigger.classList.contains("view-key") ? "view-key" : "path",
      triggerPath: path,
      paths: list,
      index: list.indexOf(path),
      load: 0,
      reading: null,
      url: null,
      bytes: null,
      natural: null,
      view: { ...FITTED },
      copied: undefined,
    };
    root().hidden = false;
    root().innerHTML = VIEWER;
    page().inert = true;
    const closeKey = need(root(), ".picture-close");
    closeKey.addEventListener("click", () => close());
    need(root(), ".picture-copy").addEventListener("click", copyPath);
    need(root(), ".picture-prev").addEventListener("click", () => go(-1));
    need(root(), ".picture-next").addEventListener("click", () => go(1));
    const img = need(root(), ".picture-img");
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    bindGestures(need(root(), ".picture-stage"));
    browser.history.pushState({ picture: true }, "");
    browser.events.addEventListener("popstate", onBack);
    browser.keys.addEventListener("keydown", onKey);
    closeKey.focus();
    show(shown.index);
  }

  /** @param {{ restoreFocus?: boolean, popHistory?: boolean }} [options] */
  function close({ restoreFocus = true, popHistory = true } = {}) {
    const closing = shown;
    if (!closing) return;
    shown = null;
    closing.reading?.abort();
    if (closing.url) previews.revoke(closing.url);
    clearTimeout(closing.copied);
    browser.keys.removeEventListener("keydown", onKey);
    browser.events.removeEventListener("popstate", onBack);
    if (popHistory && isOurs(browser.history.state)) browser.history.back();
    root().hidden = true;
    root().replaceChildren();
    page().inert = false;
    if (restoreFocus) returnFocus(closing);
  }

  /** @param {Shown} closed */
  function returnFocus({ trigger, triggerKind, triggerPath }) {
    if (trigger.isConnected) {
      trigger.focus();
      return;
    }
    const same = findAll(page(), `.${triggerKind}[data-view]`).find((element) => element.getAttribute("data-view") === triggerPath);
    (same ?? find(page(), ".output"))?.focus();
  }

  const onBack = () => close({ popHistory: false });

  /** @param {number} index */
  function show(index) {
    const at = shown;
    if (!at) return;
    at.reading?.abort();
    if (at.url) previews.revoke(at.url);
    const reading = new AbortController();
    Object.assign(at, { index, load: at.load + 1, reading, url: null, bytes: null, natural: null });
    const load = at.load;
    const path = at.paths[index];
    need(root(), ".picture-name").textContent = baseName(path);
    const img = need(root(), ".picture-img");
    img.hidden = true;
    img.removeAttribute("src");
    img.setAttribute("alt", baseName(path));
    setView({ ...FITTED });
    note("Opening…");
    drawCount();
    drawNav();
    client.readPicture(path, { signal: reading.signal }).then(
      (blob) => {
        if (shown !== at || at.load !== load) return;
        at.url = previews.create(blob);
        at.bytes = blob.size;
        img.setAttribute("src", at.url);
      },
      (error) => {
        if (shown !== at || at.load !== load) return;
        note(describeError(error, PICTURE_UNREACHABLE).message);
      },
    );
  }

  /** The picture's element, only while it holds the picture now shown. */
  function shownImage() {
    /** @type {HTMLImageElement | null} */
    const img = find(root(), ".picture-img");
    if (!shown || !img || !shown.url || img.getAttribute("src") !== shown.url) return null;
    return img;
  }

  function onLoad() {
    const img = shownImage();
    if (!img || !shown) return;
    const { naturalWidth, naturalHeight } = img;
    shown.natural = { width: naturalWidth, height: naturalHeight };
    img.hidden = false;
    need(root(), ".picture-note").hidden = true;
    drawCount();
  }

  function onError() {
    const img = shownImage();
    if (!img) return;
    img.hidden = true;
    note(NOT_A_PICTURE);
  }

  /** @param {string} text */
  function note(text) {
    const element = need(root(), ".picture-note");
    element.textContent = text;
    element.hidden = false;
  }

  function drawCount() {
    if (!shown) return;
    const { index, paths, natural, bytes } = shown;
    const size = natural && bytes !== null ? ` · ${natural.width} × ${natural.height} · ${formatSize(bytes)}` : "";
    need(root(), ".picture-count").textContent = `${index + 1} of ${paths.length}${size}`;
  }

  function drawNav() {
    if (!shown) return;
    const { index, paths } = shown;
    /** @type {HTMLButtonElement} */
    const prev = need(root(), ".picture-prev");
    /** @type {HTMLButtonElement} */
    const next = need(root(), ".picture-next");
    const many = paths.length > 1;
    prev.hidden = next.hidden = !many;
    prev.disabled = index === 0;
    next.disabled = index === paths.length - 1;
    need(root(), ".picture-hint").textContent = many ? "Swipe for the others · pinch to zoom" : "Pinch to zoom";
    if (root().ownerDocument.activeElement?.matches(":disabled")) (find(root(), ".picture-nav button:not(:disabled)") ?? need(root(), ".picture-close")).focus();
  }

  /** @param {number} step */
  function go(step) {
    if (!shown) return;
    const index = Math.min(shown.paths.length - 1, Math.max(0, shown.index + step));
    if (index !== shown.index) show(index);
  }

  /** @param {View} view */
  function setView(view) {
    if (!shown) return;
    shown.view = view;
    need(root(), ".picture-img").style.transform = view.scale === 1 ? "" : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  }

  function copyPath() {
    const at = shown;
    if (!at) return;
    const path = at.paths[at.index];
    /** @param {string} said @param {string} label */
    const say = (said, label) => {
      if (shown !== at) return;
      need(root(), ".picture-said").textContent = said;
      const key = need(root(), ".picture-copy");
      key.textContent = label;
      clearTimeout(at.copied);
      at.copied = setTimeout(() => {
        if (shown === at) key.textContent = "Copy path";
      }, COPIED_MS);
    };
    copy(path).then(
      () => say(`Copied ${path}`, "Copied"),
      () => say(`Couldn't copy ${path}.`, "Copy path"),
    );
  }

  /** @param {KeyboardEvent} event */
  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      go(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "Tab") {
      event.preventDefault();
      const keys = findAll(root(), "button:not([hidden]):not(:disabled)");
      keys[nextRow(keys.findIndex((key) => key === root().ownerDocument.activeElement), keys.length, event.shiftKey)]?.focus();
    }
  }

  /** @param {HTMLElement} stage */
  function bindGestures(stage) {
    /** @type {Map<number, Point>} */
    const pointers = new Map();
    /** @type {{ view: View, points: Map<number, Point>, multi: boolean } | null} */
    let gesture = null;
    /** @type {(Point & { at: number }) | null} */
    let lastTap = null;

    const frame = () => {
      const natural = shown?.natural;
      if (!natural || !natural.width || !natural.height) return null;
      const box = stage.getBoundingClientRect();
      const fit = Math.min(box.width / natural.width, box.height / natural.height);
      return {
        centre: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        stage: { width: box.width, height: box.height },
        content: { width: natural.width * fit, height: natural.height * fit },
      };
    };
    /** @param {Point} point @param {Point} centre */
    const fromCentre = (point, centre) => ({ x: point.x - centre.x, y: point.y - centre.y });
    const begin = () => {
      if (!shown) return;
      gesture = { view: shown.view, points: new Map(pointers), multi: (gesture?.multi ?? false) || pointers.size > 1 };
    };

    stage.addEventListener("pointerdown", (event) => {
      if (!shown) return;
      stage.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      begin();
    });

    stage.addEventListener("pointermove", (event) => {
      if (!shown || !gesture || !pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [a, b] = [...pointers.values()];
      const [a0, b0] = [...gesture.points.values()];
      const pinching = Boolean(b && b0);
      if (!pinching && gesture.view.scale === 1) return;
      const box = frame();
      if (!box) return;
      if (pinching) {
        const start = fromCentre(midpoint(a0, b0), box.centre);
        const now = fromCentre(midpoint(a, b), box.centre);
        const zoomed = zoomAt(gesture.view, gesture.view.scale * (distance(a, b) / distance(a0, b0)), start);
        setView(clampView({ ...zoomed, x: zoomed.x + now.x - start.x, y: zoomed.y + now.y - start.y }, box.stage, box.content));
      } else {
        setView(clampView({ ...gesture.view, x: gesture.view.x + a.x - a0.x, y: gesture.view.y + a.y - a0.y }, box.stage, box.content));
      }
    });

    /**
     * @param {PointerEvent} event
     * @param {boolean} cancelled
     */
    const end = (event, cancelled) => {
      if (!shown || !gesture || !pointers.has(event.pointerId)) return;
      const started = gesture.points.get(event.pointerId);
      pointers.delete(event.pointerId);
      if (pointers.size) {
        begin();
        return;
      }
      const { view, multi } = gesture;
      gesture = null;
      if (cancelled || multi || !started) return;
      const dx = event.clientX - started.x;
      const dy = event.clientY - started.y;
      const step = swipeStep(dx, dy);
      if (view.scale === 1 && step) {
        lastTap = null;
        go(step);
        return;
      }
      if (Math.hypot(dx, dy) > TAP_SLOP_PX) return;
      const tap = { x: event.clientX, y: event.clientY, at: Date.now() };
      const second = lastTap && tap.at - lastTap.at <= DOUBLE_TAP_MS && distance(tap, lastTap) <= DOUBLE_TAP_SLOP_PX;
      lastTap = second ? null : tap;
      if (!second) return;
      const box = frame();
      if (!box) return;
      setView(view.scale > 1 ? { ...FITTED } : clampView(zoomAt(view, TAP_ZOOM, fromCentre(tap, box.centre)), box.stage, box.content));
    };
    stage.addEventListener("pointerup", (event) => end(event, false));
    stage.addEventListener("pointercancel", (event) => end(event, true));
  }

  return { open, close };
}
