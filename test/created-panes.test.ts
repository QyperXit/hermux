import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createdPanes } from "./live/created-panes";

const LIVE = resolve(import.meta.dir, "live");

test("a live script's herdr commands type into and close only the tabs and panes it created", () => {
  const guard = createdPanes();
  guard.addTab("w1:t9");
  guard.addPane("w1:p9");
  for (const args of [["pane", "send-text", "w1:p9", "echo hi"], ["pane", "send-keys", "w1:p9", "enter"], ["agent", "prompt", "w1:p9", "hi"], ["agent", "send-keys", "w1:p9", "ctrl+c"], ["tab", "close", "w1:t9"]]) {
    expect(guard.herdrArgs(args)).toBe(args);
  }
  for (const args of [["pane", "send-text", "w1:p1", "echo hi"], ["pane", "send-keys", "w8:pM", "enter"], ["pane", "run", "w1:p1", "id"], ["pane", "close", "w1:p1"], ["agent", "prompt", "w1:p1", "hi"], ["agent", "send-keys", "w1:p1", "ctrl+c"], ["tab", "close", "w1:t1"], ["tab", "close", "w1:p9"]]) {
    expect(() => guard.herdrArgs(args)).toThrow("this script didn't create it");
  }
  for (const args of [["tab", "list"], ["agent", "list"], ["agent", "get", "w1:p1"], ["pane", "read", "w1:p1", "--lines", "200"], ["tab", "create", "--workspace", "w1", "--no-focus"]]) {
    expect(guard.herdrArgs(args)).toBe(args);
  }
});

test("a live script sends through the server's prompt and keys routes only to its own panes, or to a pane it names as missing", () => {
  const guard = createdPanes();
  guard.addPane("w1:p9");
  expect(guard.route("POST", "/api/terminals/w1%3Ap9/prompt")).toBe("/api/terminals/w1%3Ap9/prompt");
  expect(guard.route("POST", "/api/agents/w1%3Ap9/keys")).toBe("/api/agents/w1%3Ap9/keys");
  expect(() => guard.route("POST", "/api/terminals/w1%3Ap1/prompt")).toThrow("this script didn't create it");
  expect(() => guard.route("POST", "/api/terminals/w1%3Ap1/keys")).toThrow("this script didn't create it");
  expect(() => guard.route("POST", "/api/agents/w1%3Ap1/prompt")).toThrow("this script didn't create it");
  expect(guard.route("GET", "/api/terminals/w1%3Ap1/output")).toBe("/api/terminals/w1%3Ap1/output");
  expect(guard.route("GET", "/api/terminals")).toBe("/api/terminals");
  expect(() => guard.route("POST", "/api/terminals/w99%3Ap99/prompt")).toThrow("this script didn't create it");
  guard.addMissing("w99:p99");
  expect(guard.route("POST", "/api/terminals/w99%3Ap99/prompt")).toBe("/api/terminals/w99%3Ap99/prompt");
});

test("every live script runs herdr, and sends to the server, only through its created-panes guard", () => {
  const scripts = readdirSync(LIVE).filter((file) => file.endsWith(".ts") && file !== "created-panes.ts" && file !== "key-recorder.ts");
  expect(scripts.sort()).toEqual(["key-probe.ts", "live-check.ts", "stream-check.ts"]);
  for (const file of scripts) {
    const source = readFileSync(resolve(LIVE, file), "utf8");
    const spawns = [...source.matchAll(/Bun\.spawn(?:Sync)?\(\[\s*herdrBin\b([^\]]*)\]/g)].map((match) => match[1]);
    expect([file, spawns.length > 0 && spawns.every((args) => args === ", ...guard.herdrArgs(args)")]).toEqual([file, true]);
    const untemplated = [...source.matchAll(/\bfetch\((?!\s*`\$\{base\})[^\n]*/g)].map((match) => match[0]);
    expect([file, untemplated]).toEqual([file, []]);
    const paths = [...source.matchAll(/fetch\(\s*`\$\{base\}([^`]*)`/g)].map((match) => match[1]);
    const unguarded = paths.filter((path) => (path.includes("${") ? path !== "${guard.route(method, path)}" : /\/(?:prompt|keys)\b/.test(path)));
    expect([file, unguarded]).toEqual([file, []]);
  }
});
