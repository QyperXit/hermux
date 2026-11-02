// GET /api/agents: the list home uses, each agent with its latest line. Reads
// and sends of one terminal are on the terminal routes (terminals.test.ts,
// send.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { RECENT_IDLE_READS } from "../server/roster";
import { disposeFakes, sorted } from "./support/http";
import { FOOTER } from "./support/screens";
import { AGENTS, BLOCKED, CUSTOM, PANE, TABS, setup } from "./support/agents";

afterAll(disposeFakes);

describe.concurrent("agent list", () => {
  const read = (pane: string) => ["agent", "read", pane, "--source", "recent-unwrapped", "--lines", "200"];
  const listAgents = async (request: ReturnType<typeof setup>["request"]) => {
    const response = await request("GET", "/api/agents");
    expect(response.status).toBe(200);
    return (await response.json()).agents as Record<string, unknown>[];
  };

  test("list passes herdr's agents through and adds each one's tab and `latest_line` for the active ones and the recent idle ones", async () => {
    const { request, calls } = setup({
      agents: AGENTS,
      tabs: TABS,
      outputs: { [BLOCKED]: `Upload to which track?${FOOTER}`, [PANE]: `Running the chart tests\n ∀ Gestating...${FOOTER}`, [CUSTOM]: `idle words${FOOTER}` },
    });
    expect(await listAgents(request)).toEqual([
      { ...AGENTS[0], tab: { id: "w8:t3", label: "2", number: 3 }, latest_line: "Upload to which track?" },
      { ...AGENTS[1], tab: { id: "w9:tD", label: "next work", number: 13 }, latest_line: "Running the chart tests" },
      { ...AGENTS[2], tab: { id: "w9:tE", label: "5", number: 14 }, latest_line: "idle words" },
    ]);
    expect(sorted(calls())).toEqual(sorted([["agent", "list"], ["tab", "list"], read(BLOCKED), read(PANE), read(CUSTOM)]));
  });

  test("the list answers normally whatever `lines` holds", async () => {
    const { request, calls } = setup({ agents: [AGENTS[2]], outputs: { [CUSTOM]: `idle words${FOOTER}` } });
    for (const query of ["", "?lines=", "?lines=,,,", "?lines=%2C%25zz", `?lines=${"x".repeat(5000)}`, "?lines=a&lines=b"]) {
      const response = await request("GET", `/api/agents${query}`);
      expect(response.status).toBe(200);
      expect((await response.json()).agents[0].latest_line).toBe("idle words");
    }
    expect(calls().filter((call) => call[1] === "read").map((call) => call[2])).toEqual([CUSTOM]);
  });

  test("`lines` names idle panes, comma-separated, that the list reads beyond the recent ones", async () => {
    const idle = Array.from({ length: RECENT_IDLE_READS + 3 }, (_, index) => ({ pane_id: `w2:p${index}`, agent_status: "idle", state_change_seq: 100 + index }));
    const { request } = setup({ agents: idle, outputs: Object.fromEntries(idle.map((agent) => [agent.pane_id, `words of ${agent.pane_id}${FOOTER}`])) });
    const response = await request("GET", `/api/agents?lines=${encodeURIComponent("w2:p0,w2:p1")}`);
    const lines = Object.fromEntries(((await response.json()).agents as Record<string, unknown>[]).map((agent) => [agent.pane_id, agent.latest_line]));
    expect([lines["w2:p0"], lines["w2:p1"], lines["w2:p2"]]).toEqual(["words of w2:p0", "words of w2:p1", undefined]);
  });
});
