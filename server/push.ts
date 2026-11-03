// Push notifications (D32): sends a payload to the phones that opted in, through
// each phone's own push service (Web Push, signed with this laptop's VAPID key
// and encrypted so the push service can't read it). A push service that answers
// 404 or 410 says the subscription is dead: it is forgotten. A failure that may
// pass is tried once more. What is logged never names a subscription or a key.
import { sendNotification } from "web-push";
import { isRecord } from "./herdr";
import type { PushStore, Subscription } from "./push-store";

// What a notification carries to the page's service worker (web/sw.js).
export type Payload = { title: string; body: string; pane_id: string | null; tag: string };

// Sends one encrypted payload to one subscription; a failure throws, carrying
// the push service's status code when it gave one.
export type Send = (subscription: Subscription, payload: string) => Promise<void>;

const DEFAULT_SUBJECT = "mailto:hermux@localhost";
// How long the push service keeps a notification for a phone that is off: an
// agent that needed you an hour ago is no longer news.
const TTL_SECONDS = 60 * 60;
const SEND_TIMEOUT_MS = 10_000;
const RETRY_MS = 2_000;

export const webPushSend =
  (store: PushStore, subject = DEFAULT_SUBJECT): Send =>
  async (subscription, payload) => {
    await sendNotification(subscription, payload, { vapidDetails: { subject, ...store.vapid() }, TTL: TTL_SECONDS, urgency: "high", timeout: SEND_TIMEOUT_MS });
  };

const statusOf = (error: unknown) => (isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : undefined);

// Dead for good: the push service has forgotten this subscription.
const isGone = (status: number | undefined) => status === 404 || status === 410;
// May pass: no answer at all, throttling or a push service having trouble.
const isTransient = (status: number | undefined) => status === undefined || status === 429 || status >= 500;

export type Delivery = "sent" | "gone" | "failed";

export function createPush({ store, send, retryMs = RETRY_MS, log = console.error }: { store: PushStore; send: Send; retryMs?: number; log?: (message: string) => void }) {
  async function attempt(subscription: Subscription, text: string): Promise<{ status?: number } | null> {
    try {
      await send(subscription, text);
      return null;
    } catch (error) {
      return { status: statusOf(error) };
    }
  }

  async function deliver(subscription: Subscription, payload: Payload): Promise<Delivery> {
    const text = JSON.stringify(payload);
    let failure = await attempt(subscription, text);
    if (failure && isTransient(failure.status)) {
      await Bun.sleep(retryMs);
      failure = await attempt(subscription, text);
    }
    if (!failure) return "sent";
    if (isGone(failure.status)) {
      store.remove(subscription.endpoint);
      log("Push: a subscription expired (the push service answered it is gone) and was removed.");
      return "gone";
    }
    log(`Push: the push service didn't accept a notification (${failure.status ?? "no answer"}).`);
    return "failed";
  }

  return {
    publicKey: () => store.vapid().publicKey,
    subscribe: (subscription: Subscription) => store.add(subscription),
    unsubscribe: (endpoint: string) => store.remove(endpoint),
    hasSubscribers: () => store.subscriptions().length > 0,
    // The payload to every subscription.
    async broadcast(payload: Payload) {
      await Promise.all(store.subscriptions().map((subscription) => deliver(subscription, payload)));
    },
    // The payload to one saved subscription: null when none is saved under that endpoint.
    async sendTo(endpoint: string, payload: Payload): Promise<Delivery | null> {
      const subscription = store.find(endpoint);
      return subscription ? deliver(subscription, payload) : null;
    },
  };
}

export type Push = ReturnType<typeof createPush>;
