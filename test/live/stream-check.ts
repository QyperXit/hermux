// Live check of live updates (D20) against the real Herdr session. Run it from
// inside Herdr:
//
//   bun test/live/stream-check.ts
//
// Safety: it creates ONE new tab (--no-focus) and starts the key recorder in
// it (test/live/key-recorder.ts, reporting `atomic`), which reports its own
// pane's states to herdr. Nothing is sent to any other pane. It starts its own
// Agents server on LIVE_PORT (default 8791), never 8787, which subscribes to
// herdr's events read-only. At the end it stops that server by its own process
// handle, closes only the tab it created, and checks the tab list is the same
// as before.
//
// It measures how long a status change takes to reach the page: through the
// stream (the `change` event on GET /api/events), and through the old 3 s
// list poll (GET /api/agents every 3 s, one request at a time, as the page
// polled). Both are timed from the moment the recorder is asked for the
// state, so both include the recorder's own lag (it looks every 100 ms).
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const PORT = process.env.LIVE_PORT ?? "8791";
const LOGIN = "you@example.com";
const herdrBin = process.env.HERDR_BIN_PATH || "herdr";
const workspace = process.env.HERDR_WORKSPACE_ID;
const LIST_REFRESH_MS = 3000;

if (process.env.HERDR_ENV !== "1" || !workspace) {
  console.error("Run this inside a Herdr pane (HERDR_ENV=1).");
  process.exit(1);
}
if (PORT === "8787") {
  console.error("LIVE_PORT 8787 is the default server's port. Pick another port.");
  process.exit(1);
}

const results: { check: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
};
const sleep = (ms: number) => Bun.sleep(ms);

function herdr(args: string[]) {
  const result = Bun.spawnSync([herdrBin, ...args]);
  return { exit: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
const tabIds = () => (JSON.parse(herdr(["tab", "list"]).stdout).result.tabs as { tab_id: string }[]).map((tab) => tab.tab_id).sort();
const agentOf = (pane: string) => JSON.parse(herdr(["agent", "get", pane]).stdout || "{}")?.result?.agent;

const dir = mkdtempSync(join(tmpdir(), "agents-stream-check-"));
const tabsBefore = tabIds();
let createdTab: string | undefined;
let server: Bun.Subprocess<"ignore", "pipe", "inherit"> | undefined;
let log = "";

const base = `http://127.0.0.1:${PORT}`;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// One server-sent event stream, parsed into events as they come.
async function openStream(headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { headers: { "Tailscale-User-Login": LOGIN, ...headers }, signal: controller.signal });
  const events: { at: number; type: string; data: Record<string, unknown> }[] = [];
  let comments = 0;
  let ended = false;
  if (response.status === 200 && response.body) {
    (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for await (const chunk of response.body!) {
          buffer += decoder.decode(chunk, { stream: true });
          for (let index = buffer.indexOf("\n\n"); index !== -1; index = buffer.indexOf("\n\n")) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (frame.startsWith(":")) comments++;
            const type = frame.match(/^event: (.*)$/m)?.[1];
            const data = frame.match(/^data: (.*)$/m)?.[1];
            if (type && data) events.push({ at: Date.now(), type, data: JSON.parse(data) });
          }
        }
      } catch {}
      ended = true;
    })();
  }
  return { response, events, comments: () => comments, ended: () => ended, close: () => controller.abort() };
}

async function waitFor<T>(find: () => T | undefined, ms: number) {
  const started = Date.now();
  for (;;) {
    const found = find();
    if (found !== undefined || Date.now() - started > ms) return found;
    await sleep(5);
  }
}

// The recorder's states in turn, and the status herdr reports for each:
// idle after work is herdr's "done".
const STEPS: [ask: string, expect: string[]][] = [
  ["working", ["working"]],
  ["blocked", ["blocked"]],
  ["idle", ["done", "idle"]],
  ["working", ["working"]],
  ["blocked", ["blocked"]],
  ["idle", ["done", "idle"]],
];

try {
  // The disposable pane and its recorder.
  const created = JSON.parse(herdr(["tab", "create", "--workspace", workspace, "--cwd", ROOT, "--label", "agents-stream-check", "--no-focus"]).stdout).result;
  createdTab = created.tab.tab_id as string;
  const pane = created.root_pane.pane_id as string;
  log = join(dir, "atomic.jsonl");
  const launcher = join(dir, "recorder");
  writeFileSync(launcher, `#!${process.execPath}\nimport ${JSON.stringify(join(ROOT, "test/live/key-recorder.ts"))};\n`);
  chmodSync(launcher, 0o755);
  await sleep(1000);
  herdr(["pane", "send-text", pane, `${launcher} ${log} atomic`]);
  herdr(["pane", "send-keys", pane, "enter"]);
  for (let i = 0; i < 40 && !(existsSync(log) && readFileSync(log, "utf8").includes('"ready"')); i++) await sleep(250);
  await sleep(300);
  check("created a disposable tab with an atomic recorder", agentOf(pane)?.agent === "atomic", { tab: createdTab, pane });
  const ask = (state: string) => {
    writeFileSync(`${log}.state`, state);
    return Date.now();
  };

  // The server, after the pane exists, so its first subscription names it.
  server = Bun.spawn([process.execPath, join(ROOT, "server/main.ts")], { env: { ...process.env, PORT, HERDR_BIN: herdrBin, AGENTS_ALLOWED_LOGIN: LOGIN }, stdout: "pipe", stderr: "inherit" });
  const banner = new TextDecoder().decode((await server.stdout.getReader().read()).value);
  check("server banner shows 127.0.0.1 and herdr's socket", banner.includes(`http://127.0.0.1:${PORT}`) && banner.includes("events: "), banner.trim());

  const anonymous = await fetch(`${base}/api/events`);
  const crossSite = await fetch(`${base}/api/events`, { headers: { "Tailscale-User-Login": LOGIN, "Sec-Fetch-Site": "cross-site" } });
  const post = await fetch(`${base}/api/events`, { method: "POST", headers: { "Tailscale-User-Login": LOGIN, "content-type": "application/json" }, body: "{}" });
  check("GET /api/events: 403 without the login, 403 cross-site, 405 for POST", anonymous.status === 403 && crossSite.status === 403 && post.status === 405, [anonymous.status, crossSite.status, post.status]);

  const stream = await openStream();
  check("GET /api/events streams text/event-stream", stream.response.status === 200 && stream.response.headers.get("content-type") === "text/event-stream; charset=utf-8");
  const live = await waitFor(() => stream.events.find((event) => event.type === "live" && event.data.live === true), 5000);
  check("the stream says live once the server subscribed to herdr", live !== undefined);

  // After: the stream. Each status change, timed to its change event.
  const streamed: number[] = [];
  for (const [state, expected] of STEPS) {
    const from = stream.events.length;
    const at = ask(state);
    const event = await waitFor(
      () => stream.events.slice(from).find((event) => event.type === "change" && JSON.stringify(event.data.changed ?? []).includes(`"pane_id":"${pane}"`) && expected.some((status) => JSON.stringify(event.data.changed).includes(`"agent_status":"${status}"`))),
      5000,
    );
    const output = await waitFor(() => stream.events.slice(from).find((event) => event.type === "output" && event.data.pane_id === pane), 1000);
    streamed.push(event ? event.at - at : Infinity);
    check(`stream: ${state} reached the page within 1 s, with output activity for the pane`, event !== undefined && event.at - at <= 1000 && output !== undefined, { ms: event ? event.at - at : null });
    await sleep(700);
  }

  // Before: the old page's 3 s list poll, one request at a time.
  const polled: number[] = [];
  let polling = true;
  const answers: { at: number; status: string | undefined }[] = [];
  const poller = (async () => {
    while (polling) {
      const started = Date.now();
      const response = await fetch(`${base}/api/agents`, { headers: { "Tailscale-User-Login": LOGIN } });
      const { agents } = (await response.json()) as { agents: { pane_id: string; agent_status: string }[] };
      answers.push({ at: Date.now(), status: agents.find((agent) => agent.pane_id === pane)?.agent_status });
      await sleep(Math.max(0, LIST_REFRESH_MS - (Date.now() - started)));
    }
  })();
  await sleep(LIST_REFRESH_MS + 500);
  for (const [index, [state, expected]] of STEPS.entries()) {
    // Spread the asks over the poll's rhythm, as real changes are.
    await sleep(400 * index);
    const at = ask(state);
    const seen = await waitFor(() => answers.find((answer) => answer.at > at && expected.includes(answer.status ?? "")), 8000);
    polled.push(seen ? seen.at - at : Infinity);
    check(`poll (before): ${state} reached the page`, seen !== undefined, { ms: seen ? seen.at - at : null });
    await sleep(300);
  }
  polling = false;
  await poller;
  check("latency recorded: stream (after) vs 3 s poll (before)", true, {
    streamMs: streamed,
    pollMs: polled,
    streamMedian: median(streamed),
    streamMax: Math.max(...streamed),
    pollMedian: median(polled),
    pollMax: Math.max(...polled),
  });

  // An idle stream stays open past Bun's 10 s idle timeout (the keep-alive comments).
  const comments = stream.comments();
  await sleep(12_000);
  check("an idle stream stays open past 12 s, kept alive by comments", !stream.ended() && stream.comments() > comments, { comments: stream.comments() - comments });
  stream.close();

  writeFileSync(`${log}.state`, "exit");
  for (let i = 0; i < 30 && herdr(["agent", "get", pane]).exit === 0; i++) await sleep(100);
} catch (error) {
  check("stream check ran to the end", false, String(error));
} finally {
  server?.kill();
  await server?.exited;
  if (createdTab) {
    const closed = herdr(["tab", "close", createdTab]);
    check("closed the disposable tab", closed.exit === 0 && herdr(["tab", "get", createdTab]).exit !== 0, createdTab);
  }
  const tabsAfter = tabIds();
  check("tab list after matches the tab list before", JSON.stringify(tabsAfter) === JSON.stringify(tabsBefore), { before: tabsBefore.length, after: tabsAfter.length });
  rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
