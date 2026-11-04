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
    answer(endpoint: string, ...next: Answer[]) {
      answers.set(endpoint, next);
    },
  };
}

const folders: string[] = [];
export const removePushFolders = () => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));

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
