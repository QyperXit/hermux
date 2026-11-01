// What the terminal switcher sheet, the screen header and the All list say
// about each terminal (web/terminals.js). No DOM: the page's own functions.
import { expect, test } from "bun:test";
import {
  allCountLine,
  closesOnSwipe,
  hasSwitcher,
  kindLine,
  lineErrorHtml,
  lineErrorText,
  retryingText,
  sendTarget,
  sheetRowsHtml,
  sheetTitle,
  shellTerminals,
  switcherRows,
  terminalName,
  terminalOfAgent,
} from "../web/terminals.js";

type Terminal = {
  pane_id: string;
  kind: string;
  status: string | null;
  workspace: { id: string | null; label: string | null };
  tab: { id: string | null; label: string | null };
  cwd: string | null;
  title: string | null;
  latest_line?: string | null;
  latest_line_error?: { code: string; message: string };
};

const hermux = { id: "wF", label: "hermux" };
const terminal = (pane_id: string, kind: string, over: Partial<Terminal> = {}): Terminal => ({
  pane_id,
  kind,
  status: kind === "shell" ? null : "idle",
  workspace: hermux,
  tab: { id: `${pane_id}-tab`, label: "1" },
  cwd: "/home/you/projects/hermux",
  title: kind === "shell" ? "you@laptop:~/hermux$" : "atomic - hermux",
  ...over,
});

test("a terminal is named by its tab's label; herdr's own tab number gives way to the agent's session, then to its kind", () => {
  const named = terminal("wF:p1", "atomic", { tab: { id: "t", label: "new next" }, title: "atomic - other - hermux" });
  expect(terminalName(named)).toBe("new next");
  const session = terminal("wF:p1", "atomic", { title: "atomic - fix the build - hermux" });
  expect(terminalName(session)).toBe("fix the build");
  expect(terminalName(terminal("wF:p1", "atomic"))).toBe("atomic");
  expect(terminalName(terminal("wF:pM", "shell", { tab: { id: "t", label: "term" } }))).toBe("term");
  expect(terminalName(terminal("wF:pM", "shell"))).toBe("shell");
  // A shell's title is its prompt: never a name.
  expect(terminalName(terminal("wF:pM", "shell", { tab: { id: null, label: null } }))).toBe("shell");
});

test("the Send key names an agent by its folder and a shell by its tab, or by its folder and 'shell' when the tab has only a number", () => {
  expect(sendTarget(terminal("wF:p1", "atomic"))).toBe("hermux");
  expect(sendTarget(terminal("wF:pM", "shell", { tab: { id: "t", label: "term" } }))).toBe("term");
  expect(sendTarget(terminal("wF:pN", "shell"))).toBe("hermux shell");
});

test("the line beside a name gives the kind (unless the name is it) and an agent's state in words", () => {
  expect(kindLine(terminal("wF:p1", "atomic", { status: "blocked", tab: { id: "t", label: "next work" } }))).toBe("atomic · Needs you");
  expect(kindLine(terminal("wF:p1", "atomic", { status: "working" }))).toBe("Working");
  expect(kindLine(terminal("wF:pM", "shell", { tab: { id: "t", label: "term" } }))).toBe("shell");
  expect(kindLine(terminal("wF:pN", "shell"))).toBe("");
});

test("the sheet has one row per pane in herdr's order, marks the one on screen 'here', and carries each last line", () => {
  const panes = [
    terminal("wF:p1", "atomic", { status: "working", tab: { id: "t1", label: "Atomic" }, latest_line: "Writing web/app.css" }),
    terminal("wF:pM", "shell", { tab: { id: "t2", label: "term" }, latest_line: "Agents server listening on http://127.0.0.1:8787" }),
    terminal("wF:pN", "shell"),
  ];
  expect(switcherRows(panes, "wF:pM")).toEqual([
    { pane_id: "wF:p1", shell: false, status: "working", name: "Atomic", kind: "atomic · Working", line: "Writing web/app.css", error: "", here: false },
    { pane_id: "wF:pM", shell: true, status: null, name: "term", kind: "shell", line: "Agents server listening on http://127.0.0.1:8787", error: "", here: true },
    { pane_id: "wF:pN", shell: true, status: null, name: "shell", kind: "", line: "", error: "", here: false },
  ]);
  expect(sheetTitle({ id: "wF", label: "hermux" }, panes)).toBe("hermux · 3 terminals");
  expect(sheetTitle(null, panes)).toBe("hermux · 3 terminals");
});

test("the header offers the switcher only when the workspace has another terminal", () => {
  expect(hasSwitcher([terminal("wF:p1", "atomic")])).toBe(false);
  expect(hasSwitcher([terminal("wF:p1", "atomic"), terminal("wF:pM", "shell")])).toBe(true);
});

test("the sheet's rows are escaped: a tab name or last line with markup is text, never HTML", () => {
  const html = sheetRowsHtml(
    switcherRows(
      [
        terminal("wF:pM", "shell", { tab: { id: "t", label: '<img src=x onerror="alert(1)">' }, latest_line: `</a><script>alert('x')</script> & "quotes"` }),
        terminal("wF:p1", "atomic", { status: "blocked", tab: { id: "t", label: "ok" } }),
      ],
      "wF:p1",
    ),
    (paneId: string) => `#/agent/${encodeURIComponent(paneId)}`,
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script");
  expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  expect(html).toContain("&lt;/a&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quotes&quot;");
  // The pane on screen says so, and is the only one marked current.
  expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  expect(html).toContain('href="#/agent/wF%3ApM"');
});


test("a row whose latest line couldn't be read says why in the line's place, escaped, in the quiet meta style", () => {
  const failing = terminal("wF:pM", "shell", { latest_line: null, latest_line_error: { code: "server_unreachable", message: `herdr <b>down</b> & "out"` } });
  expect(lineErrorText(failing)).toBe(`Couldn't read its latest line. herdr said: herdr <b>down</b> & "out" (server_unreachable).`);
  expect(lineErrorText(terminal("wF:p1", "atomic", { latest_line: null, latest_line_error: { code: "herdr_unavailable", message: "Couldn't run herdr (herdr): ENOENT" } }))).toBe(
    "Couldn't read its latest line. The server couldn't run herdr on the laptop.",
  );
  expect(lineErrorText(terminal("wF:pN", "shell", { latest_line: null }))).toBe("");
  expect(lineErrorHtml(terminal("wF:pN", "shell", { latest_line: null }))).toBe("");
  const escaped = "Couldn&#39;t read its latest line. herdr said: herdr &lt;b&gt;down&lt;/b&gt; &amp; &quot;out&quot; (server_unreachable).";
  // The All and home rows (lineErrorHtml) and the sheet's rows say it the same way.
  expect(lineErrorHtml(failing)).toBe(`<span class="row-meta">${escaped}</span>`);
  const html = sheetRowsHtml(switcherRows([failing], "wF:p1"), (paneId: string) => `#/agent/${paneId}`);
  expect(html).toContain(`<span class="row-meta">${escaped}</span>`);
  expect(html).not.toContain("<b>");
  expect(html).not.toContain("pane-line");
  // An agent from the agent list carries it until the terminal list answers.
  const stand = terminalOfAgent({ pane_id: "w9:pD", agent: "atomic", agent_status: "working", latest_line: null, latest_line_error: { code: "herdr_failed", message: "boom" } });
  expect(lineErrorText(stand)).toBe("Couldn't read its latest line. herdr said: boom (herdr_failed).");
});
test("a shell row has the shell glyph where an agent has its lamp, and an agent row carries its state for the lamp", () => {
  const html = sheetRowsHtml(
    switcherRows([terminal("wF:pM", "shell"), terminal("wF:p1", "atomic", { status: "blocked" })], "wF:p1"),
    (paneId: string) => `#/agent/${paneId}`,
  );
  const [shell, agent] = html.split("</li>");
  expect(shell).toContain("#i-shell");
  expect(shell).not.toContain('class="lamp"');
  expect(shell).not.toContain("data-status");
  expect(agent).toContain('class="lamp"');
  expect(agent).toContain('data-status="blocked"');
});

test("a swipe down closes the sheet after 72px, or after a short quick flick, and not before", () => {
  expect(closesOnSwipe({ dy: 72, ms: 900 })).toBe(true);
  expect(closesOnSwipe({ dy: 71, ms: 900 })).toBe(false);
  expect(closesOnSwipe({ dy: 30, ms: 40 })).toBe(true);
  expect(closesOnSwipe({ dy: 30, ms: 200 })).toBe(false);
  expect(closesOnSwipe({ dy: 10, ms: 5 })).toBe(false);
  expect(closesOnSwipe({ dy: -80, ms: 100 })).toBe(false);
});

test("the All list gets the shells after the agents, with a count that says both", () => {
  const panes = [terminal("wF:p1", "atomic"), terminal("wF:pM", "shell"), terminal("w9:pA", "shell"), terminal("w9:pD", "pi")];
  expect(shellTerminals(panes).map((pane) => pane.pane_id)).toEqual(["wF:pM", "w9:pA"]);
  expect(allCountLine(18, 17)).toBe("18 agents · 17 shells · newest first");
  expect(allCountLine(1, 1)).toBe("1 agent · 1 shell · newest first");
});

test("an agent from the agent list stands in for its terminal until the terminal list answers", () => {
  const stand = terminalOfAgent({
    pane_id: "w9:pD",
    workspace_id: "w9",
    agent: "atomic",
    agent_status: "blocked",
    cwd: "/home/you/usage-dashboard",
    terminal_title_stripped: "atomic - next work - usage-dashboard",
    state_change_seq: 7,
    since: 123,
  });
  expect(stand).toMatchObject({ pane_id: "w9:pD", kind: "atomic", status: "blocked", workspace: { id: "w9" }, state_change_seq: 7, since: 123 });
  expect(terminalName(stand)).toBe("next work");
});

test("the list's offline line and a screen's lookup header say a failure the same way, and that it retries", () => {
  expect(retryingText({ code: "unreachable", message: "The laptop didn't answer." })).toBe("Can't reach the laptop. Retrying…");
  expect(retryingText({ code: "http_502", message: "" })).toBe("Can't reach the laptop. Retrying…");
  expect(retryingText({ code: "server_unreachable", message: "herdr said: herdr server not running (server_unreachable)." })).toBe(
    "herdr said: herdr server not running (server_unreachable). Retrying…",
  );
});
