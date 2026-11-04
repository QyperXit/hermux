import { describe, expect, test } from "bun:test";
import { terminalHref } from "../web/routes.js";
import { CACHE_PREFIX, SKIP_WAITING, start } from "../web/sw.js";

const ORIGIN = "https://agents.example.com";
const SCOPE = `${ORIGIN}/`;
const FILES = ["./", "app.css", "app.js", "reader.js", "sample-data.js", "manifest.webmanifest", "icon.svg", "fonts/HankenGrotesk-latin-var.woff2"];

type Body = string | { status: number; body: string };

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
    async texts(name: string) {
      const store = stores.get(name);
      if (!store) return null;
      return Object.fromEntries(await Promise.all([...store].map(async ([key, response]) => [key, await response.clone().text()])));
    },
  };
}

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

type Shown = { title: string; options: { body?: string; tag?: string; icon?: string; data?: unknown; renotify: boolean } };
function fakeWindow(url: string) {
  const calls: string[] = [];
  return { url, calls, focus: async () => void calls.push("focus"), navigate: async (to: string) => void calls.push(`navigate ${to}`) };
}

function worker(version: string, caches = fakeCaches(), network = fakeNetwork(allFiles(version))) {
  const listeners = new Map<string, Listener>();
  const shown: Shown[] = [];
  const windows: ReturnType<typeof fakeWindow>[] = [];
  const opened: string[] = [];
  const registration: {
    scope: string;
    waiting: { postMessage(message: string): void; messages: string[] } | null;
    showNotification(title: string, options: Shown["options"]): Promise<void>;
  } = { scope: SCOPE, waiting: null, showNotification: async (title, options) => void shown.push({ title, options }) };
  let skipped = 0;
  start(
    {
      registration,
      caches,
      fetch: network.fetch,
      skipWaiting: async () => void skipped++,
      clients: { matchAll: async () => windows, openWindow: async (url) => void opened.push(url) },
      addEventListener: (type, listener) => void listeners.set(type, listener),
    },
    { version, files: FILES },
  );
  async function fire(type: string, { request = new Request(SCOPE), data, notification }: { request?: Request; data?: unknown; notification?: { close(): void; data: unknown } } = {}) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | null = null;
    listeners.get(type)?.({ request, data, notification, waitUntil: (promise) => void waits.push(promise), respondWith: (response) => void (responded = response) });
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
  return { caches, network, fire, get, open, newWaiting, registration, skipped: () => skipped, shown, windows, opened };
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
    ["api/push/key", {}],
    ["api/push/subscription", { method: "POST", body: "{}" }],
    ["api/push/test", { method: "POST", body: "{}" }],
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

describe("push notifications", () => {
  const push = (payload: unknown) => ({ data: { json: () => payload } });
  const payload = { title: "weather-app · tab 2 needs you", body: "Which database should I use?", pane_id: "w8:p1", tag: "pane-w8:p1" };

  test("a push shows its title and body as a notification for that agent, replacing an older one, with the app's icon and its Terminal in the data", async () => {
    const sw = await installed("v1");
    await sw.fire("push", push(payload));
    expect(sw.shown).toEqual([
      { title: payload.title, options: { body: payload.body, tag: payload.tag, icon: `${SCOPE}icon-192.png`, data: { pane_id: "w8:p1" }, renotify: true } },
    ]);
  });

  test("the worker is kept alive until the notification is shown", async () => {
    const sw = await installed("v1");
    let shown = false;
    sw.registration.showNotification = async () => {
      await Bun.sleep(5);
      shown = true;
    };
    await sw.fire("push", push(payload));
    expect(shown).toBe(true);
  });

  test("the test notification has no Terminal", async () => {
    const sw = await installed("v1");
    await sw.fire("push", push({ title: "Test notification", body: "Notifications are working.", pane_id: null, tag: "test" }));
    expect(sw.shown[0].options.data).toEqual({ pane_id: null });
  });

  test("text is shown as text: markup in a title or body stays as typed", async () => {
    const sw = await installed("v1");
    await sw.fire("push", push({ ...payload, title: "<b>x</b> &amp; y", body: "<img src=x onerror=alert(1)>" }));
    expect([sw.shown[0].title, sw.shown[0].options.body]).toEqual(["<b>x</b> &amp; y", "<img src=x onerror=alert(1)>"]);
  });

  test("a push it can't read still shows a notification, because a push must show something", async () => {
    for (const data of [null, {}, { json: () => { throw new SyntaxError("bad"); } }, { json: () => null }, { json: () => "text" }, { json: () => ({ title: 1, body: "b", tag: "t" }) }, { json: () => ({ title: "t", body: "b" }) }]) {
      const sw = await installed("v1");
      await sw.fire("push", { data });
      expect(sw.shown).toEqual([{ title: "Agents", options: { body: "Something changed.", tag: "agents", icon: `${SCOPE}icon-192.png`, data: { pane_id: null }, renotify: true } }]);
    }
  });

  test("a push and a tap use no cache and no network", async () => {
    const sw = await installed("v1");
    const before = sw.network.calls.length;
    await sw.fire("push", push(payload));
    await sw.fire("notificationclick", { notification: { close() {}, data: { pane_id: "w8:p1" } } });
    expect(sw.network.calls.length).toBe(before);
    expect(await sw.caches.texts(`${CACHE_PREFIX}v1`)).toEqual(allFiles("v1"));
  });

  describe("tapping a notification", () => {
    const tap = (sw: Awaited<ReturnType<typeof installed>>, data: unknown) => {
      let closed = 0;
      return sw.fire("notificationclick", { notification: { close: () => void closed++, data } }).then(() => closed);
    };

    test("closes it and opens the open app window on that Terminal, focused", async () => {
      const sw = await installed("v1");
      const app = fakeWindow(`${SCOPE}#/all`);
      sw.windows.push(app);
      expect(await tap(sw, { pane_id: "w8:p1" })).toBe(1);
      expect(app.calls).toEqual(["focus", `navigate ${SCOPE}${terminalHref("w8:p1")}`]);
      expect(sw.opened).toEqual([]);
    });

    test("opens a new window at that Terminal when the app isn't open", async () => {
      const sw = await installed("v1");
      sw.windows.push(fakeWindow("https://elsewhere.example.com/"));
      expect(await tap(sw, { pane_id: "w8:p1" })).toBe(1);
      expect(sw.opened).toEqual([`${SCOPE}${terminalHref("w8:p1")}`]);
      expect(sw.windows[0].calls).toEqual([]);
    });

    test("a pane ID with odd characters is encoded the way the app's own links are", async () => {
      const sw = await installed("v1");
      await tap(sw, { pane_id: "w1:p/2 ?#" });
      expect(sw.opened).toEqual([`${SCOPE}${terminalHref("w1:p/2 ?#")}`]);
    });

    test("the test notification, and one with no data, open the app's page", async () => {
      for (const data of [{ pane_id: null }, null, undefined, {}]) {
        const sw = await installed("v1");
        await tap(sw, data);
        expect(sw.opened).toEqual([SCOPE]);
      }
    });
  });
});
