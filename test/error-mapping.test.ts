import { describe, expect, test } from "bun:test";
import { createApp } from "../server/app";
import { createHerdr } from "../server/herdr";
import type { FakeConfig } from "./fake-herdr";
import { ALLOWED_LOGIN, herdrError } from "./support/http";
import { AGENTS, PI_PANE, WEB, setup } from "./support/agents";
import { CONFIG, PI, SHELL_PANE, keys, path, prompt, setup as terminalSetup } from "./support/terminals";

describe.concurrent("error mapping", () => {
  test("an unknown pane becomes 404 pane_not_found on every terminal route", async () => {
    const { request } = terminalSetup();
    for (const [method, route, init] of [
      ["GET", path("w99:p99", "output"), {}],
      ["POST", ...prompt("w99:p99", "hi", "pi")],
      ["POST", ...keys("w99:p99", ["esc"], "atomic")],
      ["POST", ...keys("w99:p99", ["esc"], "shell")],
    ] as const) {
      const response = await request(method, route, init);
      expect([route, response.status, await response.json()]).toEqual([route, 404, { error: { code: "pane_not_found", message: "pane w99:p99 not found" } }]);
    }
  });

  test("other herdr error codes pass through as 502", async () => {
    const { request } = terminalSetup({ ...CONFIG, answers: { "send-keys": herdrError("agent_not_ready", "agent is starting", "cli:agent:send-keys") } });
    const response = await request("POST", ...keys(PI, ["enter"], "pi"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "agent_not_ready", message: "agent is starting" } });
  });

  test("a herdr usage error (exit 2, plain text) becomes 502 herdr_failed with the text", async () => {
    const { request } = setup({ agents: AGENTS, answers: { list: { exit: 2, stderr: "usage: herdr agent list\n" } } });
    const response = await request("GET", "/api/agents");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "herdr_failed", message: "usage: herdr agent list" } });
  });

  // The pane, workspace and tab shapes are checked in terminals.test.ts.
  test("JSON from herdr in the wrong shape is 502 herdr_bad_output where it is parsed, never passed on", async () => {
    const out = (result: unknown) => ({ exit: 0, stdout: JSON.stringify({ id: "cli:request", result }) });
    const cases: [string, FakeConfig["answers"]][] = [
      ["an agent list row without pane_id", { list: out({ agents: [{ agent: "pi", agent_status: "idle" }] }) }],
      ["an agent list row without agent_status", { list: out({ agents: [{ agent: "pi", pane_id: PI_PANE }] }) }],
      ["an agent list row that isn't an object", { list: out({ agents: ["w9:pD"] }) }],
      ["a result that isn't an object", { list: out("agents") }],
    ];
    for (const [name, answers] of cases) {
      const { request } = setup({ agents: AGENTS, answers });
      const response = await request("GET", "/api/agents");
      expect([name, response.status, (await response.json()).error?.code]).toEqual([name, 502, "herdr_bad_output"]);
    }
    // The re-check's `agent get` before a send.
    const gets: [string, FakeConfig["answers"]][] = [
      ["an agent get that isn't an agent", { get: out({ agent: 5, type: "agent_info" }) }],
      ["an agent get without pane_id", { get: out({ agent: { agent: "pi", agent_status: "idle" }, type: "agent_info" }) }],
    ];
    for (const [name, answers] of gets) {
      const { request, calls } = terminalSetup({ ...CONFIG, answers });
      const response = await request("POST", ...keys(PI, ["enter"], "pi"));
      expect([name, response.status, (await response.json()).error?.code]).toEqual([name, 502, "herdr_bad_output"]);
      expect(calls()).toEqual([["agent", "get", PI]]);
    }
  });

  test("herdr's error is read only when it has a string code; its message only when that is a string", async () => {
    const cases: [string, string, unknown][] = [
      [JSON.stringify({ error: { code: "server_unreachable", message: { text: "down" } } }), "server_unreachable", "server_unreachable"],
      [JSON.stringify({ error: { code: 5, message: "five" } }), "herdr_failed", JSON.stringify({ error: { code: 5, message: "five" } })],
      ["null", "herdr_failed", "null"],
      ["usage: herdr agent list\n", "herdr_failed", "usage: herdr agent list"],
    ];
    for (const [stderr, code, message] of cases) {
      const { request } = setup({ agents: AGENTS, answers: { list: { exit: 1, stderr } } });
      const response = await request("GET", "/api/agents");
      expect([stderr, response.status, await response.json()]).toEqual([stderr, 502, { error: { code, message } }]);
    }
  });

  test("output herdr can't parse becomes 502 herdr_bad_output", async () => {
    const { request } = setup({ agents: AGENTS, answers: { list: { exit: 0, stdout: "not json" } } });
    const response = await request("GET", "/api/agents");
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("herdr_bad_output");
  });

  test("a missing herdr binary becomes 503 herdr_unavailable", async () => {
    const app = createApp({ herdr: createHerdr("/nonexistent/herdr"), allowedLogin: ALLOWED_LOGIN, webRoot: WEB });
    const response = await app(new Request("http://127.0.0.1/api/agents", { headers: { "Tailscale-User-Login": ALLOWED_LOGIN } }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("herdr_unavailable");
  });

  test("unknown API routes and wrong methods are refused without running herdr", async () => {
    const { request, calls } = setup();
    expect((await request("GET", "/api/panes")).status).toBe(404);
    expect((await request("POST", "/api/agents", { body: {} })).status).toBe(405);
    expect((await request("DELETE", "/api/agents")).status).toBe(405);
    expect(calls()).toEqual([]);
  });

  test("the removed per-agent routes answer as unknown routes: 404 not_found for every method, and herdr never runs", async () => {
    const { request, calls } = setup();
    for (const paneId of [PI_PANE, SHELL_PANE, "w99:p99"]) {
      for (const action of ["", "/output", "/history", "/prompt", "/keys", "/focus"]) {
        const route = `/api/agents/${encodeURIComponent(paneId)}${action}`;
        for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"]) {
          const body = method === "POST" ? (action === "/keys" ? { keys: ["enter"], kind: "pi" } : { text: "hi", kind: "pi", agent: "pi" }) : undefined;
          const response = await request(method, route, { body });
          expect([method, route, response.status, (await response.json()).error.code]).toEqual([method, route, 404, "not_found"]);
        }
      }
    }
    expect((await request("GET", "/api/agents/w9%3ApD/history?before=3")).status).toBe(404);
    expect(calls()).toEqual([]);
  });
});
