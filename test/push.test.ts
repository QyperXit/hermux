import { afterAll, describe, expect, test } from "bun:test";
import { createPush, type Payload } from "../server/push";
import { makePush, removePushFolders, subscription } from "./support/push";

afterAll(removePushFolders);

const payload: Payload = { title: "weather-app · tab 2 needs you", body: "Which database?", pane_id: "w8:p1", tag: "pane-w8:p1" };
const A = subscription("a");
const B = subscription("b");

describe("broadcast", () => {
  test("sends the payload, exactly as given, to every saved subscription", async () => {
    const { push, fake } = makePush({ saved: [A, B] });
    await push.broadcast(payload);
    expect(fake.sent).toEqual([
      { endpoint: A.endpoint, payload },
      { endpoint: B.endpoint, payload },
    ]);
  });

  test("with no subscription it sends nothing", async () => {
    const { push, fake } = makePush();
    expect(push.hasSubscribers()).toBe(false);
    await push.broadcast(payload);
    expect(fake.attempts).toEqual([]);
  });

  test("one phone failing doesn't stop the other", async () => {
    const { push, fake } = makePush({ saved: [A, B] });
    fake.answer(A.endpoint, 400);
    await push.broadcast(payload);
    expect(fake.sent.map((entry) => entry.endpoint)).toEqual([B.endpoint]);
  });
});

describe("a subscription the push service says is gone", () => {
  for (const status of [404, 410]) {
    test(`is removed on ${status}, once, without a second try`, async () => {
      const { push, fake, store } = makePush({ saved: [A, B] });
      fake.answer(A.endpoint, status);
      await push.broadcast(payload);
      expect(fake.attempts.filter((endpoint) => endpoint === A.endpoint)).toHaveLength(1);
      expect(store.subscriptions()).toEqual([B]);
    });
  }

  for (const status of [400, 401, 403, 413]) {
    test(`is kept on ${status}, which says the request was wrong, not that the phone is gone, and isn't tried again`, async () => {
      const { push, fake, store } = makePush({ saved: [A] });
      fake.answer(A.endpoint, status);
      await push.broadcast(payload);
      expect(fake.attempts).toHaveLength(1);
      expect(store.subscriptions()).toEqual([A]);
    });
  }
});

describe("a failure that may pass", () => {
  for (const failure of [500, 502, 503, 429, "network"] as const) {
    test(`${failure} is tried once more, and the second try delivers`, async () => {
      const { push, fake, logs } = makePush({ saved: [A] });
      fake.answer(A.endpoint, failure);
      await push.broadcast(payload);
      expect(fake.attempts).toEqual([A.endpoint, A.endpoint]);
      expect(fake.sent).toEqual([{ endpoint: A.endpoint, payload }]);
      expect(logs).toEqual([]);
    });
  }

  test("is tried only once more: two failures give up, keep the subscription and log it", async () => {
    const { push, fake, store, logs } = makePush({ saved: [A] });
    fake.answer(A.endpoint, 503, 503, 503);
    await push.broadcast(payload);
    expect(fake.attempts).toHaveLength(2);
    expect(fake.sent).toEqual([]);
    expect(store.subscriptions()).toEqual([A]);
    expect(logs).toEqual(["Push: the push service didn't accept a notification (503)."]);
  });

  test("a retry that finds the subscription gone removes it", async () => {
    const { push, fake, store } = makePush({ saved: [A] });
    fake.answer(A.endpoint, 503, 410);
    await push.broadcast(payload);
    expect(store.subscriptions()).toEqual([]);
  });

  test("waits before the second try", async () => {
    const { store, fake } = makePush({ saved: [A] });
    const push = createPush({ store, send: fake.send, retryMs: 60, log: () => {} });
    fake.answer(A.endpoint, 503);
    const started = Date.now();
    await push.broadcast(payload);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });
});

describe("logs", () => {
  test("name no endpoint, key or message from the push service", async () => {
    const { push, fake, logs, store } = makePush({ saved: [A, B] });
    fake.answer(A.endpoint, 410);
    fake.answer(B.endpoint, "network", "network");
    await push.broadcast(payload);
    expect(logs).toHaveLength(2);
    const secrets = [A.endpoint, B.endpoint, A.keys.auth, B.keys.auth, A.keys.p256dh, store.vapid().privateKey, store.vapid().publicKey, "ECONNREFUSED"];
    for (const secret of secrets) expect(logs.join("\n")).not.toContain(secret);
  });
});

describe("sendTo", () => {
  test("sends to that one saved subscription and no other", async () => {
    const { push, fake } = makePush({ saved: [A, B] });
    expect(await push.sendTo(B.endpoint, payload)).toBe("sent");
    expect(fake.sent).toEqual([{ endpoint: B.endpoint, payload }]);
  });

  test("answers null for an endpoint that isn't saved, and sends nothing", async () => {
    const { push, fake } = makePush({ saved: [A] });
    expect(await push.sendTo("https://push.example.com/send/unknown", payload)).toBeNull();
    expect(fake.attempts).toEqual([]);
  });

  test("answers gone and removes it on 410, failed on another failure", async () => {
    const { push, fake, store } = makePush({ saved: [A, B] });
    fake.answer(A.endpoint, 410);
    fake.answer(B.endpoint, 400);
    expect(await push.sendTo(A.endpoint, payload)).toBe("gone");
    expect(await push.sendTo(B.endpoint, payload)).toBe("failed");
    expect(store.subscriptions()).toEqual([B]);
  });
});

describe("keys", () => {
  test("the public key is the store's, and the private key is never offered", () => {
    const { push, store } = makePush();
    expect(push.publicKey()).toBe(store.vapid().publicKey);
    expect(JSON.stringify(Object.keys(push))).not.toContain("private");
  });
});
