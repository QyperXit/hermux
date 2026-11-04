// How the server runs herdr's CLI; the only other way it talks to herdr is the
// read-only event subscription in server/events.ts (`events.subscribe` on
// herdr's socket). Every call is an argument array passed straight to the
// binary (never a shell). Only these subcommands exist here:
//   agent list, get, read, prompt, send-keys;
//   pane list, get, read (every pane is a terminal that can be listed and read);
//   workspace list, tab list (labels and tab numbers only);
//   pane send-text, pane send-keys, each straight after the re-check of the
//     pane: `agent get` for an agent, `pane get` for a plain shell;
//   terminal session observe: a read-only stream of a pane's screen,
//     with stdin closed, so nothing can be typed through it.
// Keys come from the shared grammar (web/key-grammar.js) only. Never pane run,
// pane close, agent start, focus or rename, server stop, terminal session
// control, terminal attach, or --machine.
import { KEY_HELP, isAllowedKey } from "../web/key-grammar.js";

export { isAllowedKey };

const OUTPUT_LINES = 200;

// herdr 0.9.5 accepts `agent prompt` and `agent send-keys` only for its built-in
// agent kinds. These are the labels and aliases its parse_agent_label() knows
// (src/detect/mod.rs, lookup_agent). Atomic agents report `atomic`.
const BUILT_IN_KINDS = new Set([
  "pi",
  "claude", "claude-code",
  "codex",
  "gemini",
  "cursor", "cursor-agent",
  "devin", "devin-cli", "devin cli",
  "agy", "antigravity", "antigravity-cli",
  "cline", ".cline",
  "omp",
  "mastracode", "mastra-code", "mastra code",
  "opencode", "opencode2", "open-code",
  "copilot", "github-copilot", "ghcs",
  "kimi", "kimi-code", "kimi code",
  "kiro", "kiro-cli",
  "droid",
  "amp", "amp-local",
  "grok", "grok-build",
  "hermes", "hermes-agent",
  "kilo", "kilo-code", "kilo code",
  "qodercli", "qoderclicn", "qoder", "qodercn",
  "qwen", "qwen-code", "qwen code",
  "letta", "letta-code", "letta code",
  "maki",
  "muse", "muse-code", "muse-cli",
]);

// Matches a label the way herdr 0.9.5's parse_agent_label() does: trimmed,
// lower-cased, one .exe/.cmd/.bat/.ps1/.js suffix dropped, last path component.
export function isBuiltInKind(label: unknown): boolean {
  if (typeof label !== "string") return false;
  let name = label.trim().toLowerCase();
  const suffix = [".exe", ".cmd", ".bat", ".ps1", ".js"].find((end) => name.endsWith(end));
  if (suffix) name = name.slice(0, -suffix.length);
  name = name.split(/[/\\]/).filter(Boolean).pop() ?? name;
  return BUILT_IN_KINDS.has(name) || /^muse-bin-[0-9]/.test(name);
}

// A message to a custom-kind agent is one bracketed paste, then Enter. herdr's
// `pane send-text` writes its text unchanged (it adds no paste markers), so the
// server adds them, then waits as herdr's own `agent prompt` does (300 ms)
// before Enter.
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const SUBMIT_DELAY_MS = 300;

// herdr pane IDs look like w9:pD. Anything else is refused before herdr runs,
// so a target can never be read as an option such as --help.
const PANE_ID = /^w[0-9A-Za-z]+:p[0-9A-Za-z]+$/;

export const SHELL = "shell";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Agent = Record<string, unknown> & { pane_id: string; agent_status: string; state_change_seq?: number };

// A row of `herdr pane list` / `pane get`. Panes that host an agent also carry
// `agent` and `agent_status`; plain shells have no `agent`.
export type Pane = Record<string, unknown> & { pane_id: string; workspace_id?: string; tab_id?: string; agent?: unknown };
export type Workspace = Record<string, unknown> & { workspace_id: string; label?: string };
export type Tab = Record<string, unknown> & { tab_id: string; workspace_id?: string; label?: string };

export type Herdr = ReturnType<typeof createHerdr>;

export function checkTarget(paneId: string) {
  if (!PANE_ID.test(paneId)) throw new HerdrError("invalid_target", `Not a herdr pane ID: ${paneId}`);
}

// One frame of `terminal session observe`, shapes probed read-only on
// herdr 0.9.5: the pane's screen as ANSI bytes drawn on a `width` x `height`
// canvas, the whole screen (`full`, always the first) or only what changed.
export type Frame = { full: boolean; width: number; height: number; seq: number; bytes: Uint8Array };
export type Observation = { stop(): void };
export type ObserveHandlers = { frame(frame: Frame): void; end(error: HerdrError): void };

const isFrameRow = (row: unknown): row is { full: boolean; width: number; height: number; seq: number; bytes: string } =>
  isRecord(row) &&
  row.type === "terminal.frame" &&
  row.encoding === "ansi" &&
  typeof row.full === "boolean" &&
  Number.isInteger(row.width) &&
  Number.isInteger(row.height) &&
  typeof row.seq === "number" &&
  typeof row.bytes === "string";

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isAgent = (row: unknown): row is Agent => isRecord(row) && typeof row.pane_id === "string" && typeof row.agent_status === "string";
const isPane = (row: unknown): row is Pane => isRecord(row) && typeof row.pane_id === "string";
const isWorkspace = (row: unknown): row is Workspace => isRecord(row) && typeof row.workspace_id === "string";
const isTab = (row: unknown): row is Tab => isRecord(row) && typeof row.tab_id === "string";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// herdr's error is { error: { code, message } } on stderr; anything else is
// herdr_failed with the stderr text.
function failure(exitCode: number, stderr: string): HerdrError {
  const parsed = parseJson(stderr);
  const error = isRecord(parsed) ? parsed.error : undefined;
  if (isRecord(error) && typeof error.code === "string") return new HerdrError(error.code, typeof error.message === "string" ? error.message : error.code);
  return new HerdrError("herdr_failed", stderr.trim() || `herdr exited with status ${exitCode}`);
}

// What herdr answers (exit 2, plain stderr, so code herdr_failed) when it
// can't give a styled read: an unknown flag ("unknown option: --format" in
// herdr 0.9.5) or an unknown format ("invalid read format: ansi").
const FORMAT_REFUSED = /--format\b|\bread format\b/;

function parseResult(stdout: string): Record<string, unknown> {
  const parsed = parseJson(stdout);
  if (parsed === undefined || parsed === null) throw new HerdrError("herdr_bad_output", "herdr returned output the server couldn't read.");
  const result = isRecord(parsed) ? parsed.result : undefined;
  return isRecord(result) ? result : {};
}

export function createHerdr(bin: string, { submitDelayMs = SUBMIT_DELAY_MS }: { submitDelayMs?: number } = {}) {
  function spawn(args: string[]) {
    try {
      return Bun.spawn([bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    } catch (error) {
      throw new HerdrError("herdr_unavailable", `Couldn't run herdr (${bin}): ${errorMessage(error)}`);
    }
  }

  async function run(args: string[]): Promise<string> {
    const proc = spawn(args);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) throw failure(exitCode, stderr);
    return stdout;
  }

  // A pane's screen as it changes: one JSON frame per line from
  // `terminal session observe`, drawn on a cols x rows canvas (herdr clips
  // the pane's rows to it, or pads them; it never resizes the pane).
  function observe(paneId: string, { cols, rows }: { cols: number; rows: number }, { frame, end }: ObserveHandlers): Observation {
    checkTarget(paneId);
    const proc = spawn(["terminal", "session", "observe", paneId, "--cols", String(cols), "--rows", String(rows)]);
    let stopped = false;
    const stderr = new Response(proc.stderr).text();
    (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let index = buffer.indexOf("\n"); index !== -1; index = buffer.indexOf("\n")) {
          const row = parseJson(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          if (stopped || !isFrameRow(row)) continue;
          frame({ full: row.full, width: row.width, height: row.height, seq: row.seq, bytes: Buffer.from(row.bytes, "base64") });
        }
      }
      const exitCode = await proc.exited;
      if (!stopped) end(failure(exitCode, await stderr));
    })().catch((error) => {
      if (!stopped) end(new HerdrError("herdr_failed", `herdr's observe stream failed: ${errorMessage(error)}`));
    });
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        proc.kill();
      },
    };
  }

  async function get(paneId: string): Promise<Agent> {
    checkTarget(paneId);
    const agent = parseResult(await run(["agent", "get", paneId])).agent;
    if (!isAgent(agent)) throw new HerdrError("herdr_bad_output", "herdr returned no agent.");
    return agent;
  }

  async function paneGet(paneId: string): Promise<Pane> {
    checkTarget(paneId);
    const pane = parseResult(await run(["pane", "get", paneId])).pane;
    if (!isPane(pane)) throw new HerdrError("herdr_bad_output", "herdr returned no pane.");
    return pane;
  }

  async function listOf<T>(args: string[], field: string, isRow: (row: unknown) => row is T): Promise<T[]> {
    const rows = parseResult(await run(args))[field];
    if (!Array.isArray(rows)) throw new HerdrError("herdr_bad_output", `herdr returned no ${args[0]} list.`);
    if (!rows.every(isRow)) throw new HerdrError("herdr_bad_output", `herdr's ${args[0]} list has a row the server couldn't read.`);
    return rows;
  }

  async function recheck(paneId: string, seenKind: string): Promise<{ kind: "shell" } | { kind: "agent"; agent: Agent; builtIn: boolean }> {
    if (seenKind === SHELL) {
      const pane = await paneGet(paneId);
      if (pane.agent !== undefined) {
        throw new HerdrError("terminal_changed", `Pane ${paneId} now runs ${String(pane.agent)}, not a plain shell. Nothing was sent.`);
      }
      return { kind: "shell" };
    }
    let agent: Agent;
    try {
      agent = await get(paneId);
    } catch (error) {
      if (!(error instanceof HerdrError && error.code === "agent_not_found")) throw error;
      await paneGet(paneId);
      throw new HerdrError("terminal_changed", `Pane ${paneId} is now a plain shell, not ${seenKind}. Nothing was sent.`);
    }
    if (agent.agent !== seenKind) {
      const kindLabel = typeof agent.agent === "string" ? agent.agent : "no named agent";
      throw new HerdrError("terminal_changed", `Pane ${paneId} now runs ${kindLabel}, not ${seenKind}. Nothing was sent.`);
    }
    return { kind: "agent", agent, builtIn: isBuiltInKind(agent.agent) };
  }

  const readArgs = (paneId: string, kind: string | undefined) => {
    const group = kind === undefined || kind === SHELL ? "pane" : "agent";
    return [group, "read", paneId, "--source", "recent-unwrapped", "--lines", String(OUTPUT_LINES)];
  };

  async function read(paneId: string, kind?: string): Promise<string> {
    checkTarget(paneId);
    return run(readArgs(paneId, kind));
  }

  async function styled(args: string[], plain: () => Promise<string>) {
    try {
      return await run([...args, "--format", "ansi"]);
    } catch (error) {
      if (!(error instanceof HerdrError && error.code === "herdr_failed" && FORMAT_REFUSED.test(error.message))) throw error;
      return plain();
    }
  }

  function checkText(text: string, pasted: boolean) {
    // An argv element can't hold a NUL byte, so Bun.spawn would refuse to run herdr.
    if (text.includes("\u0000")) throw new HerdrError("bad_request", "The message contains a NUL character, which can't be sent.");
    if (pasted && text.includes(PASTE_END)) {
      throw new HerdrError("bad_request", "The message contains the paste-end sequence ESC [201~, which would end the paste early.");
    }
  }

  function checkKeys(keys: string[]) {
    const refused = keys.find((key) => !isAllowedKey(key));
    if (!keys.length || refused !== undefined) {
      throw new HerdrError(
        "key_not_allowed",
        `Key not allowed: ${refused === undefined ? "(none)" : JSON.stringify(refused)}. ${KEY_HELP}`,
      );
    }
  }

  async function enterAfterText(paneId: string, what: string) {
    try {
      await run(["pane", "send-keys", paneId, "enter"]);
    } catch (error) {
      throw new HerdrError("enter_not_sent", `The message was typed, but Enter failed (${errorMessage(error)}). Check the ${what} before sending again.`);
    }
  }

  return {
    list: () => listOf(["agent", "list"], "agents", isAgent),

    panes: () => listOf(["pane", "list"], "panes", isPane),
    workspaces: () => listOf(["workspace", "list"], "workspaces", isWorkspace),
    tabs: () => listOf(["tab", "list"], "tabs", isTab),
    pane: paneGet,
    observe,

    get,

    read,

    // The screen with Atomic's highlighting as ANSI SGR codes. If herdr can't
    // give it, the plain text is read instead; the page renders both.
    async readStyled(paneId: string, kind?: string): Promise<string> {
      checkTarget(paneId);
      return styled(readArgs(paneId, kind), () => read(paneId, kind));
    },

    // herdr 0.9.5 doesn't report a pane's bracketed-paste mode, so a plain
    // shell's text is sent with no paste markers, and each line of the
    // text arrives as if typed. The text is one argv element, passed unchanged.
    // herdr reads its positionals first, so text such as "-v" or "--help" stays
    // text. No "--" is added: herdr would send it as the message.
    async sendText(paneId: string, text: string, kind: string): Promise<void> {
      checkTarget(paneId);
      checkText(text, kind !== SHELL);
      const target = await recheck(paneId, kind);
      if (target.kind === "shell") {
        await run(["pane", "send-text", paneId, text]);
        await enterAfterText(paneId, "terminal");
        return;
      }
      if (target.builtIn) {
        await run(["agent", "prompt", paneId, text]);
        return;
      }
      if (target.agent.agent_status === "blocked") {
        throw new HerdrError("agent_blocked", `agent ${paneId} is blocked and requires interactive input`);
      }
      await run(["pane", "send-text", paneId, `${PASTE_START}${text}${PASTE_END}`]);
      await Bun.sleep(submitDelayMs);
      await enterAfterText(paneId, "agent");
    },

    // Keys still go to a blocked agent: they are how its question gets answered.
    async sendKeys(paneId: string, keys: string[], kind: string): Promise<void> {
      checkTarget(paneId);
      checkKeys(keys);
      const target = await recheck(paneId, kind);
      await run([target.kind === "agent" && target.builtIn ? "agent" : "pane", "send-keys", paneId, ...keys]);
    },
  };
}
