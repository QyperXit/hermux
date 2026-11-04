import { expect } from "bun:test";
import { resolve } from "node:path";
import { createApp } from "../../server/app";
import { createHerdr, type Herdr } from "../../server/herdr";
import type { createHistory } from "../../server/history";
import { makeFakeHerdr, type FakeConfig } from "../fake-herdr";
import { VALID_KEYS } from "./key-grammar";

const WEB = resolve(import.meta.dir, "../../web");

export const ALLOWED_LOGIN = "you@example.com";

export const HERDR_COMMANDS = ["agent list", "agent get", "agent read", "agent prompt", "agent send-keys", "pane list", "pane get", "pane read", "pane send-text", "pane send-keys", "workspace list", "tab list", "terminal session"];
export const AGENT_LIST_COMMANDS = ["agent list", "tab list", "agent read", "pane read"];
const SENDS = ["agent prompt", "agent send-keys", "pane send-text", "pane send-keys"];

export function auditCalls(calls: string[][], allowed: readonly string[] = HERDR_COMMANDS) {
  calls.forEach((call, index) => {
    const command = call.slice(0, 2).join(" ");
    expect([call, allowed.includes(command)]).toEqual([call, true]);
    expect(call).not.toContain("--machine");
    if (call[1] === "send-keys") for (const key of call.slice(3)) expect([key, VALID_KEYS.includes(key)]).toEqual([key, true]);
    if (command === "agent read" || command === "pane read") {
      expect([[], ["--format", "ansi"]]).toContainEqual(call.slice(3, 7).join(" ") === "--source recent-unwrapped --lines 200" ? call.slice(7) : call);
    }
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

type RequestOptions = { body?: unknown; login?: string | null; headers?: Record<string, string>; contentType?: string | null };

export function makeHarness(
  config: FakeConfig,
  { history, allowed = HERDR_COMMANDS }: { history?: (herdr: Herdr) => ReturnType<typeof createHistory>; allowed?: readonly string[] } = {},
) {
  const fake = makeFakeHerdr(config);
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

export const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

export const sorted = (calls: string[][]) => [...calls].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

export const herdrError = (code: string, message: string, id = "cli:request") => ({ exit: 1, stderr: JSON.stringify({ error: { code, message }, id }) });

export const FORMAT_UNSUPPORTED = { exit: 2, stderr: "error: unexpected argument '--format' found\n" };
// Every way herdr says it can't give a styled read: the answer above, and
// herdr 0.9.5's own words for an unknown flag and an unknown read format
// (probed read-only on the laptop, exit 2 with plain stderr).
export const FORMAT_REFUSALS = [FORMAT_UNSUPPORTED, { exit: 2, stderr: "unknown option: --format\n" }, { exit: 2, stderr: "invalid read format: ansi\n" }];
export const OTHER_READ_FAILURES: [code: string, answer: { exit: number; stderr: string }][] = [
  ["server_unreachable", herdrError("server_unreachable", "herdr server not running", "cli:pane:read")],
  ["herdr_failed", { exit: 1, stderr: "something broke\n" }],
];
