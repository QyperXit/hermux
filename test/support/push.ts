// Stand-ins for Web Push (D32): a send that records what it was given and
// answers as a push service would, and subscriptions in the browser's shape.
// The keys are made-up text, not real keys.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPush } from "../../server/push";
import { createPushStore, type Subscription } from "../../server/push-store";
import type { Payload, Send } from "../../server/push";

export const subscription = (name: string): Subscription => ({
  endpoint: `https://push.example.com/send/${name}`,
  keys: { p256dh: `p256dh-of-${name}`, auth: `auth-of-${name}` },
});

// What the push service answers a send to an endpoint with: nothing wrong
// (omitted), or a status code, or no answer at all ("network").
type Answer = number | "network";

export function fakeSend() {
  const sent: { endpoint: string; payload: Payload }[] = [];
  const attempts: string[] = [];
  const answers = new Map<string, Answer[]>();
  const send: Send = async (target, text) => {
    attempts.push(target.endpoint);
    const answer = answers.get(target.endpoint)?.shift();
    if (answer === "network") throw Object.assign(new Error(`connect ECONNREFUSED ${target.endpoint}`), { code: "ECONNREFUSED" });
    if (answer !== undefined) throw Object.assign(new Error(`push service answered ${answer} for ${target.endpoint}`), { statusCode: answer, body: target.keys.auth });
    sent.push({ endpoint: target.endpoint, payload: JSON.parse(text) });
  };
  return {
    send,
    sent,
    attempts,
    // The next sends to this endpoint answer in turn with these.
    answer(endpoint: string, ...next: Answer[]) {
      answers.set(endpoint, next);
    },
  };
}

const folders: string[] = [];
export const removePushFolders = () => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));

// A store in a temporary folder, a push over it with a fake send, and what it logged.
export function makePush({ saved = [] }: { saved?: Subscription[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "push-test-"));
  folders.push(dir);
  const store = createPushStore(join(dir, ".push"));
  for (const one of saved) store.add(one);
  const fake = fakeSend();
  const logs: string[] = [];
  const push = createPush({ store, send: fake.send, retryMs: 0, log: (message) => void logs.push(message) });
  return { dir, store, push, fake, logs };
}
