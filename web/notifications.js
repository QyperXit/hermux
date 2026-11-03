// Push notifications on the page (D32, D33): whether this phone gets them, the
// bell key in the home and All headers that shows it, and the words and keys
// of the panel the bell opens. The browser asks for permission only when the
// user taps "Turn on", and subscribes through the service worker with the
// server's key. No DOM here, so the tests can import it: the page passes in
// the browser's push parts and the server calls.
import { describeError } from "./api.js";
import { icon } from "./html.js";

/**
 * on: this browser is subscribed. off: it isn't, and may be. blocked: the user
 * denied it in the browser's settings. unsupported: this browser can't.
 * @typedef {"checking" | "unsupported" | "blocked" | "off" | "on"} Status
 */

/**
 * What the bell and the panel draw. `message` is the last result, an error when `error`.
 * @typedef {{ status: Status, busy: boolean, message: string, error: boolean, demo: boolean }} View
 */

/**
 * The browser's own subscription to the push service.
 * @typedef {{ endpoint: string, toJSON(): unknown, unsubscribe(): Promise<boolean> }} BrowserSubscription
 * @typedef {{ pushManager: { getSubscription(): Promise<BrowserSubscription | null>, subscribe(options: { userVisibleOnly: boolean, applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<BrowserSubscription> } }} BrowserRegistration
 */

/**
 * The browser parts push needs, or none of them where it can't push.
 * @typedef {object} Browser
 * @property {{ getRegistration(): Promise<BrowserRegistration | undefined>, ready: Promise<BrowserRegistration> } | undefined} serviceWorker
 * @property {{ permission: string, requestPermission(): Promise<string> } | undefined} notification
 * @property {boolean} pushManager whether the browser has push at all
 * @property {() => Promise<boolean>} [isBrave] answers whether this is Brave, which has its own push setting
 */

/**
 * The server's push routes (web/api.js).
 * @typedef {object} PushApi
 * @property {() => Promise<string>} key
 * @property {(subscription: unknown) => Promise<void>} subscribe
 * @property {(endpoint: string) => Promise<void>} unsubscribe
 * @property {(endpoint: string) => Promise<void>} test
 */

// The server's public key arrives as base64url text; the browser wants its bytes.
/**
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function keyBytes(text) {
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
}

/**
 * `demo` shows the bell and its panel but never asks the browser or the server for anything.
 * @param {{ browser: Browser, api: PushApi | null, demo?: boolean }} options
 */
export function createNotifications({ browser, api, demo = false }) {
  const supported = Boolean(browser.serviceWorker && browser.notification && browser.pushManager);
  /** @type {View} */
  let view = { status: demo ? "off" : "checking", busy: false, message: "", error: false, demo };
  /** @type {Set<() => void>} */
  const listeners = new Set();

  /** @param {Partial<View>} change */
  function set(change) {
    view = { ...view, ...change };
    for (const listener of listeners) listener();
  }

  async function subscription() {
    const registration = await browser.serviceWorker?.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  }

  // Reads where things stand; never asks for permission.
  async function refresh() {
    if (demo) return;
    if (!supported) return set({ status: "unsupported" });
    if (browser.notification?.permission === "denied") return set({ status: "blocked" });
    set({ status: browser.notification?.permission === "granted" && (await subscription()) ? "on" : "off" });
  }

  // Where a refused subscribe is fixed depends on the browser.
  async function refusal() {
    return (await browser.isBrave?.()) ? BRAVE_REFUSED : REFUSED;
  }

  /** @param {unknown} error @param {string} what */
  const failed = (error, what) => `${what} ${describeError(error).message}`;

  // Only the user's tap gets here: the permission prompt belongs to it.
  async function enable() {
    if (demo || !api || !browser.notification || view.busy || view.status !== "off") return;
    set({ busy: true, message: "", error: false });
    try {
      const permission = await browser.notification.requestPermission();
      if (permission !== "granted") {
        set({ busy: false, status: permission === "denied" ? "blocked" : "off", message: permission === "denied" ? "" : "Notifications weren't allowed. Tap Turn on to try again.", error: permission !== "denied" });
        return;
      }
      const registration = await browser.serviceWorker?.ready;
      const key = await api.key();
      /** @type {BrowserSubscription | undefined} */
      let made;
      try {
        made = await registration?.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      } catch {
        set({ busy: false, status: "off", message: await refusal(), error: true });
        return;
      }
      if (!made) throw new Error("This browser didn't subscribe.");
      try {
        await api.subscribe(made.toJSON());
      } catch (error) {
        await made.unsubscribe();
        throw error;
      }
      set({ busy: false, status: "on", message: "Notifications are on." });
    } catch (error) {
      set({ busy: false, status: "off", message: failed(error, "Couldn't turn notifications on."), error: true });
    }
  }

  async function disable() {
    if (demo || !api || view.busy || view.status !== "on") return;
    set({ busy: true, message: "", error: false });
    try {
      const own = await subscription();
      // The phone stops either way; the server forgets it when it can.
      if (own) await api.unsubscribe(own.endpoint).catch(() => {});
      await own?.unsubscribe();
      set({ busy: false, status: "off", message: "Notifications are off." });
    } catch (error) {
      set({ busy: false, message: failed(error, "Couldn't turn notifications off."), error: true });
    }
  }

  async function test() {
    if (demo || !api || view.busy || view.status !== "on") return;
    set({ busy: true, message: "", error: false });
    try {
      const own = await subscription();
      if (!own) {
        set({ busy: false, status: "off", message: "This phone isn't subscribed any more. Turn notifications on again.", error: true });
        return;
      }
      await api.test(own.endpoint);
      set({ busy: false, message: "Test sent. It should arrive in a moment." });
    } catch (error) {
      set({ busy: false, message: failed(error, "The test didn't go through."), error: true });
    }
  }

  return {
    view: () => view,
    /** @param {() => void} listener */
    subscribe(listener) {
      listeners.add(listener);
    },
    refresh,
    enable,
    disable,
    test,
  };
}

const REFUSED_FIRST = "Your browser didn't allow push notifications.";
const REFUSED = `${REFUSED_FIRST} Allow notifications for this site in the browser's settings, then try again.`;
const BRAVE_REFUSED = "Brave didn't allow push notifications. In Brave, turn on Settings → Privacy and security → Use Google services for push messaging, then try again.";

// Brave answers `navigator.brave.isBrave()`; other browsers have no `brave`.
/** @param {object} navigatorLike */
export async function looksLikeBrave(navigatorLike) {
  if (!("brave" in navigatorLike) || typeof navigatorLike.brave !== "object" || navigatorLike.brave === null) return false;
  return "isBrave" in navigatorLike.brave && typeof navigatorLike.brave.isBrave === "function" && (await navigatorLike.brave.isBrave()) === true;
}

/** @type {Record<Status, string>} */
const LINES = {
  checking: "Checking…",
  on: "On. This phone gets a notice when an agent needs you or finishes.",
  off: "Off. Turn on to get a notice when an agent needs you or finishes.",
  blocked: `${REFUSED_FIRST} Allow notifications for this site in the browser's settings, then reopen the app.`,
  unsupported: "This browser can't show push notifications.",
};

/** @type {Record<Status, string>} */
const BELL_WORDS = { checking: "checking", on: "on", off: "off", blocked: "blocked", unsupported: "not supported" };

// The bell key of the home and All headers: a bell while it is on, a slashed
// bell otherwise, muted (Legend Grey) while the browser blocks or can't push.
// No new colours. Its label names the state; a tap opens the panel.
/**
 * @param {View} view
 * @param {boolean} expanded whether the panel is open
 */
export function bellHtml(view, expanded) {
  const muted = view.status === "blocked" || view.status === "unsupported";
  return `<button class="bell-key${muted ? " is-muted" : ""}" type="button" aria-label="Notifications: ${BELL_WORDS[view.status]}. Open settings" aria-haspopup="dialog" aria-controls="notify-panel" aria-expanded="${expanded}">${icon(view.status === "on" ? "i-bell" : "i-bell-off")}</button>`;
}

// What the panel says: the state in words.
/** @param {View} view */
export const statusLine = (view) => (view.demo ? "Off. The sample data never turns notifications on." : LINES[view.status]);

// The panel's keys: the one that turns it on or off, and Send test while it is on.
/** @param {View} view */
export function keysHtml(view) {
  const toggleable = !view.demo && !view.busy && (view.status === "on" || view.status === "off");
  return `<button class="act notify-toggle" type="button" data-action="${view.status === "on" ? "disable" : "enable"}"${toggleable ? "" : " disabled"}>${view.status === "on" ? "Turn off" : "Turn on"}</button>${view.status === "on" ? `<button class="act notify-test" type="button" data-action="test"${view.busy ? " disabled" : ""}>Send test</button>` : ""}`;
}
