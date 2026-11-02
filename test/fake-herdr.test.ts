// The fake herdr itself: it must refuse what real herdr would do outside the
// server's allowlist, or the server tests could pass on commands the server
// must never run.
import { expect, test } from "bun:test";
import { makeFakeHerdr } from "./fake-herdr";

const ATOMIC = "w9:pD";
const SHELL_PANE = "w9:p2";

test("the fake herdr refuses every command outside the allowlist", () => {
  const fake = makeFakeHerdr({
    agents: [{ agent: "atomic", pane_id: ATOMIC, agent_status: "idle", workspace_id: "w9", tab_id: "w9:t1" }],
    shells: [{ pane_id: SHELL_PANE, workspace_id: "w9", tab_id: "w9:t2" }],
  });
  try {
    for (const argv of [
      ["pane", "run", SHELL_PANE, "id"],
      ["pane", "close", SHELL_PANE],
      ["pane", "list", "--workspace", "w9"],
      ["agent", "start"],
      ["agent", "focus", ATOMIC],
      ["agent", "rename", ATOMIC, "x"],
      ["server", "stop"],
      ["tab", "close", "w9:t2"],
      ["workspace", "create"],
      ["terminal", "session", "control", SHELL_PANE],
      ["terminal", "attach", SHELL_PANE],
      ["terminal", "session", "observe", SHELL_PANE],
    ]) {
      const result = Bun.spawnSync([fake.bin, ...argv]);
      expect([argv.join(" "), result.exitCode]).toEqual([argv.join(" "), 2]);
    }
  } finally {
    fake.dispose();
  }
});
