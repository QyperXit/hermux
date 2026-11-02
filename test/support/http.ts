// The real app behind a fake herdr, driven with real Requests: the HTTP tests'
// harness, and the helpers they share for sends and herdr's answers.
import { expect } from "bun:test";
import { resolve } from "node:path";
import { createApp } from "../../server/app";
import { createHerdr, type Herdr } from "../../server/herdr";
import type { createHistory } from "../../server/history";
import { makeFakeHerdr, type FakeConfig } from "../fake-herdr";
import { VALID_KEYS } from "./key-grammar";

const WEB = resolve(import.meta.dir, "../../web");

// The login the tests run the app with (AGENTS_ALLOWED_LOGIN in real use).
export const ALLOWED_LOGIN = "you@example.com";

// The herdr commands the server may ever run, and the ones the /api/agents
// list runs: the list and the latest lines' reads (`pane read` for an agent
// with no named kind), never a send.
export const HERDR_COMMANDS = ["agent list", "agent get", "agent read", "agent prompt", "agent send-keys", "pane list", "pane get", "pane read", "pane send-text", "pane send-keys", "workspace list", "tab list", "terminal session"];
export const AGENT_LIST_COMMANDS = ["agent list", "agent read", "pane read"];
const SENDS = ["agent prompt", "agent send-keys", "pane send-text", "pane send-keys"];

// Checks everything one fake herdr was asked to run: only allowed commands,
// never --machine, keys from the grammar only, reads in their one shape, and
// every send straight after a re-check (`agent get` or `pane get`) of that
// pane, except the Enter that ends a message, straight after its text. Text
// sent after `agent get` (a custom-kind agent) is one bracketed paste the
// text can't end early; a plain shell's text (after `pane get`) is as typed.
export function auditCalls(calls: string[][], allowed: readonly string[] = HERDR_COMMANDS) {
  calls.forEach((call, index) => {
    const command = call.slice(0, 2).join(" ");
    expect([call, allowed.includes(command)]).toEqual([call, true]);
    expect(call).not.toContain("--machine");
    if (call[1] === "send-keys") for (const key of call.slice(3)) expect([key, VALID_KEYS.includes(key)]).toEqual([key, true]);
    // A read is the plain one or, for a screen, the same with `--format ansi`.
    if (command === "agent read" || command === "pane read") {
      expect([[], ["--format", "ansi"]]).toContainEqual(call.slice(3, 7).join(" ") === "--source recent-unwrapped --lines 200" ? call.slice(7) : call);
    }
    // The one terminal command is the read-only observe stream (D30).
    if (command === "terminal session") expect([call[2], call[4], call[6], call.length]).toEqual(["observe", "--cols", "--rows", 8]);
    if (!SENDS.includes(command)) return;
    const previous = calls[index - 1] ?? [];
    const afterText = command === "pane send-keys" && call[3] === "enter" && previous.slice(0, 3).join(" ") === `pane send-text ${call[2]}`;
    if (!afterText) expect([["agent", "get", call[2]], ["pane", "get", call[2]]]).toContainEqual(previous);
    if (command === "pane send-text") {
      expect(call).toHaveLength(4);
      if (previous[0] === "agent") {
        expect(call[3].startsWith("\x1b[200~") && call[3].endsWith("\x1b[201~")).toBe(true);
        expect(call[3].slice(6, -6)).not.toContain("\x1b[201~");
      }
    }
  });
}

// Every fake the harnesses made; a test file removes them after its last test.
const fakes: ReturnType<typeof makeFakeHerdr>[] = [];
export const disposeFakes = () => fakes.splice(0).forEach((fake) => fake.dispose());

// `contentType: null` sends a body with no Content-Type header at all.
type RequestOptions = { body?: unknown; login?: string | null; headers?: Record<string, string>; contentType?: string | null };

// The app starts its clock at 1000 ms; setClock moves it. A body is sent as
// JSON unless it is already a string. A custom-kind message goes to Enter
// without the 300 ms wait (its default is tested on its own). After every
// request, everything the fake herdr ran so far is audited (auditCalls),
// against `allowed`.
export function makeHarness(
  config: FakeConfig,
  { history, allowed = HERDR_COMMANDS }: { history?: (herdr: Herdr) => ReturnType<typeof createHistory>; allowed?: readonly string[] } = {},
) {
  const fake = makeFakeHerdr(config);
  fakes.push(fake);
  let clock = 1_000;
  const herdr = createHerdr(fake.bin, { submitDelayMs: 0 });
  const app = createApp({ herdr, allowedLogin: ALLOWED_LOGIN, webRoot: WEB, now: () => clock, history: history?.(herdr) });
  const request = async (method: string, path: string, { body, login = ALLOWED_LOGIN, headers: extra = {}, contentType = "application/json" }: RequestOptions = {}) => {
    const headers = new Headers();
    if (login !== null) headers.set("Tailscale-User-Login", login);
    if (body !== undefined && contentType !== null) headers.set("content-type", contentType);
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
    const response = await app(new Request(`http://127.0.0.1:8787${path}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }));
    auditCalls(fake.calls(), allowed);
    return response;
  };
  return { fake, request, setClock: (ms: number) => (clock = ms), calls: () => fake.calls() };
}

// The bracketed paste a custom-kind agent's message is typed in.
export const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

// Reads have no fixed order (they run in parallel), so calls are compared sorted.
export const sorted = (calls: string[][]) => [...calls].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

// herdr's error answer for a failed command; `id` is the request id herdr echoes.
export const herdrError = (code: string, message: string, id = "cli:request") => ({ exit: 1, stderr: JSON.stringify({ error: { code, message }, id }) });

// herdr's answer to `--format` when it doesn't know the flag.
export const FORMAT_UNSUPPORTED = { exit: 2, stderr: "error: unexpected argument '--format' found\n" };
// Every way herdr says it can't give a styled read: the answer above, and
// herdr 0.9.5's own words for an unknown flag and an unknown read format
// (probed read-only on the laptop, exit 2 with plain stderr).
export const FORMAT_REFUSALS = [FORMAT_UNSUPPORTED, { exit: 2, stderr: "unknown option: --format\n" }, { exit: 2, stderr: "invalid read format: ansi\n" }];
// Styled reads that failed for another reason: herdr's own error, and a failure with plain stderr.
export const OTHER_READ_FAILURES: [code: string, answer: { exit: number; stderr: string }][] = [
  ["server_unreachable", herdrError("server_unreachable", "herdr server not running", "cli:pane:read")],
  ["herdr_failed", { exit: 1, stderr: "something broke\n" }],
];
