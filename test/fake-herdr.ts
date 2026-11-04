// Its panes, as `pane list` gives them (shapes copied from herdr 0.9.5 on the
// laptop, read-only, 2026-10-30): every agent's pane, with `agent` and
// `agent_status` but without the agent's seqs, and every plain shell in
// `shells`, without `agent`. Plain shells report `agent_status: "unknown"`.
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupAfterTests } from "./support/cleanup";

export type FakeAgent = { pane_id: string; agent_status: string; state_change_seq?: number; [field: string]: unknown };
export type FakePane = { pane_id: string; workspace_id?: string; tab_id?: string; [field: string]: unknown };

type Answer = { exit: number; stdout?: string; stderr?: string };
type AgentCommand = "list" | "get" | "read" | "prompt" | "send-keys";
type PaneCommand = `pane ${"list" | "get" | "read" | "send-text" | "send-keys"}`;
type AnswerKey = AgentCommand | PaneCommand | `${AgentCommand | PaneCommand} ${string}` | "workspace list" | "tab list";

export type FakeConfig = {
  agents?: FakeAgent[];
  shells?: FakePane[];
  workspaces?: { workspace_id: string; label: string; [field: string]: unknown }[];
  tabs?: { tab_id: string; workspace_id: string; label: string; [field: string]: unknown }[];
  outputs?: Record<string, string>;
  ansiOutputs?: Record<string, string>;
  answers?: Partial<Record<AnswerKey, Answer>>;
  // What `terminal session observe <pane> --cols N --rows N` streams per pane:
  // its frames, one JSON line each, then it exits with `exit` (and `stderr`),
  // or, without `exit`, runs until it is killed.
  observe?: Record<string, { frames: Record<string, unknown>[]; exit?: number; stderr?: string } | "gone">;
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
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  cleanupAfterTests(dispose);
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
    observers(): number[] {
      const log = join(dir, "observers.jsonl");
      return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map(Number) : [];
    },
    dispose,
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

function panesOf(config: FakeConfig): FakePane[] {
  const agentPanes = (config.agents ?? []).map(({ state_change_seq, completion_seq, ...pane }) => pane as FakePane);
  const key = (pane: FakePane) => `${pane.workspace_id ?? ""}\u0000${pane.tab_id ?? ""}\u0000${pane.pane_id}`;
  return [...agentPanes, ...(config.shells ?? []).map((shell) => ({ agent_status: "unknown", ...shell }))].sort((a, b) => key(a).localeCompare(key(b)));
}

export function runFakeHerdr(dir: string) {
  const argv = process.argv.slice(2);
  appendFileSync(join(dir, "calls.jsonl"), `${JSON.stringify(argv)}\n`);
  const config: FakeConfig = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  const answers = (config.answers ?? {}) as Record<string, Answer>;
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
  if (group === "terminal") {
    const [, , action, paneId, ...flags] = argv;
    const stream = config.observe?.[paneId];
    if (command !== "session" || action !== "observe" || flags.length !== 4 || flags[0] !== "--cols" || flags[2] !== "--rows") answer = unexpected;
    else if (stream === "gone" || !panes.some((candidate) => candidate.pane_id === paneId)) answer = paneNotFound(paneId, "observe");
    else if (stream === undefined) answer = unexpected;
    else {
      for (const frame of stream.frames) process.stdout.write(`${JSON.stringify(frame)}\n`);
      if (stream.exit === undefined) {
        appendFileSync(join(dir, "observers.jsonl"), `${process.pid}\n`);
        setInterval(() => {}, 60_000);
        return;
      }
      answer = { exit: stream.exit, stderr: stream.stderr };
    }
  } else if (group === "workspace" || group === "tab") {
    if (command !== "list" || argv.length !== 2) answer = unexpected;
    else answer = answers[`${group} list`] ?? ok(group === "workspace" ? { type: "workspace_list", workspaces: config.workspaces ?? [] } : { type: "tab_list", tabs: config.tabs ?? [] });
  } else if (group === "pane") {
    if (!["list", "get", "read", "send-text", "send-keys"].includes(command) || (command === "list" && argv.length !== 2)) {
      answer = unexpected;
    } else if (command === "read" && styled && answers["pane read --format ansi"]) {
      answer = answers["pane read --format ansi"];
    } else if (answers[`pane ${command} ${target}`]) {
      answer = answers[`pane ${command} ${target}`];
    } else if (answers[`pane ${command}`]) {
      answer = answers[`pane ${command}`];
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
  } else if (answers[`${command} ${target}`]) {
    answer = answers[`${command} ${target}`];
  } else if (answers[command]) {
    answer = answers[command];
  } else if (command === "list") {
    answer = ok({ agents });
  } else if (!["get", "read", "prompt", "send-keys"].includes(command)) {
    answer = unexpected;
  } else if (!agent) {
    answer = notFound(id, target);
  } else if (command === "get") {
    answer = ok({ agent, type: "agent_info" });
  } else if (command === "read" && styled) {
    answer = answers["read --format ansi"] ?? read();
  } else if (command === "read") {
    answer = read();
  } else {
    answer = ok({ type: "ok" });
  }

  if (answer.stdout) process.stdout.write(answer.stdout);
  if (answer.stderr) process.stderr.write(answer.stderr);
  process.exit(answer.exit);
}
