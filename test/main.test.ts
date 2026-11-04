import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeFakeHerdr } from "./fake-herdr";
import { makeFakeEvents, until } from "./support/fake-events";
import { sorted } from "./support/http";
import { CWD, makeStore, type Entry } from "./support/session-store";

const MAIN = resolve(import.meta.dir, "../server/main.ts");

const fakes: ReturnType<typeof makeFakeHerdr>[] = [];
const scratch = mkdtempSync(join(tmpdir(), "main-test-"));
afterAll(() => {
  fakes.forEach((fake) => fake.dispose());
  rmSync(scratch, { recursive: true, force: true });
});

const NO_STORE = join(scratch, "missing.sqlite");
const PUSH_DIR = join(scratch, "push");
const NO_SOCKET = join(scratch, "missing.sock");
const LOGIN = "you@example.com";

function env(overrides: Record<string, string | undefined>) {
  const next: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...process.env, ATOMIC_SESSION_STORE: NO_STORE, AGENTS_PUSH_DIR: PUSH_DIR, HERDR_SOCKET_PATH: NO_SOCKET, AGENTS_ALLOWED_LOGIN: LOGIN, ...overrides })) if (value !== undefined) next[name] = value;
  return next;
}

for (const [name, value] of [
  ["unset", undefined],
  ["empty", ""],
  ["0", "0"],
  ["true", "true"],
] as const) {
  test(`refuses to start when HERDR_ENV is ${name}, before herdr runs`, async () => {
    const fake = makeFakeHerdr();
    fakes.push(fake);
    const proc = Bun.spawn([process.execPath, MAIN], {
      env: env({ HERDR_ENV: value, HERDR_BIN: fake.bin, PORT: "0" }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), 5_000);
    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    clearTimeout(timer);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Refusing to start: HERDR_ENV is not 1");
    expect(stdout).not.toContain("listening");
    expect(fake.calls()).toEqual([]);
  });
}

for (const [name, value] of [
  ["unset", undefined],
  ["empty", ""],
] as const) {
  test(`refuses to start when AGENTS_ALLOWED_LOGIN is ${name}, before herdr runs`, async () => {
    const fake = makeFakeHerdr();
    fakes.push(fake);
    // Run from an empty folder: Bun loads .env files from the working folder, and none may supply a login.
    const proc = Bun.spawn([process.execPath, MAIN], {
      cwd: scratch,
      env: env({ HERDR_ENV: "1", AGENTS_ALLOWED_LOGIN: value, HERDR_BIN: fake.bin, PORT: "0" }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), 5_000);
    const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    clearTimeout(timer);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Refusing to start: AGENTS_ALLOWED_LOGIN is not set");
    expect(stdout).not.toContain("listening");
    expect(fake.calls()).toEqual([]);
  });
}

test("with HERDR_ENV=1 it listens on 127.0.0.1 only and enforces the login check over HTTP", async () => {
  const fake = makeFakeHerdr({ agents: [{ agent: "atomic", pane_id: "w1:p1", agent_status: "blocked", state_change_seq: 3 }] });
  fakes.push(fake);
  const proc = Bun.spawn([process.execPath, MAIN], {
    env: env({ HERDR_ENV: "1", HERDR_BIN: fake.bin, PORT: "0" }),
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = proc.stdout.getReader();
    let banner = "";
    while (!banner.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      banner += new TextDecoder().decode(value);
    }
    const match = banner.match(/listening on http:\/\/([\d.]+):(\d+)/);
    expect(match?.[1]).toBe("127.0.0.1");

    // Not reachable on any other address: another loopback address or this machine's network IPs.
    const others = [
      "127.0.0.2",
      ...Object.values(networkInterfaces())
        .flat()
        .flatMap((nic) => (nic && nic.family === "IPv4" && !nic.internal ? [nic.address] : [])),
    ];
    for (const address of others) {
      const reached = await fetch(`http://${address}:${match?.[2]}/`, { signal: AbortSignal.timeout(2_000) }).then(
        () => true,
        () => false,
      );
      expect([address, reached]).toEqual([address, false]);
    }

    const base = `http://127.0.0.1:${match?.[2]}`;

    const anonymous = await fetch(`${base}/api/agents`);
    expect(anonymous.status).toBe(403);
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(403);
    expect(fake.calls()).toEqual([]);

    const allowed = await fetch(`${base}/api/agents`, { headers: { "Tailscale-User-Login": LOGIN } });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).agents.map((agent: { pane_id: string }) => agent.pane_id)).toEqual(["w1:p1"]);
    // The blocked agent's latest line comes from one read of its recent output;
    // its tab from the tab list.
    expect(sorted(fake.calls())).toEqual(sorted([["agent", "list"], ["tab", "list"], ["agent", "read", "w1:p1", "--source", "recent-unwrapped", "--lines", "200"]]));
  } finally {
    proc.kill();
    await proc.exited;
  }
});

async function startMain(overrides: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, MAIN], { env: env({ HERDR_ENV: "1", PORT: "0", ...overrides }), stdout: "pipe", stderr: "pipe" });
  const reader = proc.stdout.getReader();
  let banner = "";
  while (!banner.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    banner += new TextDecoder().decode(value);
  }
  const port = banner.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
  return { proc, base: `http://127.0.0.1:${port}`, banner };
}

const LAST = "the latest answer is on the screen right now";
const user = (text: string): Entry => ({ type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: 1 } });
const assistant = (text: string): Entry => ({ type: "message", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } });
const AGENT = { agent: "atomic", pane_id: "w8:p1", agent_status: "idle", state_change_seq: 1, cwd: CWD };
const SCREEN = ` question number 3 about the release\n ${LAST}\n ───────\n ❯ \n (anthropic) claude-opus-5-5 • ~/weather-app\n`;

async function historyWith(store: string) {
  const fake = makeFakeHerdr({ agents: [AGENT], outputs: { [AGENT.pane_id]: SCREEN } });
  fakes.push(fake);
  const { proc, base, banner } = await startMain({ HERDR_BIN: fake.bin, ATOMIC_SESSION_STORE: store });
  try {
    expect(banner).toContain(`sessions: ${store}, read-only`);
    const response = await fetch(`${base}/api/terminals/w8%3Ap1/history`, { headers: { "Tailscale-User-Login": LOGIN } });
    expect(response.status).toBe(200);
    return await response.json();
  } finally {
    proc.kill();
    await proc.exited;
  }
}

test("main.ts reads earlier messages from the store ATOMIC_SESSION_STORE names", async () => {
  const entries = [1, 2, 3].flatMap((turn) => [user(`question number ${turn} about the release`), assistant(turn === 3 ? LAST : `answer number ${turn} for the release notes`)]);
  const body = await historyWith(makeStore([{ id: "s1", entries }]));
  expect(body.history.session).toBe("s1");
  expect(body.history.messages.map((message: { seq: number }) => message.seq)).toEqual([1, 2, 3, 4]);
});

test("a store path that doesn't exist, or a file without Atomic's tables, gives no earlier messages", async () => {
  const wrong = join(scratch, "wrong.sqlite");
  const db = new Database(wrong, { create: true });
  db.run("CREATE TABLE notes (id TEXT)");
  db.close();
  for (const store of [join(scratch, "nowhere.sqlite"), wrong]) {
    expect([store, await historyWith(store)]).toEqual([store, { history: null, reason: "unavailable" }]);
  }
});

test("main.ts subscribes to herdr's events on the socket HERDR_SOCKET_PATH names, and streams them behind the login check", async () => {
  const events = makeFakeEvents();
  const fake = makeFakeHerdr({ agents: [{ pane_id: "w1:p1", agent_status: "idle", state_change_seq: 1 }] });
  fakes.push(fake);
  const { proc, base, banner } = await startMain({ HERDR_BIN: fake.bin, HERDR_SOCKET_PATH: events.path });
  try {
    expect(banner).toContain(`events: ${events.path}`);
    await until(() => events.subscribers() === 1, 5_000, "the subscription");
    expect(events.requests.map((request) => request.method)).toEqual(["events.subscribe"]);
    expect((await fetch(`${base}/api/events`)).status).toBe(403);
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { headers: { "Tailscale-User-Login": LOGIN }, signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const reader = response.body!.getReader();
    let text = "";
    events.push("pane.agent_status_changed", { agent_status: "working", pane_id: "w1:p1", workspace_id: "w1" });
    while (!text.includes("event: output")) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('event: live\ndata: {"live":true}\n\n');
    expect(text).toContain('event: change\ndata: {"changed":[{"pane_id":"w1:p1","agent_status":"working"}],"refetch":true}\n\n');
    controller.abort();
    // The only herdr command run for it is `pane list`.
    expect(fake.calls()).toEqual([["pane", "list"]]);
  } finally {
    proc.kill();
    await proc.exited;
    events.dispose();
  }
});

// Push notifications: the real entry point makes its keys in the folder it is
// told (never in the repo), keeps them across restarts, and serves the public one.
test("makes its push keys on first start in AGENTS_PUSH_DIR, reuses them after a restart, and serves only the public key", async () => {
  const fake = makeFakeHerdr();
  fakes.push(fake);
  const pushDir = join(scratch, "push-restart");
  const keyOf = async () => {
    const { proc, base, banner } = await startMain({ HERDR_BIN: fake.bin, AGENTS_PUSH_DIR: pushDir });
    try {
      const answer = await fetch(`${base}/api/push/key`, { headers: { "Tailscale-User-Login": LOGIN } });
      expect(answer.status).toBe(200);
      const anonymous = await fetch(`${base}/api/push/key`);
      expect(anonymous.status).toBe(403);
      const saved = await fetch(`${base}/api/push/subscription`, {
        method: "POST",
        headers: { "Tailscale-User-Login": LOGIN, "content-type": "application/json" },
        body: JSON.stringify({ subscription: { endpoint: "https://push.example.com/send/phone", keys: { p256dh: "made-up-p256dh", auth: "made-up-auth" } } }),
      });
      expect(saved.status).toBe(200);
      return { key: ((await answer.json()) as { key: string }).key, banner };
    } finally {
      proc.kill();
      await proc.exited;
    }
  };
  const first = await keyOf();
  const vapid = JSON.parse(readFileSync(join(pushDir, "vapid.json"), "utf8")) as { publicKey: string; privateKey: string };
  expect(first.key).toBe(vapid.publicKey);
  expect(first.banner).not.toContain(vapid.privateKey);
  expect([statSync(pushDir).mode & 0o777, statSync(join(pushDir, "vapid.json")).mode & 0o777, statSync(join(pushDir, "subscriptions.json")).mode & 0o777]).toEqual([0o700, 0o600, 0o600]);
  expect((await keyOf()).key).toBe(first.key);
  expect(JSON.parse(readFileSync(join(pushDir, "subscriptions.json"), "utf8"))).toHaveLength(1);
});
