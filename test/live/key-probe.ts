// Key-name probe (D15 a): which logical key names herdr's `pane send-keys` and
// `agent send-keys` accept, and the bytes each one delivers. Run it from inside
// Herdr:
//
//   bun test/live/key-probe.ts [out.json]
//
// KEY_PROBE_KEYS='["pageup", ["esc", "["], ...]' replaces the built-in candidate
// list; an array entry is sent as several keys in one call.
//
// Safety: it creates ONE new tab (--no-focus) and runs the key recorder in it,
// reporting itself as `pi` (a herdr built-in kind), so both `agent send-keys`
// and `pane send-keys` can be tried on it. Keys go only to that pane. At the
// end it closes only that tab and checks that the tab list is the same as before.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const herdrBin = process.env.HERDR_BIN_PATH || "herdr";
const workspace = process.env.HERDR_WORKSPACE_ID;
const out = process.argv[2];

if (process.env.HERDR_ENV !== "1" || !workspace) {
  console.error("Run this inside a Herdr pane (HERDR_ENV=1).");
  process.exit(1);
}

function herdr(args: string[]) {
  const result = Bun.spawnSync([herdrBin, ...args]);
  return { exit: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
const tabIds = () => (JSON.parse(herdr(["tab", "list"]).stdout).result.tabs as { tab_id: string }[]).map((tab) => tab.tab_id).sort();

const letters = "abcdefghijklmnopqrstuvwxyz".split("");
const CANDIDATES: (string | string[])[] = process.env.KEY_PROBE_KEYS ? JSON.parse(process.env.KEY_PROBE_KEYS) : [
  ...letters.map((l) => `ctrl+${l}`),
  ...letters.map((l) => `alt+${l}`),
  "Ctrl+x", "CTRL+X", "ctrl+X", "C-x", "c-x", "^x", "control+x", "alt+X", "Alt+x", "meta+x", "M-x", "ctrl+alt+x", "ctrl+shift+x", "shift+x",
  "ctrl+\\", "ctrl+backslash", "ctrl+[", "ctrl+]", "ctrl+space", "ctrl+@", "ctrl+-", "ctrl+/",
  ...Array.from({ length: 10 }, (_, d) => `ctrl+${d}`),
  ...Array.from({ length: 10 }, (_, d) => `alt+${d}`),
  "shift+tab", "Shift+Tab", "backtab", "btab", "s-tab", "shift-tab",
  "pageup", "pagedown", "pgup", "pgdn", "pgdown", "page_up", "page-up", "PageUp", "PageDown", "prior", "next",
  "home", "end", "Home", "END",
  "backspace", "bs", "Backspace", "BS", "ctrl+h", "delete", "del", "Delete", "DEL", "insert", "ins",
  "f0", ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`), "F1", "F12", "f13", "f20", "f24",
  "up", "down", "left", "right", "Up", "arrowup", "arrow_up", "ctrl+up", "shift+up", "alt+up", "shift+left", "ctrl+left", "alt+right",
  "esc", "escape", "Esc", "ESC", "tab", "Tab", "enter", "Enter", "return", "cr", "space", "spc",
  ...Array.from({ length: 10 }, (_, d) => String(d)),
  "a", "x", "A", "/", "!", "\\",
  "shift+enter", "alt+enter", "ctrl+enter", "alt+backspace", "ctrl+backspace", "shift+home", "ctrl+home", "ctrl+end", "shift+pageup",
  "ctrl+c", "ctrl+d", "ctrl+z",
  "ctrl+", "alt+", "+", "ctrl+ab", "ctrl+é", "enter ", " enter",
];

const dir = mkdtempSync(join(tmpdir(), "agents-key-probe-"));
const log = join(dir, "pi.jsonl");
const tabsBefore = tabIds();
let createdTab: string | undefined;
type Outcome = { exit: number; error: string; message: string; hex: string };
const results: { key: string | string[]; chunks?: number; pane: Outcome; agent: Outcome }[] = [];

const chunks = () =>
  existsSync(log)
    ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.hex !== undefined).map((entry) => entry.hex as string)
    : [];

async function bytesAfter(action: () => ReturnType<typeof herdr>) {
  const before = chunks().length;
  const outcome = action();
  let seen = before;
  let quietSince = Date.now();
  const started = Date.now();
  // Refused keys deliver nothing; accepted keys arrive within a few ms.
  while (Date.now() - quietSince < 300 && Date.now() - started < 3000) {
    await Bun.sleep(40);
    const now = chunks().length;
    if (now !== seen) {
      seen = now;
      quietSince = Date.now();
    }
  }
  let error = "";
  let message = "";
  try {
    const parsed = JSON.parse(outcome.stderr).error;
    error = parsed?.code ?? outcome.stderr.trim();
    message = parsed?.message ?? "";
  } catch {
    error = outcome.stderr.trim().split("\n")[0];
  }
  return { exit: outcome.exit, error, message, hex: chunks().slice(before).join("") };
}

try {
  const created = herdr(["tab", "create", "--workspace", workspace, "--cwd", ROOT, "--label", "agents-key-probe", "--no-focus"]);
  const { result } = JSON.parse(created.stdout);
  createdTab = result.tab.tab_id;
  const pane = result.root_pane.pane_id as string;
  const launcher = join(dir, "pi");
  writeFileSync(launcher, `#!${process.execPath}\nimport ${JSON.stringify(join(ROOT, "test/live/key-recorder.ts"))};\n`);
  chmodSync(launcher, 0o755);
  await Bun.sleep(1000);
  herdr(["pane", "send-text", pane, `exec ${launcher} ${log} pi`]);
  herdr(["pane", "send-keys", pane, "enter"]);
  for (let i = 0; i < 40 && !(existsSync(log) && readFileSync(log, "utf8").includes('"ready"')); i++) await Bun.sleep(250);
  await Bun.sleep(500);
  const kind = JSON.parse(herdr(["agent", "get", pane]).stdout || "{}")?.result?.agent?.agent;
  console.log(`probe tab ${createdTab}, pane ${pane}, kind ${kind}`);
  if (kind !== "pi") throw new Error("recorder did not start");

  for (const key of CANDIDATES) {
    const keys = Array.isArray(key) ? key : [key];
    const chunksBefore = chunks().length;
    const viaPane = await bytesAfter(() => herdr(["pane", "send-keys", pane, ...keys]));
    const paneChunks = chunks().length - chunksBefore;
    const viaAgent = await bytesAfter(() => herdr(["agent", "send-keys", pane, ...keys]));
    results.push({ key, chunks: paneChunks, pane: viaPane, agent: viaAgent });
    console.log(`${JSON.stringify(key).padEnd(18)} pane ${viaPane.exit === 0 ? "ok " : "ERR"} ${viaPane.hex || viaPane.error}  | agent ${viaAgent.exit === 0 ? "ok " : "ERR"} ${viaAgent.hex || viaAgent.error}${viaPane.message ? `  (${viaPane.message})` : ""}${Array.isArray(key) ? `  [pane: ${paneChunks} chunk(s)]` : ""}`);
  }
  writeFileSync(`${log}.state`, "exit");
  await Bun.sleep(500);
} catch (error) {
  console.error(`probe failed: ${error}`);
} finally {
  if (createdTab) {
    const closed = herdr(["tab", "close", createdTab]);
    console.log(`closed probe tab ${createdTab}: exit ${closed.exit}, still there: ${herdr(["tab", "get", createdTab]).exit === 0}`);
  }
  const tabsAfter = tabIds();
  console.log(`tab list before ${tabsBefore.length}, after ${tabsAfter.length}, same: ${JSON.stringify(tabsAfter) === JSON.stringify(tabsBefore)}`);
  if (out) writeFileSync(out, JSON.stringify({ tabsBefore, tabsAfter, createdTab, results }, null, 1));
  rmSync(dir, { recursive: true, force: true });
}
