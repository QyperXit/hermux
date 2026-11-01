// A stand-in for the herdr binary. makeFakeHerdr() writes a small executable that
// records every argv it receives (one JSON line per call) and answers like herdr
// 0.9.5 does: JSON on stdout on success, JSON error on stderr with exit 1.
// It knows only the allowlist: `agent list/get/read/prompt/send-keys`,
// `pane list/get/read/send-text/send-keys`, `workspace list` and `tab list`;
// anything else is a usage error (exit 2).
//
// Its panes, as `pane list` gives them (shapes copied from herdr 0.9.5 on the
// laptop, read-only, 2026-10-30): every agent's pane, with `agent` and
// `agent_status` but without the agent's seqs, and every plain shell in
// `shells`, without `agent`. Plain shells report `agent_status: "unknown"`.
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeAgent = { pane_id: string; agent_status: string; state_change_seq?: number; [field: string]: unknown };
export type FakePane = { pane_id: string; workspace_id?: string; tab_id?: string; [field: string]: unknown };

export type FakeConfig = {
  agents?: FakeAgent[];
  // Plain shell panes (no agent).
  shells?: FakePane[];
  workspaces?: { workspace_id: string; label: string; [field: string]: unknown }[];
  tabs?: { tab_id: string; workspace_id: string; label: string; [field: string]: unknown }[];
  // What `agent read` and `pane read` return per pane.
  outputs?: Record<string, string>;
  // What a read with `--format ansi` returns per pane (default: `outputs`).
  ansiOutputs?: Record<string, string>;
  // Replace the answer of one subcommand: "list", "get", "read", "prompt" and
  // "send-keys" are the agent ones; "pane list", "pane get", "pane read",
  // "pane send-text", "pane send-keys", "workspace list" and "tab list" the others.
  // "read --format ansi" and "pane read --format ansi" replace only the styled reads.
  // "read <pane>" and "pane read <pane>" replace the plain and styled reads of one pane.
  answers?: Record<string, { exit: number; stdout?: string; stderr?: string }>;
};

export function makeFakeHerdr(config: FakeConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fake-herdr-"));
  const bin = join(dir, "herdr");
  const setConfig = (next: FakeConfig) => writeFileSync(join(dir, "config.json"), JSON.stringify(next));
  setConfig(config);
  writeFileSync(
    bin,
    `#!${process.execPath}\nimport { runFakeHerdr } from ${JSON.stringify(import.meta.path)};\nrunFakeHerdr(${JSON.stringify(dir)});\n`,
  );
  chmodSync(bin, 0o755);
  return {
    bin,
    setConfig,
    calls(): string[][] {
      const log = join(dir, "calls.jsonl");
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    // Removes its temporary directory. Call it once nothing will run the fake again.
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const notFound = (id: string, target: string) => ({
  exit: 1,
  stderr: JSON.stringify({ error: { code: "agent_not_found", message: `agent target ${target} not found` }, id }),
});

const paneNotFound = (target: string, command: string) => ({
  exit: 1,
  stderr: JSON.stringify({ error: { code: "pane_not_found", message: `pane ${target} not found` }, id: `cli:pane:${command}` }),
});

// `pane list` order: by workspace, then tab, then pane.
function panesOf(config: FakeConfig): FakePane[] {
  const agentPanes = (config.agents ?? []).map(({ state_change_seq, completion_seq, ...pane }) => pane as FakePane);
  const key = (pane: FakePane) => `${pane.workspace_id ?? ""}\u0000${pane.tab_id ?? ""}\u0000${pane.pane_id}`;
  return [...agentPanes, ...(config.shells ?? []).map((shell) => ({ agent_status: "unknown", ...shell }))].sort((a, b) => key(a).localeCompare(key(b)));
}

export function runFakeHerdr(dir: string) {
  const argv = process.argv.slice(2);
  appendFileSync(join(dir, "calls.jsonl"), `${JSON.stringify(argv)}\n`);
  const config: FakeConfig = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  const [group, command, target] = argv;
  const id = `cli:${group}:${command}`;
  const agents = config.agents ?? [];
  const agent = agents.find((candidate) => candidate.pane_id === target);
  const panes = panesOf(config);
  const pane = panes.find((candidate) => candidate.pane_id === target);
  const ok = (result: unknown) => ({ exit: 0, stdout: `${JSON.stringify({ id, result })}\n` });
  const styled = argv.includes("--format");
  const read = () => ({ exit: 0, stdout: (styled ? config.ansiOutputs?.[target] : undefined) ?? config.outputs?.[target] ?? "" });

  let answer: { exit: number; stdout?: string; stderr?: string };
  const unexpected = { exit: 2, stderr: `fake herdr: unexpected command ${argv.join(" ")}\n` };
  if (group === "workspace" || group === "tab") {
    if (command !== "list" || argv.length !== 2) answer = unexpected;
    else answer = config.answers?.[`${group} list`] ?? ok(group === "workspace" ? { type: "workspace_list", workspaces: config.workspaces ?? [] } : { type: "tab_list", tabs: config.tabs ?? [] });
  } else if (group === "pane") {
    if (!["list", "get", "read", "send-text", "send-keys"].includes(command) || (command === "list" && argv.length !== 2)) {
      answer = unexpected;
    } else if (command === "read" && styled && config.answers?.["pane read --format ansi"]) {
      answer = config.answers["pane read --format ansi"];
    } else if (config.answers?.[`pane ${command} ${target}`]) {
      answer = config.answers[`pane ${command} ${target}`];
    } else if (config.answers?.[`pane ${command}`]) {
      answer = config.answers[`pane ${command}`];
    } else if (command === "list") {
      answer = ok({ type: "pane_list", panes });
    } else if (!pane) {
      answer = paneNotFound(target, command);
    } else if (command === "get") {
      answer = ok({ pane, type: "pane_info" });
    } else if (command === "read") {
      answer = read();
    } else {
      answer = { exit: 0, stdout: `${JSON.stringify({ id: "cli:request", result: { type: "ok" } })}\n` };
    }
  } else if (group !== "agent") {
    answer = unexpected;
  } else if (config.answers?.[`${command} ${target}`]) {
    answer = config.answers[`${command} ${target}`];
  } else if (config.answers?.[command]) {
    answer = config.answers[command];
  } else if (command === "list") {
    answer = ok({ agents });
  } else if (!["get", "read", "prompt", "send-keys"].includes(command)) {
    answer = unexpected;
  } else if (!agent) {
    answer = notFound(id, target);
  } else if (command === "get") {
    answer = ok({ agent, type: "agent_info" });
  } else if (command === "read" && styled) {
    // herdr's `--format ansi`: the styled text when one is set, else the plain text.
    answer = config.answers?.["read --format ansi"] ?? read();
  } else if (command === "read") {
    answer = read();
  } else {
    answer = ok({ type: "ok" });
  }

  if (answer.stdout) process.stdout.write(answer.stdout);
  if (answer.stderr) process.stderr.write(answer.stderr);
  process.exit(answer.exit);
}
