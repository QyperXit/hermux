// The push routes (D32) through the real app: the login check, the refusal of
// other sites, JSON-only bodies, what each route saves and sends, and that the
// private key never leaves the laptop in an answer.
import { afterAll, describe, expect, test } from "bun:test";
import { createApp } from "../server/app";
import { createHerdr } from "../server/herdr";
import { WEB } from "./support/agents";
import { ALLOWED_LOGIN } from "./support/http";
import { makePush, removePushFolders, subscription } from "./support/push";

afterAll(removePushFolders);

const A = subscription("a");
const B = subscription("b");

function setup(options: Parameters<typeof makePush>[0] = {}, { withPush = true }: { withPush?: boolean } = {}) {
  const made = makePush(options);
  // The push routes never run herdr: if one did, this binary doesn't exist and the request would fail.
  const app = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: ALLOWED_LOGIN, webRoot: WEB, push: withPush ? made.push : undefined });
  const request = (method: string, path: string, { body, login = ALLOWED_LOGIN, headers = {}, contentType = "application/json" }: { body?: unknown; login?: string | null; headers?: Record<string, string>; contentType?: string | null } = {}) => {
    const all = new Headers(headers);
    if (login !== null) all.set("Tailscale-User-Login", login);
    if (body !== undefined && contentType !== null) all.set("content-type", contentType);
    return app(new Request(`http://127.0.0.1:8787${path}`, { method, headers: all, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }));
  };
  return { ...made, request };
}

// Every route, with a body that would be accepted.
const ROUTES: [method: string, path: string, body?: unknown][] = [
  ["GET", "/api/push/key"],
  ["POST", "/api/push/subscription", { subscription: A }],
  ["DELETE", "/api/push/subscription", { endpoint: A.endpoint }],
  ["POST", "/api/push/test", { endpoint: A.endpoint }],
];

describe("the guards every push route has", () => {
  for (const [method, path, body] of ROUTES) {
    test(`${method} ${path}: 403 without the login or with another one, and nothing is saved or sent`, async () => {
      const { request, store, fake } = setup({ saved: [A] });
      for (const login of [null, "other@example.com", ""]) {
        const response = await request(method, path, { body, login });
        expect([login, response.status]).toEqual([login, 403]);
      }
      expect(store.subscriptions()).toEqual([A]);
      expect(fake.attempts).toEqual([]);
    });

    test(`${method} ${path}: 403 from another site, whatever the answer would have been`, async () => {
      const { request, store, fake } = setup({ saved: [A] });
      for (const site of ["cross-site", "same-site"]) {
        const response = await request(method, path, { body, headers: { "sec-fetch-site": site } });
        expect([site, response.status, ((await response.json()) as { error: { code: string } }).error.code]).toEqual([site, 403, "cross_site_request"]);
      }
      expect(store.subscriptions()).toEqual([A]);
      expect(fake.attempts).toEqual([]);
    });

    test(`${method} ${path}: this page's own requests (same-origin, or none) are let through`, async () => {
      for (const site of ["same-origin", "none", undefined]) {
        const { request } = setup({ saved: [A] });
        const response = await request(method, path, { body, headers: site ? { "sec-fetch-site": site } : {} });
        expect([site, response.status]).toEqual([site, 200]);
      }
    });

    test(`${method} ${path}: without the push module it is an unknown route`, async () => {
      const { request } = setup({}, { withPush: false });
      expect((await request(method, path, { body })).status).toBe(404);
    });
  }

  for (const [method, path, body] of ROUTES.filter(([method]) => method !== "GET")) {
    test(`${method} ${path}: only JSON is accepted (415 for a form, text/plain or no type), and nothing is saved or sent`, async () => {
      const { request, store, fake } = setup({ saved: [A] });
      for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", null]) {
        const response = await request(method, path, { body: JSON.stringify(body), contentType });
        expect([contentType, response.status]).toEqual([contentType, 415]);
      }
      expect(store.subscriptions()).toEqual([A]);
      expect(fake.attempts).toEqual([]);
    });

    test(`${method} ${path}: a body that isn't a JSON object is 400`, async () => {
      const { request } = setup({ saved: [A] });
      for (const text of ["{", "[]", "7", "null", '"text"']) {
        const response = await request(method, path, { body: text });
        expect([text, response.status]).toEqual([text, 400]);
      }
    });
  }

  test("other methods are 405, and an unknown push route is 404", async () => {
    const { request } = setup();
    expect((await request("POST", "/api/push/key", { body: {} })).status).toBe(405);
    expect((await request("GET", "/api/push/subscription")).status).toBe(405);
    expect((await request("PUT", "/api/push/subscription", { body: {} })).status).toBe(405);
    expect((await request("GET", "/api/push/test")).status).toBe(405);
    expect((await request("GET", "/api/push")).status).toBe(404);
    expect((await request("GET", "/api/push/other")).status).toBe(404);
    expect((await request("GET", "/api/push/key/extra")).status).toBe(404);
  });
});

describe("GET /api/push/key", () => {
  test("answers the public key, and the private key appears nowhere in any answer", async () => {
    const { request, store } = setup({ saved: [A] });
    const key = await request("GET", "/api/push/key");
    expect(key.headers.get("cache-control")).toBe("no-store");
    const answers = [key.clone(), await request("POST", "/api/push/subscription", { body: { subscription: B } }), await request("POST", "/api/push/test", { body: { endpoint: A.endpoint } }), await request("DELETE", "/api/push/subscription", { body: { endpoint: B.endpoint } })];
    expect(await key.json()).toEqual({ key: store.vapid().publicKey });
    for (const response of answers) expect(await response.text()).not.toContain(store.vapid().privateKey);
  });
});

describe("POST /api/push/subscription", () => {
  test("saves the phone's subscription (and replaces it when it subscribes again)", async () => {
    const { request, store } = setup();
    expect((await request("POST", "/api/push/subscription", { body: { subscription: A } })).status).toBe(200);
    await request("POST", "/api/push/subscription", { body: { subscription: { ...B, expirationTime: null } } });
    await request("POST", "/api/push/subscription", { body: { subscription: A } });
    expect(store.subscriptions()).toEqual([B, A]);
  });

  test("refuses what isn't a subscription with an https endpoint and its keys: 400, nothing saved", async () => {
    const { request, store } = setup();
    for (const subscription of [undefined, null, "text", {}, { endpoint: "http://push.example.com/a", keys: A.keys }, { endpoint: A.endpoint }, { endpoint: A.endpoint, keys: { p256dh: "x" } }]) {
      const response = await request("POST", "/api/push/subscription", { body: { subscription } });
      expect([subscription, response.status]).toEqual([subscription, 400]);
    }
    expect(store.subscriptions()).toEqual([]);
  });
});

describe("DELETE /api/push/subscription", () => {
  test("forgets that phone only, and a phone that isn't saved is not an error", async () => {
    const { request, store } = setup({ saved: [A, B] });
    expect((await request("DELETE", "/api/push/subscription", { body: { endpoint: A.endpoint } })).status).toBe(200);
    expect(store.subscriptions()).toEqual([B]);
    expect((await request("DELETE", "/api/push/subscription", { body: { endpoint: A.endpoint } })).status).toBe(200);
    expect(store.subscriptions()).toEqual([B]);
  });

  test("needs an endpoint: 400", async () => {
    const { request, store } = setup({ saved: [A] });
    for (const body of [{}, { endpoint: "" }, { endpoint: 5 }]) expect((await request("DELETE", "/api/push/subscription", { body })).status).toBe(400);
    expect(store.subscriptions()).toEqual([A]);
  });
});

describe("POST /api/push/test", () => {
  test("sends a test notification to the caller's subscription only", async () => {
    const { request, fake } = setup({ saved: [A, B] });
    expect((await request("POST", "/api/push/test", { body: { endpoint: B.endpoint } })).status).toBe(200);
    expect(fake.sent).toEqual([{ endpoint: B.endpoint, payload: { title: "Test notification", body: "Notifications are working.", pane_id: null, tag: "test" } }]);
  });

  test("404 when the server doesn't have that subscription, and sends nothing", async () => {
    const { request, fake } = setup({ saved: [A] });
    const response = await request("POST", "/api/push/test", { body: { endpoint: B.endpoint } });
    expect([response.status, ((await response.json()) as { error: { code: string } }).error.code]).toEqual([404, "subscription_not_found"]);
    expect(fake.attempts).toEqual([]);
  });

  test("needs an endpoint: 400", async () => {
    const { request, fake } = setup({ saved: [A] });
    for (const body of [{}, { endpoint: "" }, { endpoint: 5 }, { subscription: A }]) expect((await request("POST", "/api/push/test", { body })).status).toBe(400);
    expect(fake.attempts).toEqual([]);
  });

  test("a subscription the push service says is gone (410) is removed and the page is told it isn't saved", async () => {
    const { request, fake, store } = setup({ saved: [A, B] });
    fake.answer(A.endpoint, 410);
    const response = await request("POST", "/api/push/test", { body: { endpoint: A.endpoint } });
    expect(response.status).toBe(404);
    expect(store.subscriptions()).toEqual([B]);
  });

  test("a push service that fails is 502 push_failed, and the subscription stays", async () => {
    const { request, fake, store } = setup({ saved: [A] });
    fake.answer(A.endpoint, 503, 503);
    const response = await request("POST", "/api/push/test", { body: { endpoint: A.endpoint } });
    expect([response.status, ((await response.json()) as { error: { code: string } }).error.code]).toEqual([502, "push_failed"]);
    expect(store.subscriptions()).toEqual([A]);
  });
});
