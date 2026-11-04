// The server stamps each copy of this file with the app shell's version and files
// (server/app-shell.ts). The version is a hash of the files, so a changed file is
// a new worker. It installs beside the old one and waits; the next open of the
// app hands over to it and reloads once, and its activation deletes the older
// caches.

import { terminalHref } from "./routes.js";

/**
 * @typedef {{ version: string, files: string[] }} Shell
 * @typedef {{ match(key: string): Promise<Response | undefined>, put(key: string, response: Response): Promise<void> }} ShellCache
 * @typedef {{ open(name: string): Promise<ShellCache>, keys(): Promise<string[]>, delete(name: string): Promise<boolean> }} ShellCaches
 * @typedef {{ postMessage(message: string): void }} WaitingWorker
 * @typedef {{ scope: string, waiting: WaitingWorker | null, showNotification(title: string, options: NotificationOptions & { renotify: boolean }): Promise<void> }} Registration
 * @typedef {{ url: string, focus(): Promise<unknown>, navigate(url: string): Promise<unknown> }} WindowClient
 * @typedef {{ matchAll(options: { type: "window", includeUncontrolled: boolean }): Promise<WindowClient[]>, openWindow(url: string): Promise<unknown> }} WindowClients
 * @typedef {object} WorkerEvent the parts of the install, activate, fetch, message, push and notificationclick events used here
 * @property {(promise: Promise<unknown>) => void} waitUntil
 * @property {Request} request
 * @property {(response: Promise<Response>) => void} respondWith
 * @property {unknown} data
 * @property {{ close(): void, data: unknown }} [notification]
 * @typedef {object} WorkerScope the parts of the service worker's global scope used here
 * @property {Registration} registration
 * @property {ShellCaches} caches
 * @property {(input: string, init: RequestInit) => Promise<Response>} fetch
 * @property {() => Promise<void>} skipWaiting
 * @property {WindowClients} clients
 * @property {(type: string, listener: (event: WorkerEvent) => void) => void} addEventListener
 */

export const CACHE_PREFIX = "agents-shell-";
export const SKIP_WAITING = "skip-waiting";

// The server replaces this with the shell's version and files.
const STAMP = /** @type {unknown} */ ("__SHELL__");

/**
 * @param {unknown} value
 * @returns {value is Shell}
 */
const isShell = (value) =>
  typeof value === "object" && value !== null && "version" in value && typeof value.version === "string" && "files" in value && Array.isArray(value.files);

/**
 * @param {Request} request
 * @param {string} scope
 * @param {Set<string>} shellUrls
 */
export function shellKey(request, scope, shellUrls) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const base = new URL(scope);
  if (url.origin !== base.origin) return null;
  const api = new URL("api", base).pathname;
  if (url.pathname === api || url.pathname.startsWith(`${api}/`)) return null;
  const bare = url.origin + url.pathname;
  const page = new URL("./", base).href;
  if (request.mode === "navigate") return bare === page || bare === new URL("index.html", base).href ? page : null;
  return url.search === "" && shellUrls.has(bare) ? bare : null;
}

// What the server's push carries (server/push.ts): a title and body, the tag
// that makes a newer notification replace an older one of the same Agent, and
// the Terminal it is about (null for the test).
/**
 * @typedef {{ title: string, body: string, tag: string, pane_id: string | null }} PushPayload
 */

/**
 * @param {unknown} data the event's data, as the browser gives it
 * @returns {PushPayload | null}
 */
function pushPayload(data) {
  if (typeof data !== "object" || data === null || !("json" in data) || typeof data.json !== "function") return null;
  /** @type {unknown} */
  let payload;
  try {
    payload = data.json();
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { title, body, tag, pane_id: paneId } = /** @type {Record<string, unknown>} */ (payload);
  if (typeof title !== "string" || typeof body !== "string" || typeof tag !== "string") return null;
  return { title, body, tag, pane_id: typeof paneId === "string" ? paneId : null };
}

// A push must always show something: a browser that sees a push show nothing
// may drop the subscription.
/** @type {PushPayload} */
const UNREADABLE = { title: "Agents", body: "Something changed.", tag: "agents", pane_id: null };

/**
 * @param {string} base
 * @param {unknown} paneId
 */
const notificationUrl = (base, paneId) => new URL(typeof paneId === "string" ? terminalHref(paneId) : "./", base).href;

/**
 * @param {WorkerScope} scope
 * @param {string} base
 */
function listenForNotifications(scope, base) {
  scope.addEventListener("push", (event) => {
    const { title, body, tag, pane_id: paneId } = pushPayload(event.data) ?? UNREADABLE;
    event.waitUntil(scope.registration.showNotification(title, { body, tag, icon: new URL("icon-192.png", base).href, data: { pane_id: paneId }, renotify: true }));
  });

  scope.addEventListener("notificationclick", (event) => {
    event.notification?.close();
    const data = /** @type {{ pane_id?: unknown } | null | undefined} */ (event.notification?.data);
    const url = notificationUrl(base, data?.pane_id);
    event.waitUntil(
      (async () => {
        const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
        const open = windows.find((client) => client.url.startsWith(base));
        if (!open) {
          await scope.clients.openWindow(url);
          return;
        }
        await open.focus();
        await open.navigate(url);
      })(),
    );
  });
}

/**
 * @param {WorkerScope} scope
 * @param {Shell} shell
 */
export function start(scope, { version, files }) {
  const cacheName = CACHE_PREFIX + version;
  const base = scope.registration.scope;
  const shellUrls = new Set(files.map((file) => new URL(file, base).href));
  /** @type {WeakSet<WaitingWorker>} */
  const reloadedForWaiting = new WeakSet();

  /** @param {string} key */
  const fresh = (key) => scope.fetch(key, { cache: "no-cache" });

  async function install() {
    const responses = await Promise.all(
      [...shellUrls].map(async (key) => {
        const response = await fresh(key);
        if (response.status !== 200) throw new Error(`${key} answered ${response.status}`);
        return /** @type {const} */ ([key, response]);
      }),
    );
    const cache = await scope.caches.open(cacheName);
    await Promise.all(responses.map(([key, response]) => cache.put(key, response)));
  }

  async function activate() {
    const names = await scope.caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== cacheName).map((name) => scope.caches.delete(name)));
  }

  /**
   * @param {string} key
   * @param {(promise: Promise<unknown>) => void} waitUntil
   */
  async function fromCache(key, waitUntil) {
    const cache = await scope.caches.open(cacheName);
    const cached = await cache.match(key);
    const update = fresh(key).then(async (response) => {
      if (response.status === 200) await cache.put(key, response.clone());
      return response;
    });
    waitUntil(update.catch(() => undefined));
    return cached ?? update;
  }

  /**
   * @param {string} key
   * @param {WorkerEvent} event
   */
  async function respond(key, event) {
    const { waiting } = scope.registration;
    if (event.request.mode === "navigate" && waiting) {
      waiting.postMessage(SKIP_WAITING);
      if (!reloadedForWaiting.has(waiting)) {
        reloadedForWaiting.add(waiting);
        return new Response("", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", refresh: "0" } });
      }
    }
    return fromCache(key, (promise) => event.waitUntil(promise));
  }

  scope.addEventListener("install", (event) => event.waitUntil(install()));
  scope.addEventListener("activate", (event) => event.waitUntil(activate()));
  scope.addEventListener("fetch", (event) => {
    const key = shellKey(event.request, base, shellUrls);
    if (key) event.respondWith(respond(key, event));
  });
  scope.addEventListener("message", (event) => {
    if (event.data === SKIP_WAITING) scope.skipWaiting();
  });
  listenForNotifications(scope, base);
}

if ("ServiceWorkerGlobalScope" in globalThis && isShell(STAMP)) start(/** @type {WorkerScope} */ (/** @type {unknown} */ (globalThis)), STAMP);
