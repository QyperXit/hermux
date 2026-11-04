// Push notifications: where the server keeps its VAPID keys and the
// phones' push subscriptions. Both are secrets of this laptop: the private key
// signs every push, and a subscription is the address of one phone. They live
// in files of their own folder (`.push/` in the repo, git-ignored, never in the
// public copy), readable by the user only, and are never logged.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateVAPIDKeys } from "web-push";
import { isRecord } from "./herdr";

export type Vapid = { publicKey: string; privateKey: string };
export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

const MAX_ENDPOINT = 2_048;
const MAX_KEY = 256;

const isKey = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= MAX_KEY && /^[A-Za-z0-9_-]+={0,2}$/.test(value);

// A subscription as the browser gives it (`PushSubscription.toJSON()`), or
// null. The push service is always HTTPS.
export function parseSubscription(value: unknown): Subscription | null {
  if (!isRecord(value) || typeof value.endpoint !== "string" || value.endpoint.length > MAX_ENDPOINT || !isRecord(value.keys)) return null;
  const { p256dh, auth } = value.keys;
  if (!isKey(p256dh) || !isKey(auth)) return null;
  try {
    if (new URL(value.endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { endpoint: value.endpoint, keys: { p256dh, auth } };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} isn't readable JSON. Delete the folder to start afresh (see docs/setup.md).`);
  }
}

function writePrivateAtomically(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

export function createPushStore(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const vapidPath = join(dir, "vapid.json");
  const subscriptionsPath = join(dir, "subscriptions.json");

  let vapid: Vapid;
  if (existsSync(vapidPath)) {
    const saved = readJson(vapidPath);
    if (!isRecord(saved) || typeof saved.publicKey !== "string" || typeof saved.privateKey !== "string") throw new Error(`${vapidPath} has no VAPID keys. Delete the folder to start afresh (see docs/setup.md).`);
    vapid = { publicKey: saved.publicKey, privateKey: saved.privateKey };
  } else {
    vapid = generateVAPIDKeys();
    writePrivateAtomically(vapidPath, vapid);
  }

  let subscriptions: Subscription[] = [];
  if (existsSync(subscriptionsPath)) {
    const saved = readJson(subscriptionsPath);
    if (!Array.isArray(saved)) throw new Error(`${subscriptionsPath} isn't a list. Delete the folder to start afresh (see docs/setup.md).`);
    subscriptions = saved.flatMap((entry) => parseSubscription(entry) ?? []);
  }
  const save = () => writePrivateAtomically(subscriptionsPath, subscriptions);

  return {
    vapid: () => vapid,
    subscriptions: () => [...subscriptions],
    find: (endpoint: string) => subscriptions.find((subscription) => subscription.endpoint === endpoint),
    add(subscription: Subscription) {
      subscriptions = [...subscriptions.filter((saved) => saved.endpoint !== subscription.endpoint), subscription];
      save();
    },
    remove(endpoint: string) {
      const before = subscriptions.length;
      subscriptions = subscriptions.filter((subscription) => subscription.endpoint !== endpoint);
      if (subscriptions.length === before) return false;
      save();
      return true;
    },
  };
}

export type PushStore = ReturnType<typeof createPushStore>;
