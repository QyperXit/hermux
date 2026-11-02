// The service worker (D29): it keeps the app's own files, so the home-screen
// app opens at once, even with the laptop out of reach (the page then shows
// its usual "Can't reach the laptop"). It never touches the API or the live
// stream: those requests go straight to the network and nothing is stored.
//
// The server stamps each copy of this file with the shell's version and files
// (server/shell.ts). The version is a hash of the files, so a changed file is
// a new worker. It installs beside the old one and waits; the next open of the
// app hands over to it and reloads once, and its activation deletes the older
// caches.

/**
 * @typedef {{ version: string, files: string[] }} Shell the version and the files, relative to the scope ("./" is the page)
 * @typedef {{ match(key: string): Promise<Response | undefined>, put(key: string, response: Response): Promise<void> }} ShellCache
 * @typedef {{ open(name: string): Promise<ShellCache>, keys(): Promise<string[]>, delete(name: string): Promise<boolean> }} ShellCaches
 * @typedef {{ postMessage(message: string): void }} WaitingWorker
 * @typedef {{ scope: string, waiting: WaitingWorker | null }} Registration
 * @typedef {object} WorkerEvent the parts of the install, activate, fetch and message events used here
 * @property {(promise: Promise<unknown>) => void} waitUntil
 * @property {Request} request
 * @property {(response: Promise<Response>) => void} respondWith
 * @property {unknown} data
 * @typedef {object} WorkerScope the parts of the service worker's global scope used here
 * @property {Registration} registration
 * @property {ShellCaches} caches
 * @property {(input: string, init: RequestInit) => Promise<Response>} fetch
 * @property {() => Promise<void>} skipWaiting
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

// The URL a request is kept under in the shell cache, or null when the worker
// leaves it alone: anything but a GET, another origin, the API and its live
// stream, a file outside the shell, and any page but the app's own (the app's
// page with any query, such as `?demo`, is the one cached page).
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

/**
 * @param {WorkerScope} scope
 * @param {Shell} shell
 */
export function start(scope, { version, files }) {
  const cacheName = CACHE_PREFIX + version;
  const base = scope.registration.scope;
  const shellUrls = new Set(files.map((file) => new URL(file, base).href));
  // The waiting workers already asked to take over, so an open reloads at most once for each.
  /** @type {WeakSet<WaitingWorker>} */
  const asked = new WeakSet();

  /** @param {string} key */
  const fresh = (key) => scope.fetch(key, { cache: "no-cache" });

  // Every file must arrive with 200, or the install fails and the old version stays.
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

  // Cache first, and the file fetched again in the background for next time.
  // Only a 200 is kept.
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

  // A new version waits until the next open of the app: that open asks it to
  // take over and reloads into it. Only once per waiting worker, so a worker
  // that never takes over can't keep the page reloading.
  /**
   * @param {string} key
   * @param {WorkerEvent} event
   */
  async function respond(key, event) {
    const { waiting } = scope.registration;
    if (event.request.mode === "navigate" && waiting) {
      waiting.postMessage(SKIP_WAITING);
      if (!asked.has(waiting)) {
        asked.add(waiting);
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
}

if ("ServiceWorkerGlobalScope" in globalThis && isShell(STAMP)) start(/** @type {WorkerScope} */ (/** @type {unknown} */ (globalThis)), STAMP);
