// Live check against the real Herdr session. Run it from inside Herdr:
//
//   bun test/live/live-check.ts
//
// It creates TWO new tabs (--no-focus) and runs the key recorder in each.
// One recorder reports itself as `pi`, a herdr built-in kind, and is launched
// through a script named `pi`, so herdr's own `agent prompt` and `agent
// send-keys` accept it. The other reports `atomic`, like Atomic's agents, so the
// server must use its guarded `pane send-text` / `pane send-keys` path.
// Each recorder is started by typing its command into its new tab's own shell
// (`pane send-text`, then Enter); `pane run` is never used. Apart from two raw
// herdr probes on the atomic pane, prompts and keys go only through the Agents
// server's terminal routes (the per-agent routes are gone). The Inbox checks
// drive the atomic recorder's own states and printed text through files.
//
// It also creates a third --no-focus tab with a plain shell, and types into
// it ONLY through the server's terminal routes: a command line with quotes, $
// and newlines that bash must run exactly once as typed, then a raw byte logger
// (it reports no agent) to check the exact bytes of a message, Ctrl+C and Enter.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { allAgents, homeLists, memoryStorage, recordFirstSight, recordOpened } from "../../web/home.js";
import { LATEST_LINE_STATUSES, RECENT_IDLE_READS } from "../../server/roster";
import { createdPanes } from "./created-panes";

const ROOT = resolve(import.meta.dir, "../..");
const PORT = process.env.LIVE_PORT ?? "8790";
const LOGIN = "you@example.com";
const herdrBin = process.env.HERDR_BIN_PATH || "herdr";
const workspace = process.env.HERDR_WORKSPACE_ID;

if (process.env.HERDR_ENV !== "1" || !workspace) {
  console.error("Run this inside a Herdr pane (HERDR_ENV=1).");
  process.exit(1);
}

const results: { check: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
};
const sleep = (ms: number) => Bun.sleep(ms);

const guard = createdPanes();

function herdr(args: string[]) {
  const result = Bun.spawnSync([herdrBin, ...guard.herdrArgs(args)]);
  return { exit: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

const tabIds = () => (JSON.parse(herdr(["tab", "list"]).stdout).result.tabs as { tab_id: string }[]).map((tab) => tab.tab_id).sort();
const agentOf = (pane: string) => JSON.parse(herdr(["agent", "get", pane]).stdout || "{}")?.result?.agent;

const dir = mkdtempSync(join(tmpdir(), "agents-live-check-"));
const createdTabs: string[] = [];

const chunks = (log: string) =>
  existsSync(log)
    ? readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.hex !== undefined)
        .map((entry) => entry.hex as string)
    : [];

async function bytesAfter(log: string, action: () => Promise<unknown> | unknown) {
  const before = chunks(log).length;
  const outcome = await action();
  let seen = before;
  let quietSince = Date.now();
  const started = Date.now();
  while (Date.now() - quietSince < 600 && Date.now() - started < 5000) {
    await sleep(50);
    const now = chunks(log).length;
    if (now !== seen) {
      seen = now;
      quietSince = Date.now();
    }
  }
  return { outcome, hex: chunks(log).slice(before).join("") };
}

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const pasted = (text: string) => `1b5b3230307e${hex(text)}1b5b3230317e0d`;
const count = (haystack: string, needle: string) => {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
};

async function startRecorder(kind: string, launcherName: string, { exec }: { exec: boolean }) {
  const created = herdr(["tab", "create", "--workspace", workspace!, "--cwd", ROOT, "--label", `agents-live-check-${kind}`, "--no-focus"]);
  const { result } = JSON.parse(created.stdout);
  createdTabs.push(result.tab.tab_id);
  guard.addTab(result.tab.tab_id);
  const pane = result.root_pane.pane_id as string;
  guard.addPane(pane);
  const log = join(dir, `${kind}.jsonl`);
  const launcher = join(dir, launcherName);
  writeFileSync(launcher, `#!${process.execPath}\nimport ${JSON.stringify(join(ROOT, "test/live/key-recorder.ts"))};\n`);
  chmodSync(launcher, 0o755);
  await sleep(1000);
  herdr(["pane", "send-text", pane, `${exec ? "exec " : ""}${launcher} ${log} ${kind}`]);
  herdr(["pane", "send-keys", pane, "enter"]);
  for (let i = 0; i < 40 && !(existsSync(log) && readFileSync(log, "utf8").includes('"ready"')); i++) await sleep(250);
  await sleep(300);
  check(`created disposable tab with a ${kind} recorder`, agentOf(pane)?.agent === kind, { tab: result.tab.tab_id, pane, kind: agentOf(pane)?.agent });
  return { pane, log };
}

async function waitForStatus(pane: string, status: string) {
  for (let i = 0; i < 20; i++) {
    if (agentOf(pane)?.agent_status === status) return;
    await sleep(100);
  }
}

async function startShell() {
  const created = herdr(["tab", "create", "--workspace", workspace!, "--cwd", ROOT, "--label", "agents-live-check-shell", "--no-focus"]);
  const { result } = JSON.parse(created.stdout);
  createdTabs.push(result.tab.tab_id);
  guard.addTab(result.tab.tab_id);
  await sleep(1500);
  const pane = result.root_pane.pane_id as string;
  guard.addPane(pane);
  check("created a disposable tab with a plain shell (no agent)", herdr(["agent", "get", pane]).exit !== 0, { tab: result.tab.tab_id, pane });
  return pane;
}

async function waitUntil(ok: () => boolean, ms = 5000) {
  const started = Date.now();
  while (!ok() && Date.now() - started < ms) await sleep(100);
  return ok();
}

const tabsBefore = tabIds();
let server: Bun.Subprocess<"ignore", "pipe", "inherit"> | undefined;

try {
  const pi = await startRecorder("pi", "pi", { exec: true });
  const atomic = await startRecorder("atomic", "recorder", { exec: false });

  server = Bun.spawn([process.execPath, join(ROOT, "server/main.ts")], {
    env: { ...process.env, PORT, HERDR_BIN: herdrBin, AGENTS_ALLOWED_LOGIN: LOGIN },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = server.stdout.getReader();
  const banner = new TextDecoder().decode((await reader.read()).value);
  check("server banner shows 127.0.0.1", banner.includes(`http://127.0.0.1:${PORT}`), banner.trim());

  const listening = Bun.spawnSync(["ss", "-ltnH", `sport = :${PORT}`]).stdout.toString().trim().split("\n").filter(Boolean);
  check(
    "only 127.0.0.1 listens on the port",
    listening.length > 0 && listening.every((line) => line.includes(`127.0.0.1:${PORT}`)),
    listening.map((line) => line.replace(/\s+/g, " ")),
  );

  const base = `http://127.0.0.1:${PORT}`;
  const api = async (method: string, path: string, body?: unknown, login: string | null = LOGIN) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (login !== null) headers["Tailscale-User-Login"] = login;
    const response = await fetch(`${base}${guard.route(method, path)}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, json } as { status: number; json: { error?: { code: string }; [field: string]: unknown } };
  };
  const statusOf = (outcome: unknown) => (outcome as { status: number }).status;
  const codeOf = (outcome: unknown) => (outcome as { json: { error?: { code: string } } }).json?.error?.code;

  check("403 without the login header", (await api("GET", "/api/agents", undefined, null)).status === 403);
  check("403 with another login", (await api("GET", "/", undefined, "someone@example.com")).status === 403);

  const list = await api("GET", "/api/agents");
  const agents = list.json.agents as { pane_id: string; since?: number; agent: string; agent_status: string; cwd: string; terminal_title_stripped: string; state_change_seq?: number; latest_line?: string | null }[];
  const live = JSON.parse(herdr(["agent", "list"]).stdout).result.agents as { pane_id: string }[];
  check(
    "list matches herdr agent list (same panes)",
    list.status === 200 && JSON.stringify(agents.map((a) => a.pane_id).sort()) === JSON.stringify(live.map((a) => a.pane_id).sort()),
    { count: agents.length },
  );
  check("no agent has a time on the server's first look", agents.every((a) => a.since === undefined), agents.filter((a) => a.since !== undefined).map((a) => a.pane_id));
  const active = agents.filter((a) => LATEST_LINE_STATUSES.has(a.agent_status));
  const recentIdle = agents
    .filter((a) => a.agent_status === "idle")
    .sort((a, b) => (b.state_change_seq ?? -Infinity) - (a.state_change_seq ?? -Infinity))
    .slice(0, RECENT_IDLE_READS);
  const chrome = (line: string) =>
    /^\s*❯/.test(line) ||
    /esc to interrupt/.test(line) ||
    /^[\s─━═-]*$/.test(line) ||
    /%\/[\d.]+[kMB]?( \(auto\))?\s*$/.test(line) ||
    /^↑[\d.]+[kMB]? • /.test(line) ||
    /^\S \S.*(\.\.\.|…)$/.test(line) ||
    / • ~\//.test(line);
  const read = [...active, ...recentIdle];
  check(
    `latest_line on every active agent and the ${RECENT_IDLE_READS} most recent idle ones only, never Atomic chrome`,
    read.every((a) => a.latest_line === null || (typeof a.latest_line === "string" && !chrome(a.latest_line))) &&
      agents.every((a) => read.includes(a) === "latest_line" in a),
    { read: read.length, idle: agents.length - active.length, lines: read.map((a) => `${a.pane_id}: ${a.latest_line}`) },
  );
  const ordered = allAgents(agents) as typeof agents;
  const seqOf = (a: (typeof agents)[number]) => a.state_change_seq ?? -Infinity;
  const newestFirst = (rows: typeof agents) => rows.every((a, i) => i === 0 || seqOf(rows[i - 1]) >= seqOf(a));
  const blockedCount = agents.filter((a) => a.agent_status === "blocked").length;
  check(
    "#/all lists every agent, blocked first, then newest state_change_seq first",
    ordered.length === live.length &&
      ordered.slice(0, blockedCount).every((a) => a.agent_status === "blocked") &&
      newestFirst(ordered.slice(0, blockedCount)) &&
      newestFirst(ordered.slice(blockedCount)),
    ordered.map((a) => `${a.pane_id}:${a.agent_status}:${a.state_change_seq}`),
  );

  // Each key name is accepted and arrives as these bytes. ctrl+x,
  // f5 and shift+tab are keys the picker adds (f5 stands in for PgUp, which
  // herdr 0.9.5 can't send); ctrl+d is one of the hold keys.
  const expected: Record<string, string> = {
    esc: "1b",
    tab: "09",
    up: "1b5b41",
    down: "1b5b42",
    left: "1b5b44",
    right: "1b5b43",
    enter: "0d",
    "ctrl+c": "03",
    "1": "31",
    "2": "32",
    "3": "33",
    "4": "34",
    "ctrl+x": "18",
    f5: "1b5b31357e",
    "shift+tab": "1b5b5a",
    "ctrl+d": "04",
    "ctrl+\\": "1c",
    "alt+x": "1b78",
    backspace: "7f",
    f12: "1b5b32347e",
    "0": "30",
  };
  const prompts = [
    `He said "don't" — it's $HOME and \`whoami\` and $(id) & | ; \\ done`,
    "line one\nline two\n\nline four",
    "café naïve 日本語 🚀👍🏽",
    "-v",
    "--help",
    "--wait --timeout 1",
    `/compact keep "the plan" and $HOME\nthen 'stop' & \`id\``,
  ];

  for (const [kind, { pane, log }] of [["pi", pi], ["atomic", atomic]] as const) {
    const target = encodeURIComponent(pane);
    const listedTerminals = (await api("GET", "/api/terminals")).json.terminals as { pane_id: string; kind: string }[];
    check(`${kind}: /api/terminals lists the disposable agent with its kind`, listedTerminals.find((row) => row.pane_id === pane)?.kind === kind);

    for (const [key, bytes] of Object.entries(expected)) {
      const { outcome, hex: arrived } = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/keys`, { keys: [key], kind }));
      check(`${kind}: key ${key} -> 200 and bytes ${bytes}`, statusOf(outcome) === 200 && arrived === bytes, { status: statusOf(outcome), arrived });
    }
    for (const bad of ["pageup", "Ctrl+x", "ctrl+1"]) {
      const refused = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/keys`, { keys: [bad], kind }));
      check(`${kind}: key ${bad} refused with 400, nothing sent`, statusOf(refused.outcome) === 400 && refused.hex === "", refused);
    }

    for (const text of prompts) {
      const { outcome, hex: arrived } = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/prompt`, { text, kind }));
      check(`${kind}: prompt ${JSON.stringify(text)} arrives exactly once, unchanged`, statusOf(outcome) === 200 && arrived === pasted(text) && count(arrived, hex(text)) === 1, {
        status: statusOf(outcome),
        arrived: arrived === pasted(text) ? "exact" : arrived,
      });
    }

    const output = await api("GET", `/api/terminals/${target}/output`);
    check(`${kind}: output (pane read recent-unwrapped) shows what the recorder printed`, output.status === 200 && String(output.json.text).includes("key recorder ready"));

    writeFileSync(`${log}.state`, "blocked");
    await waitForStatus(pane, "blocked");
    const listed = (await api("GET", "/api/agents")).json.agents as { pane_id: string; agent_status: string }[];
    check(`${kind}: server lists the disposable agent as blocked`, listed.find((a) => a.pane_id === pane)?.agent_status === "blocked");
    const blockedPrompt = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/prompt`, { text: "should not arrive", kind }));
    check(`${kind}: prompt to a blocked agent -> 409 agent_blocked, nothing sent`, statusOf(blockedPrompt.outcome) === 409 && codeOf(blockedPrompt.outcome) === "agent_blocked" && blockedPrompt.hex === "", blockedPrompt.outcome);
    const blockedKeys = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/keys`, { keys: ["2", "enter"], kind }));
    check(`${kind}: keys 2 + enter answer a blocked agent`, statusOf(blockedKeys.outcome) === 200 && blockedKeys.hex === "320d", blockedKeys);

    writeFileSync(`${log}.state`, "working");
    await waitForStatus(pane, "working");
    const working = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/prompt`, { text: "queued while working", kind }));
    check(`${kind}: prompt while working is accepted and delivered once`, statusOf(working.outcome) === 200 && working.hex === pasted("queued while working"), working);
    writeFileSync(`${log}.state`, "idle");
    await waitForStatus(pane, "idle");
  }

  // The Inbox, on the atomic pane: latest_line from a real `agent read`, the
  // Inbox rules as the page runs them (web/home.js), and times only when seen.
  {
    const { pane, log } = atomic;
    type Listed = { pane_id: string; agent_status: string; cwd: string; terminal_title_stripped: string; state_change_seq?: number; completion_seq?: number; since?: number; latest_line?: string | null };
    const RULE = "─".repeat(60);
    const say = (text: string) => writeFileSync(`${log}.say`, text);
    const listAll = async () => (await api("GET", "/api/agents")).json.agents as Listed[];
    const mine = (agents: Listed[]) => agents.find((a) => a.pane_id === pane);
    async function waitFor(ok: (a: Listed) => boolean) {
      for (let i = 0; i < 40; i++) {
        const agents = await listAll();
        const a = mine(agents);
        if (a && ok(a)) return { a, agents };
        await sleep(250);
      }
      const agents = await listAll();
      return { a: mine(agents), agents };
    }
    const storage = memoryStorage();
    const open = (a: Listed | undefined) => {
      if (!a) throw new Error("The disposable agent wasn't in the list.");
      recordOpened(storage, a);
    };
    const inbox = (agents: Listed[], store = storage) => {
      recordFirstSight(store, agents);
      const home = homeLists(agents, store);
      return { blocked: home.blocked.some((a: Listed) => a.pane_id === pane), finished: home.finished.some((a: Listed) => a.pane_id === pane) };
    };

    const atomicScreen = (line: string) =>
      `\n${line}\n\n ∀ Gestating...\n\n${" ".repeat(20)}↑83k • ↓168k • R44M • CH99.9% • $23.389 (sub) • 43.2%/1.0M (auto)\n[stage: live-check] ${RULE}\n❯\n${RULE}\nesc to interrupt\nTasks  1 shell running · /tasks\n`;
    writeFileSync(`${log}.state`, "working");
    say(atomicScreen("Built the release bundle; 31 tests pass."));
    const working = await waitFor((a) => a.agent_status === "working" && a.latest_line === "Built the release bundle; 31 tests pass.");
    check("atomic: working latest_line is its own line, not the spinner, usage line, prompt box, 'esc to interrupt' or task line", working.a?.latest_line === "Built the release bundle; 31 tests pass.", working.a?.latest_line);

    const saidAt = Date.now();
    say(atomicScreen("Now writing the release notes."));
    const refreshed = await waitFor((a) => a.latest_line === "Now writing the release notes.");
    const tookMs = Date.now() - saidAt;
    check("atomic: latest_line follows new output within about 3 s while state_change_seq is unchanged", refreshed.a?.latest_line === "Now writing the release notes." && tookMs < 4_500, { tookMs, seq: refreshed.a?.state_change_seq });

    writeFileSync(`${log}.state`, "blocked");
    const blocked = await waitFor((a) => a.agent_status === "blocked");
    check("atomic: a blocked agent is in the Inbox with its latest line", inbox(blocked.agents).blocked && blocked.a?.latest_line === "Now writing the release notes.", blocked.a);

    writeFileSync(`${log}.state`, "working");
    await waitFor((a) => a.agent_status === "working");
    const askedIdle = Date.now();
    writeFileSync(`${log}.state`, "idle");
    const done = await waitFor((a) => a.agent_status === "done");
    const firstCompletion = done.a?.completion_seq;
    check("atomic: herdr marks it done with a completion_seq", done.a?.agent_status === "done" && typeof firstCompletion === "number", done.a);
    check(
      "atomic: the done change was seen moments after it happened, so it has a true time",
      typeof done.a?.since === "number" && done.a.since >= askedIdle - 1_000 && done.a.since <= Date.now(),
      { since: done.a?.since, askedIdle },
    );
    check("atomic: never opened in the app, the done agent is in the Inbox as finished", inbox(done.agents).finished, done.a);

    open(done.a);
    check("atomic: after opening it, it leaves the Inbox (herdr still says done)", !inbox(await listAll()).finished && mine(await listAll())?.agent_status === "done");
    await sleep(3_500);
    check("atomic: it stays out of the Inbox while it doesn't complete again", !inbox(await listAll()).finished);

    writeFileSync(`${log}.state`, "working");
    await waitFor((a) => a.agent_status === "working");
    writeFileSync(`${log}.state`, "idle");
    const again = await waitFor((a) => a.agent_status === "done");
    check(
      "atomic: it returns to the Inbox after it completes again (completion_seq increased)",
      inbox(again.agents).finished && (again.a?.completion_seq ?? 0) > (firstCompletion ?? Infinity),
      { before: firstCompletion, after: again.a?.completion_seq },
    );

    writeFileSync(`${log}.state`, "working");
    const watched = await waitFor((a) => a.agent_status === "working");
    open(watched.a);
    say(atomicScreen("Release notes written."));
    const stoppedAt = Date.now();
    writeFileSync(`${log}.state`, "idle");
    const stopped = await waitFor((a) => a.agent_status !== "working" && a.latest_line === "Release notes written.");
    open(stopped.a);
    recordFirstSight(storage, stopped.agents);
    const home = homeLists(stopped.agents, storage);
    const rows = home.activity as { agent: Listed; older: boolean }[];
    const stoppedRows = rows.filter((row) => !["working", "unknown"].includes(row.agent.agent_status));
    const row = rows.find((r) => r.agent.pane_id === pane);
    check(
      "atomic: an agent that just stopped is the top stopped row of Activity, at full strength, with its line and a true time",
      !home.finished.some((a: Listed) => a.pane_id === pane) &&
        stoppedRows[0]?.agent.pane_id === pane &&
        row?.older === false &&
        row.agent.latest_line === "Release notes written." &&
        typeof row.agent.since === "number" &&
        row.agent.since >= stoppedAt - 1_000,
      { status: stopped.a?.agent_status, seq: stopped.a?.state_change_seq, activity: rows.map((r) => `${r.agent.pane_id}:${r.agent.agent_status}:${r.agent.state_change_seq}${r.older ? ":older" : ""}`) },
    );

    const inUse = memoryStorage();
    inUse.setItem("agents.opened-completion.w0:p0", "1");
    writeFileSync(`${log}.state`, "blocked");
    const seenBlocked = await waitFor((a) => a.agent_status === "blocked");
    inbox(seenBlocked.agents, inUse);
    check(
      "atomic: first seen by a page already in use, its baseline is null, not its current completion_seq",
      inUse.getItem(`agents.opened-completion.${pane}`) === "null",
      { stored: inUse.getItem(`agents.opened-completion.${pane}`), completion_seq: seenBlocked.a?.completion_seq },
    );
    writeFileSync(`${log}.state`, "working");
    await waitFor((a) => a.agent_status === "working");
    writeFileSync(`${log}.state`, "idle");
    const doneInUse = await waitFor((a) => a.agent_status === "done");
    check("atomic: that page then shows its completion in the Inbox", inbox(doneInUse.agents, inUse).finished, doneInUse.a);
  }

  // Every pane is a terminal. The plain shell is typed into only through the
  // server's terminal routes.
  {
    const shell = await startShell();
    const shellTarget = encodeURIComponent(shell);
    type Row = { pane_id: string; kind: string; status: string | null; workspace: { id: string; label: string | null }; tab: { id: string; label: string | null }; latest_line?: string | null };
    const herdrPanes = JSON.parse(herdr(["pane", "list"]).stdout).result.panes as { pane_id: string; workspace_id: string }[];
    const all = await api("GET", "/api/terminals");
    const rows = all.json.terminals as Row[];
    const rowOf = (pane: string) => rows.find((row) => row.pane_id === pane);
    check(
      "/api/terminals lists every pane herdr lists, once",
      all.status === 200 && JSON.stringify(rows.map((row) => row.pane_id).sort()) === JSON.stringify(herdrPanes.map((p) => p.pane_id).sort()),
      { terminals: rows.length, panes: herdrPanes.length },
    );
    check(
      "the shell is a terminal of kind shell with no status, its workspace and tab labels, and a latest line; the recorders keep their agent kinds",
      rowOf(shell)?.kind === "shell" && rowOf(shell)?.status === null && rowOf(shell)?.workspace.id === workspace && rowOf(shell)?.tab.label === "agents-live-check-shell" &&
        typeof rowOf(shell)?.latest_line === "string" && rowOf(pi.pane)?.kind === "pi" && rowOf(atomic.pane)?.kind === "atomic",
      { shell: rowOf(shell), pi: rowOf(pi.pane)?.kind, atomic: rowOf(atomic.pane)?.kind },
    );
    const ws = await api("GET", `/api/workspaces/${workspace}/terminals`);
    const wsRows = ws.json.terminals as Row[];
    check(
      "/api/workspaces/:id/terminals lists exactly that workspace's panes, each with a latest line",
      ws.status === 200 &&
        JSON.stringify(wsRows.map((row) => row.pane_id).sort()) === JSON.stringify(herdrPanes.filter((p) => p.workspace_id === workspace).map((p) => p.pane_id).sort()) &&
        wsRows.every((row) => "latest_line" in row),
      { workspace: ws.json.workspace, panes: wsRows.map((row) => `${row.pane_id}:${row.kind}`) },
    );

    const outFile = join(dir, "shell-out.txt");
    const commandLine = `echo "say \\"hi\\" it's" '$HOME' "$((40+2))" >> ${outFile}\necho 'second line' >> ${outFile}`;
    const sent = await api("POST", `/api/terminals/${shellTarget}/prompt`, { text: commandLine, kind: "shell" });
    await waitUntil(() => existsSync(outFile) && readFileSync(outFile, "utf8").includes("second line"));
    await sleep(1000);
    const ran = existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
    check("shell: a message with quotes, $ and newlines runs exactly once, as typed", sent.status === 200 && ran === `say "hi" it's $HOME 42\nsecond line\n`, { status: sent.status, ran });
    const output = await api("GET", `/api/terminals/${shellTarget}/output`);
    check("shell: output (pane read --format ansi) shows what was typed", output.status === 200 && String(output.json.text).includes("second line"));
    const shellHistory = await api("GET", `/api/terminals/${shellTarget}/history`);
    check("shell: history -> 409 not_an_agent", shellHistory.status === 409 && codeOf(shellHistory) === "not_an_agent", shellHistory.json);

    const script = join(dir, "shell-bytes.ts");
    const slog = join(dir, "shell-bytes.jsonl");
    writeFileSync(
      script,
      `import { appendFileSync, existsSync } from "node:fs";\nconst log = ${JSON.stringify(slog)};\nprocess.stdin.setRawMode(true);\nappendFileSync(log, JSON.stringify({ ready: true }) + "\\n");\nprocess.stdin.on("data", (chunk) => appendFileSync(log, JSON.stringify({ hex: chunk.toString("hex") }) + "\\n"));\nsetInterval(() => { if (existsSync(log + ".exit")) { process.stdin.setRawMode(false); process.exit(0); } }, 100);\n`,
    );
    const started = await api("POST", `/api/terminals/${shellTarget}/prompt`, { text: `${process.execPath} ${script}`, kind: "shell" });
    await waitUntil(() => existsSync(slog) && readFileSync(slog, "utf8").includes('"ready"'));
    await sleep(300);
    check("shell: the byte logger started through the server and the pane is still a plain shell", started.status === 200 && existsSync(slog) && herdr(["agent", "get", shell]).exit !== 0);
    for (const [list, bytes] of [[["ctrl+c"], "03"], [["enter"], "0d"], [["esc", "up"], "1b1b5b41"], [["ctrl+d"], "04"]] as const) {
      const { outcome, hex: arrived } = await bytesAfter(slog, () => api("POST", `/api/terminals/${shellTarget}/keys`, { keys: list, kind: "shell" }));
      check(`shell: keys ${list.join(" ")} -> 200 and bytes ${bytes}`, statusOf(outcome) === 200 && arrived === bytes, { status: statusOf(outcome), arrived });
    }
    const message = `He said "don't" $HOME \`id\`\nline two`;
    const typed = await bytesAfter(slog, () => api("POST", `/api/terminals/${shellTarget}/prompt`, { text: message, kind: "shell" }));
    check(
      "shell: a message arrives once as the exact text (no paste markers), then Enter",
      statusOf(typed.outcome) === 200 && typed.hex === `${hex(message)}0d` && count(typed.hex, hex(message)) === 1,
      { status: statusOf(typed.outcome), arrived: typed.hex === `${hex(message)}0d` ? "exact" : typed.hex },
    );
    const asAgent = await bytesAfter(slog, () => api("POST", `/api/terminals/${shellTarget}/prompt`, { text: "seen as an agent", kind: "atomic" }));
    check("shell sent to as the atomic kind -> 409 terminal_changed, nothing sent", statusOf(asAgent.outcome) === 409 && codeOf(asAgent.outcome) === "terminal_changed" && asAgent.hex === "", asAgent.outcome);
    writeFileSync(`${slog}.exit`, "");
    await sleep(500);

    const atomicTarget = encodeURIComponent(atomic.pane);
    const asShell = await bytesAfter(atomic.log, () => api("POST", `/api/terminals/${atomicTarget}/keys`, { keys: ["ctrl+c"], kind: "shell" }));
    check("atomic sent to as a shell -> 409 terminal_changed, nothing sent", statusOf(asShell.outcome) === 409 && codeOf(asShell.outcome) === "terminal_changed" && asShell.hex === "", asShell.outcome);
    guard.addMissing("w99:p99");
    const vanished = await api("POST", "/api/terminals/w99%3Ap99/prompt", { text: "echo must-not-run", kind: "shell" });
    check("a pane that doesn't exist -> 404 pane_not_found", vanished.status === 404 && codeOf(vanished) === "pane_not_found", vanished.json);
  }

  {
    const { pane, log } = atomic;
    const target = encodeURIComponent(pane);

    const raw = await bytesAfter(log, () => herdr(["agent", "prompt", pane, "raw agent prompt"]));
    check("atomic: herdr's own agent prompt still refuses it (agent_not_ready), nothing sent", raw.hex === "" && raw.outcome !== null && (raw.outcome as { stderr: string }).stderr.includes("agent_not_ready"), raw.outcome);
    const probe = await bytesAfter(log, () => herdr(["pane", "send-text", pane, "a\nb"]));
    check("atomic: pane send-text writes its text unchanged, without paste markers (610a62)", probe.hex === "610a62", probe.hex);

    const noKind = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/prompt`, { text: "no kind given" }));
    check("atomic: prompt without the kind the client saw -> 400, nothing sent", statusOf(noKind.outcome) === 400 && noKind.hex === "", noKind.outcome);
    const otherKind = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/prompt`, { text: "wrong kind", kind: "pi" }));
    check("atomic: prompt when the client saw another kind -> 409 terminal_changed, nothing sent", statusOf(otherKind.outcome) === 409 && codeOf(otherKind.outcome) === "terminal_changed" && otherKind.hex === "", otherKind.outcome);
    const otherKindKeys = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/keys`, { keys: ["ctrl+c"], kind: "pi" }));
    check("atomic: ctrl+c when the client saw another kind -> 409 terminal_changed, nothing sent", statusOf(otherKindKeys.outcome) === 409 && codeOf(otherKindKeys.outcome) === "terminal_changed" && otherKindKeys.hex === "", otherKindKeys.outcome);
    const pasteEnd = await bytesAfter(log, () => api("POST", `/api/terminals/${target}/prompt`, { text: "early \x1b[201~ end", kind: "atomic" }));
    check("atomic: prompt containing ESC [201~ -> 400, nothing sent", statusOf(pasteEnd.outcome) === 400 && pasteEnd.hex === "", pasteEnd.outcome);

    const removed = await bytesAfter(log, async () => [
      await api("GET", `/api/agents/${target}`),
      await api("GET", `/api/agents/${target}/output`),
      await api("GET", `/api/agents/${target}/history`),
      await api("POST", `/api/agents/${target}/prompt`, { text: "removed route", agent: "atomic" }),
      await api("POST", `/api/agents/${target}/keys`, { keys: ["ctrl+c"], agent: "atomic" }),
    ]);
    const removedAnswers = (removed.outcome as { status: number; json: { error?: { code: string } } }[]).map((answer) => `${answer.status} ${answer.json?.error?.code}`);
    check("the removed per-agent routes answer 404 not_found, nothing sent", removedAnswers.every((answer) => answer === "404 not_found") && removed.hex === "", { answers: removedAnswers, arrived: removed.hex });

    const history = await bytesAfter(log, () => api("GET", `/api/terminals/${target}/history`));
    check(
      "atomic: history of a pane with no Atomic session -> 200 { history: null, reason: no_match }, nothing sent",
      statusOf(history.outcome) === 200 && JSON.stringify((history.outcome as { json: unknown }).json) === JSON.stringify({ history: null, reason: "no_match" }) && history.hex === "",
      history.outcome,
    );
    const badHistory = await api("GET", `/api/terminals/${target}/history?before=0`);
    const postHistory = await api("POST", `/api/terminals/${target}/history`, {});
    check("atomic: history with a bad query -> 400, and POST -> 405", badHistory.status === 400 && postHistory.status === 405, { bad: badHistory.json, post: postHistory.json });

    writeFileSync(`${log}.state`, "exit");
    for (let i = 0; i < 30 && herdr(["agent", "get", pane]).exit === 0; i++) await sleep(100);
    const shellGet = herdr(["agent", "get", pane]);
    check("atomic: after the recorder exits, herdr agent get says agent_not_found", shellGet.exit !== 0 && shellGet.stderr.includes("agent_not_found"), shellGet.stderr.trim());
    const changedPrompt = await api("POST", `/api/terminals/${target}/prompt`, { text: "echo d18-must-not-run", kind: "atomic" });
    const changedKeys = await api("POST", `/api/terminals/${target}/keys`, { keys: ["enter"], kind: "atomic" });
    await sleep(800);
    const screen = herdr(["pane", "read", pane, "--source", "recent-unwrapped", "--lines", "200"]).stdout;
    check(
      "atomic pane that is now a plain shell, sent to as atomic -> 409 terminal_changed, nothing typed",
      changedPrompt.status === 409 && codeOf(changedPrompt) === "terminal_changed" && changedKeys.status === 409 && !screen.includes("d18-must-not-run"),
      { prompt: changedPrompt.json, keys: changedKeys.json },
    );
  }

  const gone = await api("GET", "/api/terminals/w99%3Ap99/output");
  check("unknown pane -> 404 pane_not_found", gone.status === 404 && codeOf(gone) === "pane_not_found");
} catch (error) {
  check("live check ran to the end", false, String(error));
} finally {
  server?.kill();
  await server?.exited;
  for (const tabId of createdTabs) {
    const closed = herdr(["tab", "close", tabId]);
    check("closed a disposable tab", closed.exit === 0 && herdr(["tab", "get", tabId]).exit !== 0, tabId);
  }
  const tabsAfter = tabIds();
  check("tab list after matches the tab list before", JSON.stringify(tabsAfter) === JSON.stringify(tabsBefore), { before: tabsBefore.length, after: tabsAfter.length });
  rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
