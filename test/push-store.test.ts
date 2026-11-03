// Where the push keys and subscriptions live (D32): created on first start and
// reused, readable by the user only, kept out of git, and refusing anything
// that isn't an https push subscription.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPushStore, parseSubscription } from "../server/push-store";
import { makePush, removePushFolders, subscription } from "./support/push";

afterAll(removePushFolders);

const mode = (path: string) => statSync(path).mode & 0o777;
const ROOT = resolve(import.meta.dir, "..");

describe("the VAPID keys", () => {
  test("are made on first start and are the same on every later start", () => {
    const { dir, store } = makePush();
    const first = store.vapid();
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(first.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createPushStore(join(dir, ".push")).vapid()).toEqual(first);
  });

  test("differ between laptops: a new folder gets new keys", () => {
    expect(makePush().store.vapid()).not.toEqual(makePush().store.vapid());
  });

  test("are saved for the user alone: the folder 700, the files 600, and no stray temporary file", () => {
    const { dir, store } = makePush();
    store.add(subscription("phone"));
    const folder = join(dir, ".push");
    expect([mode(folder), mode(join(folder, "vapid.json")), mode(join(folder, "subscriptions.json"))]).toEqual([0o700, 0o600, 0o600]);
    expect(readdirSync(folder).sort()).toEqual(["subscriptions.json", "vapid.json"]);
  });

  test("a folder or file that was left open to others is closed again on the next start", () => {
    const { dir } = makePush();
    const folder = join(dir, ".push");
    chmodSync(folder, 0o755);
    createPushStore(folder);
    expect(mode(folder)).toBe(0o700);
  });

  test("a damaged key file stops the server instead of silently making new keys", () => {
    const { dir } = makePush();
    const file = join(dir, ".push", "vapid.json");
    for (const content of ["not json", "[]", '{"publicKey":"only"}']) {
      writeFileSync(file, content);
      expect(() => createPushStore(join(dir, ".push"))).toThrow("Delete the folder to start afresh");
    }
  });

  test("never appear in an error message", () => {
    const { dir, store } = makePush();
    writeFileSync(join(dir, ".push", "subscriptions.json"), "{");
    try {
      createPushStore(join(dir, ".push"));
      throw new Error("should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain(store.vapid().privateKey);
    }
  });
});

describe("the subscriptions", () => {
  test("are kept across a restart, and a phone that subscribes again replaces its entry", () => {
    const { dir, store } = makePush();
    store.add(subscription("a"));
    store.add(subscription("b"));
    store.add({ ...subscription("a"), keys: { p256dh: "new-p256dh", auth: "new-auth" } });
    const again = createPushStore(join(dir, ".push"));
    expect(again.subscriptions()).toEqual([subscription("b"), { ...subscription("a"), keys: { p256dh: "new-p256dh", auth: "new-auth" } }]);
  });

  test("one is removed by its endpoint, for good, and removing an unknown one changes nothing", () => {
    const { dir, store } = makePush({ saved: [subscription("a"), subscription("b")] });
    expect(store.remove(subscription("a").endpoint)).toBe(true);
    expect(store.remove(subscription("a").endpoint)).toBe(false);
    expect(createPushStore(join(dir, ".push")).subscriptions()).toEqual([subscription("b")]);
  });

  test("an entry that isn't a valid subscription is dropped when the file is read", () => {
    const { dir } = makePush();
    writeFileSync(join(dir, ".push", "subscriptions.json"), JSON.stringify([subscription("a"), { endpoint: "http://push.example.com/x", keys: { p256dh: "a", auth: "b" } }, 7]));
    expect(createPushStore(join(dir, ".push")).subscriptions()).toEqual([subscription("a")]);
  });

  test("parseSubscription takes the browser's own shape and nothing looser", () => {
    const good = { ...subscription("a"), expirationTime: null };
    expect(parseSubscription(good)).toEqual(subscription("a"));
    const bad: unknown[] = [
      null,
      "text",
      {},
      { endpoint: "http://push.example.com/a", keys: subscription("a").keys },
      { endpoint: "ftp://push.example.com/a", keys: subscription("a").keys },
      { endpoint: "not a url", keys: subscription("a").keys },
      { endpoint: `https://push.example.com/${"a".repeat(2100)}`, keys: subscription("a").keys },
      { endpoint: subscription("a").endpoint },
      { endpoint: subscription("a").endpoint, keys: { p256dh: "x" } },
      { endpoint: subscription("a").endpoint, keys: { p256dh: "x", auth: "" } },
      { endpoint: subscription("a").endpoint, keys: { p256dh: "x", auth: "has space" } },
      { endpoint: subscription("a").endpoint, keys: { p256dh: "x".repeat(300), auth: "y" } },
      { endpoint: 5, keys: subscription("a").keys },
    ];
    for (const value of bad) expect([value, parseSubscription(value)]).toEqual([value, null]);
  });
});

describe("keeping them out of git and out of the public copy", () => {
  test(".gitignore lists the push folder, so neither file can be committed", () => {
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n")).toContain(".push/");
  });

  test("git itself ignores both files in the default place", () => {
    const check = Bun.spawnSync(["git", "check-ignore", ".push/vapid.json", ".push/subscriptions.json"], { cwd: ROOT });
    // Where git or its repository isn't there (a plain copy of the files), there is nothing to ask.
    if (check.exitCode === 128) return;
    expect(check.stdout.toString().trim().split("\n")).toEqual([".push/vapid.json", ".push/subscriptions.json"]);
  });

  test("the server's default folder is .push at the repo root, which is that ignored one", async () => {
    const main = readFileSync(join(ROOT, "server/main.ts"), "utf8");
    expect(main).toContain('resolve(import.meta.dir, "../.push")');
  });

  test("making a store anywhere else leaves the repo's own .push untouched", () => {
    const before = existsSync(join(ROOT, ".push"));
    makePush().store.add(subscription("a"));
    expect(existsSync(join(ROOT, ".push"))).toBe(before);
  });
});
