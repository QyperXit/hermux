// The home and All screens' markup (web/screens.js): the notifications bell and
// the theme key sit together in each header (D33), and the All screen no longer
// ends in a Notifications section; the rest of each screen is as it was.
import { describe, expect, test } from "bun:test";
import { memoryStorage, homeLists } from "../web/home.js";
import { bellHtml } from "../web/notifications.js";
import { allScreenHtml, homeScreenHtml } from "../web/screens.js";
import type { Snapshot } from "../web/session.js";

const agents = [
  { pane_id: "w1:p1", agent_status: "blocked", cwd: "/home/you/weather-app", terminal_title_stripped: "atomic - weather-app", state_change_seq: 2 },
  { pane_id: "w1:p2", agent_status: "working", cwd: "/home/you/hermux", terminal_title_stripped: "atomic - hermux", state_change_seq: 1 },
];
const view = { route: { name: "all" }, streaming: true, loaded: true, updatedAt: 0, listError: null, agents, terminals: [], terminalsLoaded: false, terminal: null, missing: null, workspace: null, output: { text: null, error: null }, sending: false } satisfies Snapshot;

const bell = bellHtml({ status: "on", busy: false, message: "", error: false, demo: false }, false);
const theme = '<button class="theme-key" type="button" aria-label="Theme: System. Switch to Light"></button>';
const keys = bell + theme;

describe("the All screen", () => {
  const html = allScreenHtml({ view, keys });

  test("its header has the bell next to the theme key", () => {
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain(bell);
    expect(header.indexOf(bell)).toBeLessThan(header.indexOf(theme));
    expect(header).toContain("All terminals");
    expect(header).toContain('href="#/"');
  });

  test("it has no Notifications section or its controls", () => {
    expect(html).not.toContain("Notifications</span>");
    for (const gone of ["notify-body", "notify-toggle", "notify-test", "notify-note", "Send test", "Turn on"]) expect(html).not.toContain(gone);
  });

  test("it still lists every agent, and says when the list can't be read", () => {
    expect(html).toContain("weather-app");
    expect(html).toContain("hermux");
    expect(html).toContain("2 agents · newest activity first");
    const offline = allScreenHtml({ view: { ...view, loaded: false, agents: [], listError: { code: "unreachable", message: "Can't reach the laptop." } }, keys });
    expect(offline).toContain("No agent list yet.");
  });
});

describe("the home screen", () => {
  const home = homeLists(agents, memoryStorage());
  const html = homeScreenHtml({ view: { ...view, route: { name: "home" } }, home, freshness: '<span class="freshness">Live</span>', keys });

  test("its header has the freshness line, then the bell, then the theme key", () => {
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain("Agents");
    expect(header.indexOf("Live")).toBeLessThan(header.indexOf(bell));
    expect(header.indexOf(bell)).toBeLessThan(header.indexOf(theme));
  });

  test("it shows the summary and the lamp for an agent that needs you", () => {
    expect(html).toContain("1 needs you · 1 working");
    expect(html).toContain('data-status="blocked"');
  });

  test("it has no notifications section either", () => {
    expect(html).not.toContain("notify-body");
  });
});
