import { createHttpClient, createPushClient } from "./api.js";
import { homeLists, memoryStorage, recordOpened } from "./home.js";
import { find, fitField, need } from "./dom.js";
import { createAttachment } from "./attach.js";
import { composerHtml, drawComposer } from "./composer.js";
import { createKeyBar } from "./key-bar.js";
import { escapeHtml, icon } from "./html.js";
import { bindCopy, bindView } from "./links.js";
import { listRenderer } from "./list-render.js";
import { bellHtml, createNotifications, looksLikeBrave } from "./notifications.js";
import { createNotifyPanel } from "./notify-panel.js";
import { freshnessText } from "./live.js";
import { createPictureViewer } from "./picture-viewer.js";
import { drawLive } from "./live-render.js";
import { readerParts, shellParts } from "./reader.js";
import { parseRoute, terminalHref } from "./routes.js";
import { duration } from "./rows.js";
import { FRESHNESS_SLOT, allScreenHtml, homeScreenHtml } from "./screens.js";
import {
  STATE_WORDS,
  describeTerminal,
  hasSwitcher,
  isShell,
  sendTarget,
  retryingText,
  showTerminalName,
  terminalsLabel,
} from "./terminals.js";
import { createEarlier } from "./earlier.js";
import { isAtBottom } from "./scroll.js";
import { createSession } from "./session.js";
import { createSheet } from "./sheet.js";
import { THEME_KEY, applyTheme, nextTheme, storedTheme, themeLabel } from "./theme.js";

/**
 * @typedef {import("./types.js").RequestError} RequestError
 * @typedef {import("./session.js").Route} Route
 * @typedef {import("./session.js").Snapshot} Snapshot
 * @typedef {ReturnType<typeof setTimeout> | 0} TimerId
 */

const demo = new URLSearchParams(location.search).has("demo");
const client = demo ? (await import("./sample-data.js")).createSampleClient() : createHttpClient();
// Opened completions per pane. The demo keeps its own in memory, because the
// sample data uses real pane IDs and must not touch the real ones.
const openedStore = demo ? memoryStorage() : localStorage;

const TOUCH_SETTLE_MS = 1200;

const app = need(document, "#app");

const session = createSession({
  client,
  openStream: (path) => new EventSource(path),
  timers: { setInterval: (run, ms) => setInterval(run, ms), now: () => Date.now() },
  opened: openedStore,
});

let quietUntil = 0;
/** @type {TimerId} */
let deferredRender = 0;

const sheet = createSheet({
  app,
  root: find(document, "#switcher-root"),
  hrefOf: terminalHref,
  onSwap: swapTo,
});

const earlier = createEarlier({ client });

const notifications = createNotifications({
  browser: { serviceWorker: navigator.serviceWorker, notification: globalThis.Notification, pushManager: "PushManager" in globalThis, isBrave: () => looksLikeBrave(navigator) },
  api: demo ? null : createPushClient(),
  demo,
});

const notifyPanel = createNotifyPanel({ page: app, root: find(document, "#notify-root"), keys: document, notifications });

const keyBar = createKeyBar({ storage: localStorage });

/** @param {string} text */
const writeClipboard = async (text) => navigator.clipboard.writeText(text);

const attachment = createAttachment({ client });

const pictures = createPictureViewer({
  page: app,
  root: find(document, "#picture-root"),
  client,
  browser: { history, events: window, keys: document },
  copy: writeClipboard,
});

/** @param {Date} [date] */
function clockTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const headerKeysHtml = () => {
  const theme = storedTheme(localStorage);
  return `${bellHtml(notifications.view(), notifyPanel.isOpen())}<button class="theme-key" type="button" aria-label="${themeLabel(theme)}">${icon(`i-theme-${theme}`)}</button>`;
};

/** @type {import("./theme.js").ThemeDocument} */
const themeDocument = {
  documentElement: document.documentElement,
  querySelectorAll: (selector) => [...document.querySelectorAll(selector)].filter((meta) => meta instanceof HTMLMetaElement),
  querySelector: (selector) => {
    const meta = document.querySelector(selector);
    return meta instanceof HTMLMetaElement ? meta : null;
  },
};

/** @param {HTMLElement} button */
function switchTheme(button) {
  const theme = nextTheme(storedTheme(localStorage));
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(themeDocument, theme);
  button.setAttribute("aria-label", themeLabel(theme));
  need(button, "use").setAttribute("href", `#i-theme-${theme}`);
}

/** @param {RequestError} error */
function offlineReason(error) {
  return retryingText(error);
}

/** @param {Snapshot} view */
function freshnessLine(view) {
  if (view.listError) return `<span class="freshness is-offline">${icon("i-offline")}${escapeHtml(offlineReason(view.listError))}</span>`;
  const time = clockTime(new Date(view.updatedAt || Date.now()));
  return `<span class="freshness">${freshnessText({ streaming: view.streaming, sample: client.isSample, time })}</span>`;
}

const listView = listRenderer();

/** @param {Snapshot} view */
function renderHome(view) {
  const html = homeScreenHtml({ view, home: homeLists(view.agents, openedStore), freshness: FRESHNESS_SLOT, keys: headerKeysHtml() });
  const freshness = freshnessLine(view);
  const change = listView.next({ screen: "home", shown: app.dataset.screen, html, freshness });
  if (change === "none") return;
  if (change === "rebuild") {
    app.dataset.screen = "home";
    app.innerHTML = html;
  }
  need(app, ".freshness").outerHTML = freshness;
}

/** @param {Snapshot} view */
function renderAll(view) {
  const html = allScreenHtml({ view, keys: headerKeysHtml() });
  if (listView.next({ screen: "all", shown: app.dataset.screen, html }) !== "rebuild") return;
  app.dataset.screen = "all";
  app.innerHTML = html;
}

function renderList() {
  const focused = app.contains(document.activeElement) ? document.activeElement : null;
  const href = focused?.getAttribute("href");
  const action = focused?.getAttribute("data-action");
  const selector = href ? `[href="${CSS.escape(href)}"]` : focused?.classList.contains("theme-key") ? ".theme-key" : focused?.classList.contains("bell-key") ? ".bell-key" : action ? `[data-action="${action}"]` : null;
  const view = session.snapshot();
  if (view.route.name === "all") renderAll(view);
  else renderHome(view);
  if (selector) find(app, selector)?.focus({ preventScroll: true });
}

/** @type {WeakMap<HTMLElement, { text: string, shell: boolean }>} */
const renderedText = new WeakMap();

function renderTerminalScreen() {
  app.dataset.screen = "agent";
  app.innerHTML = `
    <header class="bar">
      <a class="back" href="#/" aria-label="Back to agents">${icon("i-back")}</a>
      <div class="identity">
        <h1 class="identity-folder"></h1>
        <p class="identity-meta">
          <span class="identity-name"></span>
          <button class="terminals-key" type="button" aria-haspopup="dialog" aria-controls="terminal-switcher" aria-expanded="false" hidden><span class="terminals-count"></span>${icon("i-chevron-down")}</button>
        </p>
      </div>
      <span class="state"><span class="lamp" aria-hidden="true"></span>${icon("i-shell", "shell-glyph")}<span class="state-word"></span></span>
    </header>
    <div class="output-wrap">
      <div class="output" role="log" aria-label="Recent output" tabindex="0">
        <div class="history" role="group" aria-label="Earlier messages" hidden>
          <p class="history-note" aria-live="polite"></p>
          <div class="history-items"></div>
          <p class="history-gap" hidden>Some messages may be missing here.</p>
          <p class="history-join"><span>Live screen</span></p>
        </div>
        <div class="live"></div>
      </div>
      <button class="latest" type="button" hidden>${icon("i-latest")}Latest</button>
    </div>
    <div class="controls">
      ${composerHtml()}
      <p class="notice" role="status" aria-live="polite"></p>
    </div>`;
  bindTerminalScreen();
}

/** @param {Snapshot} view */
function updateTerminalScreen(view) {
  if (app.dataset.screen !== "agent") return;
  const { terminal } = view;
  if (!terminal) {
    const header = view.missing;
    if (!header) return;
    if (header.error) {
      need(app, ".identity-name").textContent = header.error;
      return;
    }
    sheet.close({ restoreFocus: false });
    earlier.leave();
    need(app, ".identity-folder").textContent = "Terminal gone";
    need(app, ".identity-name").textContent = `Pane ${view.route.paneId} is no longer there.`;
    need(app, ".terminals-key").hidden = true;
    need(app, ".controls").hidden = true;
    need(app, ".state").hidden = true;
    return;
  }
  need(app, ".controls").hidden = false;
  need(app, ".state").hidden = false;
  const shell = isShell(terminal);
  if (!shell) recordOpened(openedStore, terminal);
  const [output, region, note, items, gap, join] = [".output", ".history", ".history-note", ".history-items", ".history-gap", ".history-join"].map((selector) => need(app, selector));
  earlier.open(terminal.pane_id, shell ? "shell" : "agent", { output, region, note, items, gap, join });
  const { folder } = describeTerminal(terminal);
  const status = terminal.status;
  const blocked = status === "blocked";
  const siblings = view.workspace?.terminals ?? [];
  const switcher = hasSwitcher(siblings);
  app.dataset.kind = shell ? "shell" : "agent";
  if (status) app.dataset.agentStatus = status;
  else delete app.dataset.agentStatus;
  need(app, ".identity-folder").textContent = folder;
  showTerminalName(need(app, ".identity-name"), terminal);
  const key = need(app, ".terminals-key");
  key.hidden = !switcher;
  if (switcher) {
    need(app, ".terminals-count").textContent = terminalsLabel(siblings.length);
    key.setAttribute("aria-label", `${terminalsLabel(siblings.length)}. Switch terminal`);
  }
  need(app, ".state").dataset.status = shell ? "shell" : String(status);
  const word = shell ? "Shell" : `${(status && STATE_WORDS[status]) ?? status}${terminal.since && status !== "idle" ? ` · ${duration(terminal.since)}` : ""}`;
  need(app, ".state-word").textContent = word;
  drawComposer(app, { target: sendTarget(terminal), sending: view.sending, blocked });
  keyBar.setBlocked(blocked);
  attachment.setBlocked(blocked);
}

/** @param {Snapshot} view */
function renderOutput({ output: { text, error }, terminal }) {
  const output = find(app, ".output");
  const live = find(app, ".live");
  if (!output || !live) return;
  const atBottom = isAtBottom(output);
  if (error && text === null) {
    drawLive(live, [`<p class="output-empty">${escapeHtml(error)}</p>`, `<a class="link-key" href="#/">${icon("i-back")}Back to agents</a>`]);
    return;
  }
  if (text === null) {
    drawLive(live, [`<p class="output-empty">Reading output…</p>`]);
    return;
  }
  const shell = isShell(terminal ?? { kind: "" });
  const before = renderedText.get(live);
  if (before && before.text === text && before.shell === shell) return;
  renderedText.set(live, { text, shell });
  drawLive(live, shell ? shellParts(text) : readerParts(text));
  if (atBottom || !output.dataset.seen) {
    output.scrollTop = output.scrollHeight;
    output.dataset.seen = "1";
  } else {
    need(app, ".latest").hidden = false;
  }
  earlier.live(text);
}

/**
 * @param {string} message
 * @param {{ error?: boolean }} [options]
 */
function notify(message, { error = false } = {}) {
  const notice = find(app, ".notice");
  if (!notice) return;
  delete notice.dataset.stale;
  notice.textContent = message;
  notice.classList.toggle("is-error", error);
  notice.setAttribute("role", error ? "alert" : "status");
}

/** @param {string} text */
async function sendPrompt(text) {
  const sent = await session.sendText(text);
  if (sent.status === "ignored") return false;
  if (sent.error) {
    notify(`Not sent. ${sent.error.message} Your message is still in the box.`, { error: true });
    return false;
  }
  notify(`Sent to ${sendTarget(sent.terminal)} at ${clockTime()}`);
  return true;
}

/**
 * @param {string} key
 * @param {string} label
 */
async function sendKey(key, label) {
  const sent = await session.sendKey(key);
  if (sent.status === "ignored") return;
  if (sent.error) notify(`${label} not sent. ${sent.error.message}`, { error: true });
  else notify(`Sent ${label}`);
}

function bindTerminalScreen() {
  const output = need(app, ".output");
  const latest = need(app, ".latest");
  /** @type {HTMLFormElement} */
  const form = need(app, ".composer");
  /** @type {HTMLTextAreaElement} */
  const textarea = need(form, "textarea");

  output.addEventListener("scroll", () => {
    if (isAtBottom(output)) latest.hidden = true;
  });
  bindCopy(output, { writeText: writeClipboard, announce: notify });
  bindView(output, pictures.open);
  latest.addEventListener("click", () => {
    output.scrollTo({ top: output.scrollHeight, behavior: "smooth" });
    latest.hidden = true;
  });

  need(app, ".terminals-key").addEventListener("click", () => {
    const { workspace, route } = session.snapshot();
    sheet.open(workspace, route.paneId);
  });

  keyBar.attach(app, { sendKey, sendText: sendPrompt, announce: notify });
  attachment.attach(app);

  const fit = () => fitField(textarea);
  textarea.addEventListener("input", fit);
  textarea.addEventListener("focus", () => app.classList.add("is-composing"));
  textarea.addEventListener("blur", () => app.classList.remove("is-composing"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { sent, refused } = await attachment.send(textarea.value, sendPrompt);
    if (refused) notify(refused, { error: true });
    if (sent) {
      textarea.value = "";
      fit();
    }
  });
}

/** @param {string} paneId */
function swapTo(paneId) {
  history.replaceState(null, "", terminalHref(paneId));
  onRouteChange();
  (find(app, ".terminals-key:not([hidden])") ?? find(app, ".output"))?.focus();
}

function renderListSoon() {
  const wait = quietUntil - Date.now();
  if (wait <= 0) {
    renderList();
    return;
  }
  clearTimeout(deferredRender);
  deferredRender = setTimeout(renderListSoon, wait);
}

function render() {
  const view = session.snapshot();
  if (view.route.name === "agent") {
    updateTerminalScreen(view);
    sheet.render(view.workspace, view.route.paneId);
  } else {
    renderListSoon();
  }
}

/** @param {Snapshot} view */
function noteStaleOutput({ output }) {
  const notice = find(app, ".notice");
  if (!notice) return;
  const stale = output.error !== null && output.text !== null;
  if (stale && !notice.dataset.stale) {
    notify(`Output not updated. ${output.error} Retrying…`, { error: true });
    notice.dataset.stale = "1";
  } else if (!stale && notice.dataset.stale) {
    notify("");
  }
}

session.subscribe((change) => {
  if (change === "screen") {
    render();
    return;
  }
  const view = session.snapshot();
  renderOutput(view);
  noteStaleOutput(view);
});

function onRouteChange() {
  clearTimeout(deferredRender);
  sheet.close({ restoreFocus: false });
  notifyPanel.close({ restoreFocus: false });
  pictures.close({ restoreFocus: false, popHistory: false });
  earlier.leave();
  session.open(parseRoute(location.hash));
  const view = session.snapshot();
  delete app.dataset.agentStatus;
  delete app.dataset.kind;
  app.classList.remove("is-composing", "is-editing-keys", "is-editing-commands");
  if (view.route.name === "agent") {
    renderTerminalScreen();
    updateTerminalScreen(view);
    renderOutput(view);
  } else {
    quietUntil = 0;
    renderList();
    window.scrollTo(0, 0);
  }
}

const holdStill = () => {
  if (session.snapshot().route.name !== "agent") quietUntil = Date.now() + TOUCH_SETTLE_MS;
};
window.addEventListener("touchstart", holdStill, { passive: true });
window.addEventListener("touchmove", holdStill, { passive: true });
window.addEventListener("scroll", holdStill, { passive: true });

app.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const theme = target?.closest(".theme-key");
  if (theme instanceof HTMLElement) switchTheme(theme);
  const bell = target?.closest(".bell-key");
  if (bell instanceof HTMLElement) notifyPanel.open(bell);
});

notifications.subscribe(() => {
  if (session.snapshot().route.name !== "agent") renderList();
});

window.addEventListener("hashchange", onRouteChange);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    session.visible();
    notifications.refresh();
  } else session.hidden();
});

onRouteChange();
session.start(document.visibilityState === "visible");
notifications.refresh();

navigator.serviceWorker?.register("sw.js", { type: "module" }).catch(() => {});
