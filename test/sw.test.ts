// The service worker (web/sw.js, D29), driven through its events on a fake
// worker scope: which requests it keeps and which it leaves to the network,
// stale-while-revalidate, versions and the hand-over to a new version.
import { describe, expect, test } from "bun:test";
import { CACHE_PREFIX, SKIP_WAITING, start } from "../web/sw.js";

const ORIGIN = "https://agents.example.com";
const SCOPE = `${ORIGIN}/`;
const FILES = ["./", "app.css", "app.js", "reader.js", "sample-data.js", "manifest.webmanifest", "icon.svg", "fonts/HankenGrotesk-latin-var.woff2"];

type Body = string | { status: number; body: string };

// The caches every worker version on the phone shares.
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  return {
    stores,
    async open(name: string) {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return {
        match: async (key: string) => store.get(key)?.clone(),
        put: async (key: string, response: Response) => void store.set(key, response),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    // The text kept under each key of one cache.
    async texts(name: string) {
      const store = stores.get(name);
      if (!store) return null;
      return Object.fromEntries(await Promise.all([...store].map(async ([key, response]) => [key, await response.clone().text()])));
    },
  };
}

// The laptop as the worker's fetch sees it: each URL's answer, or no answer at all.
function fakeNetwork(answers: Record<string, Body> = {}) {
  const calls: { url: string; cache: RequestCache | undefined }[] = [];
  let offline = false;
  return {
    calls,
    answers,
    goOffline: () => (offline = true),
    fetch: async (input: string, init: RequestInit) => {
      calls.push({ url: input, cache: init.cache });
      if (offline) throw new TypeError("Failed to fetch");
      const answer = answers[input] ?? { status: 404, body: "Not found\n" };
      return typeof answer === "string" ? new Response(answer, { status: 200 }) : new Response(answer.body, { status: answer.status });
    },
  };
}

const allFiles = (version: string): Record<string, string> =>
  Object.fromEntries(FILES.map((file) => [new URL(file, SCOPE).href, `${file} ${version}`]));

type Listener = (event: Parameters<Parameters<Parameters<typeof start>[0]["addEventListener"]>[1]>[0]) => void;

// One worker version: its scope, and its events as the browser fires them.
function worker(version: string, caches = fakeCaches(), network = fakeNetwork(allFiles(version))) {
  const listeners = new Map<string, Listener>();
  const registration: { scope: string; waiting: { postMessage(message: string): void; messages: string[] } | null } = { scope: SCOPE, waiting: null };
  let skipped = 0;
  start(
    {
      registration,
      caches,
      fetch: network.fetch,
      skipWaiting: async () => void skipped++,
      addEventListener: (type, listener) => void listeners.set(type, listener),
    },
    { version, files: FILES },
  );
  // Fires one event; `responded` is what the worker answered with, or null
  // when it left the request to the network.
  async function fire(type: string, { request = new Request(SCOPE), data }: { request?: Request; data?: unknown } = {}) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | null = null;
    listeners.get(type)?.({ request, data, waitUntil: (promise) => void waits.push(promise), respondWith: (response) => void (responded = response) });
    const response: Response | null = await (responded as Promise<Response> | null);
    await Promise.all(waits);
    return response;
  }
  const get = (path: string, init: RequestInit = {}) => fire("fetch", { request: new Request(new URL(path, SCOPE), init) });
  const open = (path = "./") => get(path, { mode: "navigate" });
  const newWaiting = () => {
    const messages: string[] = [];
    registration.waiting = { messages, postMessage: (message) => void messages.push(message) };
    return messages;
  };
  return { caches, network, fire, get, open, newWaiting, registration, skipped: () => skipped };
}

async function installed(version: string, caches = fakeCaches(), network?: ReturnType<typeof fakeNetwork>) {
  const sw = worker(version, caches, network);
  await sw.fire("install");
  await sw.fire("activate");
  return sw;
}

describe("installing a version", () => {
  test("keeps every shell file, fetched fresh from the laptop, in that version's cache", async () => {
    const sw = await installed("v1");
    expect(await sw.caches.texts(`${CACHE_PREFIX}v1`)).toEqual(allFiles("v1"));
    expect(sw.network.calls.map((call) => call.cache)).toEqual(FILES.map(() => "no-cache"));
  });

  test("fails and keeps nothing when any file isn't a 200, such as the login check's 403", async () => {
    for (const status of [403, 404, 500]) {
      const answers = { ...allFiles("v1"), [`${SCOPE}app.js`]: { status, body: "Forbidden\n" } };
      const sw = worker("v1", fakeCaches(), fakeNetwork(answers));
      await expect(sw.fire("install")).rejects.toThrow(`${SCOPE}app.js answered ${status}`);
      expect([status, await sw.caches.keys()]).toEqual([status, []]);
    }
  });

  test("a new version installs beside the old one, and its activation deletes older shell caches only", async () => {
    const caches = fakeCaches();
    await installed("v1", caches);
    await caches.open("someone-elses-cache");
    const v2 = worker("v2", caches);
    await v2.fire("install");
    expect((await caches.keys()).sort()).toEqual([`${CACHE_PREFIX}v1`, `${CACHE_PREFIX}v2`, "someone-elses-cache"]);
    await v2.fire("activate");
    expect((await caches.keys()).sort()).toEqual([`${CACHE_PREFIX}v2`, "someone-elses-cache"]);
    expect(await caches.texts(`${CACHE_PREFIX}v2`)).toEqual(allFiles("v2"));
  });
});

describe("cache rules", () => {
  // Requests the worker answers from the shell cache, with the key they're kept under.
  const kept: [string, RequestInit, string][] = [
    ["./", { mode: "navigate" }, "./"],
    ["./?demo", { mode: "navigate" }, "./"],
    ["index.html", { mode: "navigate" }, "./"],
    ["app.js", {}, "app.js"],
    ["reader.js", {}, "reader.js"],
    ["sample-data.js", {}, "sample-data.js"],
    ["app.css", {}, "app.css"],
    ["manifest.webmanifest", {}, "manifest.webmanifest"],
    ["icon.svg", {}, "icon.svg"],
    ["fonts/HankenGrotesk-latin-var.woff2", {}, "fonts/HankenGrotesk-latin-var.woff2"],
  ];
  // Requests the worker leaves to the network, untouched and never stored.
  const bypassed: [string, RequestInit][] = [
    ["api", {}],
    ["api/agents", {}],
    ["api/agents?lines=w1%3Ap1", {}],
    ["api/terminals", {}],
    ["api/terminals/w1%3Ap1/output", {}],
    ["api/terminals/w1%3Ap1/history?before=10", {}],
    ["api/workspaces/w1/terminals", {}],
    ["api/events", { headers: { accept: "text/event-stream" } }],
    ["api/terminals/w1%3Ap1/prompt", { method: "POST", body: "{}" }],
    ["api/terminals/w1%3Ap1/keys", { method: "POST", body: "{}" }],
    ["app.js", { method: "POST", body: "{}" }],
    ["app.js", { method: "HEAD" }],
    ["app.js?x=1", {}],
    ["https://elsewhere.example.com/app.js", {}],
    ["https://elsewhere.example.com/", { mode: "navigate" }],
    ["sw.js", {}],
    ["missing.js", {}],
    ["concepts/a.html", { mode: "navigate" }],
    ["round2/o-a-laptop.html", { mode: "navigate" }],
    ["concepts/a.css", {}],
    ["app.js", { mode: "navigate" }],
  ];

  test("the app's page, styles, modules, sample data, manifest, icons and fonts come from the shell cache", async () => {
    const sw = await installed("v1");
    sw.network.goOffline();
    for (const [path, init, key] of kept) {
      const response = await sw.get(path, init);
      expect([path, await response?.text()]).toEqual([path, `${key} v1`]);
    }
  });

  test("the API, its live stream, other methods, other sites, other files and other pages are left to the network and never stored", async () => {
    const sw = await installed("v1");
    const before = await sw.caches.texts(`${CACHE_PREFIX}v1`);
    const fetchesBefore = sw.network.calls.length;
    for (const [path, init] of bypassed) {
      expect([path, init.method ?? "GET", await sw.get(path, init)]).toEqual([path, init.method ?? "GET", null]);
    }
    expect(sw.network.calls.length).toBe(fetchesBefore);
    expect(await sw.caches.texts(`${CACHE_PREFIX}v1`)).toEqual(before);
    expect(await sw.caches.keys()).toEqual([`${CACHE_PREFIX}v1`]);
  });
});

describe("serving the shell", () => {
  test("serves the cached file at once and fetches it again for next time (stale-while-revalidate)", async () => {
    const sw = await installed("v1");
    sw.network.answers[`${SCOPE}app.js`] = "app.js newer";
    expect(await (await sw.get("app.js"))?.text()).toBe("app.js v1");
    expect(sw.network.calls.at(-1)).toEqual({ url: `${SCOPE}app.js`, cache: "no-cache" });
    expect(await (await sw.get("app.js"))?.text()).toBe("app.js newer");
  });

  test("never stores an answer that isn't a 200, such as another login's 403", async () => {
    const sw = await installed("v1");
    for (const status of [403, 404, 500, 503]) {
      sw.network.answers[`${SCOPE}app.css`] = { status, body: "Forbidden\n" };
      sw.network.answers[SCOPE] = { status, body: "Forbidden\n" };
      expect(await (await sw.get("app.css"))?.text()).toBe("app.css v1");
      expect(await (await sw.open())?.text()).toBe("./ v1");
    }
    expect(await sw.caches.texts(`${CACHE_PREFIX}v1`)).toEqual(allFiles("v1"));
  });

  test("with nothing cached, a 403 passes through to the page without being stored", async () => {
    const sw = worker("v1", fakeCaches(), fakeNetwork({ [SCOPE]: { status: 403, body: "Forbidden\n" } }));
    const response = await sw.open();
    expect([response?.status, await response?.text()]).toEqual([403, "Forbidden\n"]);
    expect(await sw.caches.texts(`${CACHE_PREFIX}v1`)).toEqual({});
  });

  test("with the laptop out of reach, the app's page and files still open from the cache", async () => {
    const sw = await installed("v1");
    sw.network.goOffline();
    expect(await (await sw.open("./?demo"))?.text()).toBe("./ v1");
    expect(await (await sw.get("app.js"))?.text()).toBe("app.js v1");
    expect(await sw.get("api/agents")).toBeNull();
    expect(await sw.caches.texts(`${CACHE_PREFIX}v1`)).toEqual(allFiles("v1"));
  });
});

describe("picking up a new version", () => {
  test("the next open asks the waiting version to take over and reloads into it, once", async () => {
    const sw = await installed("v1");
    const messages = sw.newWaiting();
    // Files the open page still loads come from its own version meanwhile.
    expect(await (await sw.get("app.js"))?.text()).toBe("app.js v1");
    expect(messages).toEqual([]);
    const reload = await sw.open("./?demo");
    expect([reload?.status, reload?.headers.get("refresh"), reload?.headers.get("cache-control"), await reload?.text()]).toEqual([200, "0", "no-store", ""]);
    expect(messages).toEqual([SKIP_WAITING]);
    // If it hasn't taken over by the time the page reloads, the page opens as
    // before instead of reloading again.
    expect(await (await sw.open())?.text()).toBe("./ v1");
    expect(messages).toEqual([SKIP_WAITING, SKIP_WAITING]);
    // A newer waiting version gets its own one reload.
    sw.newWaiting();
    expect((await sw.open())?.headers.get("refresh")).toBe("0");
  });

  test("a waiting version takes over when asked, and only then", async () => {
    const sw = worker("v2");
    await sw.fire("message", { data: "hello" });
    expect(sw.skipped()).toBe(0);
    await sw.fire("message", { data: SKIP_WAITING });
    expect(sw.skipped()).toBe(1);
  });

  test("other pages and the API still go to the network while a version waits", async () => {
    const sw = await installed("v1");
    sw.newWaiting();
    expect(await sw.get("concepts/a.html", { mode: "navigate" })).toBeNull();
    expect(await sw.get("api/events")).toBeNull();
  });
});
