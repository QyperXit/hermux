import { createHttpClient } from "./api.js";
import { allAgents, homeLists, memoryStorage, recordOpened, summaryLine } from "./home.js";
import { find, fitField, need } from "./dom.js";
import { createKeyBar } from "./key-bar.js";
import { escapeHtml, icon } from "./html.js";
import { listRenderer } from "./list-render.js";
import { freshnessText } from "./live.js";
import { readerHtml, shellHtml } from "./reader.js";
import { allRowHtml, duration, homeBodyHtml, sectionHtml, shellRowHtml, terminalHref } from "./rows.js";
import {
  STATE_WORDS,
  allCountLine,
  describeTerminal,
  hasSwitcher,
  isShell,
  sendTarget,
  shellTerminals,
  retryingText,
  terminalName,
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
 * @typedef {ReturnType<typeof setTimeout> | 0} TimerId a running timer, or 0 for none
 */

// Real herdr data by default; `?demo` loads the synthetic sample data instead.
const demo = new URLSearchParams(location.search).has("demo");
const client = demo ? (await import("./sample-data.js")).createSampleClient() : createHttpClient();
// Opened completions per pane. The demo keeps its own in memory, because the
// sample data uses real pane IDs and must not touch the real ones.
const openedStore = demo ? memoryStorage() : localStorage;

const TOUCH_SETTLE_MS = 1200;

const app = need(document, "#app");

// The roster, the open Terminal, refresh and the live stream (web/session.js).
const session = createSession({
  client,
  openStream: (path) => new EventSource(path),
  timers: { setInterval: (run, ms) => setInterval(run, ms), now: () => Date.now() },
  opened: openedStore,
});

// When home and All may be redrawn: not while a touch or scroll settles.
let quietUntil = 0;
/** @type {TimerId} */
let deferredRender = 0;

const sheet = createSheet({
  app,
  root: find(document, "#switcher-root"),
  hrefOf: terminalHref,
  onSwap: swapTo,
});

// Earlier messages above the live screen (web/earlier.js).
const earlier = createEarlier({ client });

// The key bar, the key picker and the saved commands (web/key-bar.js).
const keyBar = createKeyBar({ storage: localStorage });

/** @param {Date} [date] */
function clockTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** @returns {Route} */
function parseRoute() {
  if (location.hash === "#/all") return { name: "all" };
  const match = location.hash.match(/^#\/agent\/(.+)$/);
  return match ? { name: "agent", paneId: decodeURIComponent(match[1]) } : { name: "home" };
}

// The theme control on the home and All headers shows the current choice
// and switches to the next one.
const themeButtonHtml = () => {
  const theme = storedTheme(localStorage);
  return `<button class="theme-key" type="button" aria-label="${themeLabel(theme)}">${icon(`i-theme-${theme}`)}</button>`;
};

// The page's <meta> tags, as applyTheme reads them.
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

/** @param {Snapshot} view */
function emptyListHtml(view) {
  if (!view.loaded && !view.listError) return `<p class="empty">Looking for agents…</p>`;
  if (view.agents.length) return "";
  return view.listError
    ? `<p class="empty">No agent list yet. This page retries every few seconds.</p>`
    : `<p class="empty">No agents are running. Start one in Herdr on the laptop and it shows up here.</p>`;
}

// What home and All last drew, so an unchanged refresh draws nothing.
const listView = listRenderer();

/** @param {Snapshot} view */
function renderHome(view) {
  const anyBlocked = view.agents.some((agent) => agent.agent_status === "blocked");
  const home = homeLists(view.agents, openedStore);
  /** @param {string} freshness */
  const page = (freshness) => `
    <header class="masthead">
      <div class="masthead-row">
        <span class="lamp lamp-master" data-status="${anyBlocked ? "blocked" : "idle"}" aria-hidden="true"></span>
        <h1 class="masthead-title">Agents</h1>
        ${freshness}
        ${themeButtonHtml()}
      </div>
      <p class="summary">${view.loaded ? summaryLine(home) : "&nbsp;"}</p>
    </header>
    <div class="list ${view.listError && view.agents.length ? "is-stale" : ""}">${emptyListHtml(view) || homeBodyHtml(home)}</div>`;
  const freshness = freshnessLine(view);
  const change = listView.next({ screen: "home", shown: app.dataset.screen, html: page(""), freshness });
  if (change === "freshness") need(app, ".freshness").outerHTML = freshness;
  if (change !== "rebuild") return;
  app.dataset.screen = "home";
  app.innerHTML = page(freshness);
}

/** @param {Snapshot} view */
function renderAll(view) {
  const rows = allAgents(view.agents).map(allRowHtml);
  const shells = shellTerminals(view.terminals).map(shellRowHtml);
  const body = shells.length ? sectionHtml("Agents", rows) + sectionHtml("Shells", shells) : `<div class="section-body">${rows.join("")}</div>`;
  const count = view.terminalsLoaded ? allCountLine(view.agents.length, shells.length) : `${view.agents.length} agents · newest activity first`;
  const html = `
    <header class="bar">
      <a class="back" href="#/" aria-label="Back to agents">${icon("i-back")}</a>
      <div class="identity">
        <h1 class="identity-folder">All terminals</h1>
        <p class="identity-meta">${view.listError ? escapeHtml(offlineReason(view.listError)) : view.loaded ? count : "&nbsp;"}</p>
      </div>
      ${themeButtonHtml()}
    </header>
    <div class="list ${view.listError && view.agents.length ? "is-stale" : ""}">${emptyListHtml(view) || body}</div>`;
  if (listView.next({ screen: "all", shown: app.dataset.screen, html }) !== "rebuild") return;
  app.dataset.screen = "all";
  app.innerHTML = html;
}

// The list is redrawn when a refresh changed it; the focused control (a row,
// the theme key, Back or the older-sessions key) keeps its focus across it.
function renderList() {
  const focused = app.contains(document.activeElement) ? document.activeElement : null;
  const href = focused?.getAttribute("href");
  const selector = href ? `[href="${CSS.escape(href)}"]` : focused?.classList.contains("theme-key") ? ".theme-key" : null;
  const view = session.snapshot();
  if (view.route.name === "all") renderAll(view);
  else renderHome(view);
  if (selector) find(app, selector)?.focus({ preventScroll: true });
}

// The output element and the text it shows, so an unchanged read isn't re-rendered.
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
      <span class="state"><span class="lamp" aria-hidden="true"></span>${icon("i-shell", " shell-glyph")}<span class="state-word"></span></span>
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
      <form class="composer" autocomplete="off">
        <label class="visually-hidden" for="message">Message</label>
        <textarea id="message" name="message" rows="1" placeholder="Message" enterkeyhint="enter" spellcheck="true" autocapitalize="sentences"></textarea>
        <button class="send" type="submit"><span class="send-label"></span></button>
      </form>
      <p class="blocked-note" hidden><span class="lamp" data-status="blocked" aria-hidden="true"></span><span>Waiting for your answer. Read the question above, then pick with the keys.</span></p>
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
    // Its Earlier messages stay on screen as they were, but nothing more is
    // asked for (not on a scroll up, not on a changed Live screen).
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
  // This agent's current completion counts as opened, so it leaves the Inbox.
  // While the screen stays open, a completion seen here counts as opened too.
  if (!shell) recordOpened(openedStore, terminal);
  // Earlier messages exist only for agents: a pane that turns into a
  // shell drops them, one that turns into an agent starts them.
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
  // With the switcher, the terminals key says where the other panes are; the
  // pane's ID is in the sheet's rows.
  need(app, ".identity-name").textContent = [terminalName(terminal), ...(switcher ? [] : [terminal.pane_id])].join(" · ");
  const key = need(app, ".terminals-key");
  key.hidden = !switcher;
  if (switcher) {
    need(app, ".terminals-count").textContent = terminalsLabel(siblings.length);
    key.setAttribute("aria-label", `${terminalsLabel(siblings.length)}. Switch terminal`);
  }
  need(app, ".state").dataset.status = shell ? "shell" : String(status);
  const word = shell ? "Shell" : `${(status && STATE_WORDS[status]) ?? status}${terminal.since && status !== "idle" ? ` · ${duration(terminal.since)}` : ""}`;
  need(app, ".state-word").textContent = word;
  need(app, ".send-label").textContent = view.sending ? "Sending…" : `Send to ${sendTarget(terminal)}`;
  need(app, ".composer").hidden = blocked;
  keyBar.setBlocked(blocked);
  need(app, ".blocked-note").hidden = !blocked;
}

// Only the live screen is redrawn by the refresh; earlier messages above it
// stay as they are and are never fetched again. Text that scrolls off the live
// screen is added under them (earlier.live).
/** @param {Snapshot} view */
function renderOutput({ output: { text, error }, terminal }) {
  const output = find(app, ".output");
  const live = find(app, ".live");
  if (!output || !live) return;
  const atBottom = isAtBottom(output);
  if (error && text === null) {
    live.innerHTML = `<p class="output-empty">${escapeHtml(error)}</p><a class="link-key" href="#/">${icon("i-back")}Back to agents</a>`;
    return;
  }
  if (text === null) {
    live.innerHTML = `<p class="output-empty">Reading output…</p>`;
    return;
  }
  // A plain shell's output is shown as printed, not as Atomic's transcript.
  const shell = isShell(terminal ?? { kind: "" });
  const before = renderedText.get(live);
  if (before && before.text === text && before.shell === shell) return;
  renderedText.set(live, { text, shell });
  live.innerHTML = shell ? shellHtml(text) : readerHtml(text);
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
  if (!sent) return false;
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
  if (!sent) return;
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
  latest.addEventListener("click", () => {
    output.scrollTo({ top: output.scrollHeight, behavior: "smooth" });
    latest.hidden = true;
  });

  need(app, ".terminals-key").addEventListener("click", () => {
    const { workspace, route } = session.snapshot();
    sheet.open(workspace, route.paneId);
  });

  keyBar.attach(app, { sendKey, sendText: sendPrompt, announce: notify });

  const fit = () => fitField(textarea);
  textarea.addEventListener("input", fit);
  textarea.addEventListener("focus", () => app.classList.add("is-composing"));
  textarea.addEventListener("blur", () => app.classList.remove("is-composing"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (await sendPrompt(textarea.value)) {
      textarea.value = "";
      fit();
    }
  });
}

// Another terminal of the same workspace, without a reload. The hash is
// replaced, not added to, so Back still goes straight home however many
// terminals were looked at.
/** @param {string} paneId */
function swapTo(paneId) {
  history.replaceState(null, "", terminalHref(paneId));
  onRouteChange();
  (find(app, ".terminals-key:not([hidden])") ?? find(app, ".output"))?.focus();
}

function renderListSoon() {
  // A render deferred during a touch must not draw over a terminal screen opened since.
  if (session.snapshot().route.name === "agent") return;
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

// Output already on screen that can't be refreshed says so, until a read works again.
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
  sheet.close({ restoreFocus: false });
  earlier.leave();
  session.open(parseRoute());
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
  const button = event.target instanceof Element ? event.target.closest(".theme-key") : null;
  if (button instanceof HTMLElement) switchTheme(button);
});

window.addEventListener("hashchange", onRouteChange);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") session.visible();
  else session.hidden();
});

onRouteChange();
session.start(document.visibilityState === "visible");
