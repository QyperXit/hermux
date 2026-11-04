import { afterEach, expect, test } from "bun:test";
import { createHttpClient } from "../web/api.js";
import { serialPoll } from "../web/poll.js";

const flush = () => Bun.sleep(0);

function gatedTask() {
  const gates: (() => void)[] = [];
  const stats = { starts: 0, inFlight: 0, maxInFlight: 0 };
  const task = async () => {
    stats.starts++;
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise<void>((resolve) => gates.push(resolve));
    stats.inFlight--;
  };
  return { task, stats, open: (index: number) => gates[index]() };
}

test("a poll called while its target is in flight starts no second request, and runs once more after it", async () => {
  const { task, stats, open } = gatedTask();
  const poll = serialPoll(task);
  const first = poll();
  poll();
  poll();
  expect(stats.starts).toBe(1);
  open(0);
  await flush();
  expect(stats.starts).toBe(2);
  open(1);
  await first;
  expect(stats).toEqual({ starts: 2, inFlight: 0, maxInFlight: 1 });
  const later = poll();
  expect(stats.starts).toBe(3);
  open(2);
  await later;
});

test("answers for one target arrive in the order they were asked for, even when the first is slow", async () => {
  const applied: number[] = [];
  let asked = 0;
  const poll = serialPoll(async () => {
    const mine = ++asked;
    await Bun.sleep(mine === 1 ? 60 : 0);
    applied.push(mine);
  });
  poll();
  await Bun.sleep(5);
  await poll();
  expect(applied).toEqual([1, 2]);
});

test("a poll for another target starts at once; a failed run doesn't block the next", async () => {
  const { task, stats, open } = gatedTask();
  let target = "w9:pD";
  const poll = serialPoll(task, () => target);
  const first = poll();
  target = "w9:pE";
  const second = poll();
  expect(stats.starts).toBe(2);
  open(0);
  open(1);
  await Promise.all([first, second]);

  let fail = true;
  const flaky = serialPoll(async () => {
    if (fail) throw new Error("boom");
  });
  await expect(flaky()).rejects.toThrow("boom");
  fail = false;
  await flaky();
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a read that hangs gives up after the read timeout, as the laptop not answering; a send has no timeout", async () => {
  const inits: (RequestInit | undefined)[] = [];
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    inits.push(init);
    return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
  }) as typeof fetch;
  const client = createHttpClient({ readTimeoutMs: 50 });
  const reads = [() => client.listAgents(), () => client.listTerminals(), () => client.listWorkspaceTerminals("w9"), () => client.readOutput("w9:pD"), () => client.readHistory("w8:p1", {})];
  for (const read of reads) {
    const outcome = await Promise.race([read().then(() => "answered", (error: unknown) => error), Bun.sleep(1_000).then(() => "still waiting after 1 s")]);
    expect(outcome).toMatchObject({ code: "unreachable", message: "The laptop didn't answer." });
  }
  client.sendPrompt("w9:pD", "hi", "pi");
  client.sendKeys("w9:pD", ["enter"], "pi");
  expect(inits.slice(-2).map((init) => init?.signal)).toEqual([undefined, undefined]);
});
