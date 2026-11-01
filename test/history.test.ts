// Earlier messages from Atomic's session store, through the HTTP API.
// Each test builds its own store (test/support/session-store.ts) with entries
// in the real shapes, which the server opens READ-ONLY.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { STORE_RETRY_MS, createHistory, openSessionStore, type SessionStore } from "../server/history";
import { historyHtml } from "../web/history.js";
import type { FakeAgent } from "./fake-herdr";
import { disposeFakes, makeHarness } from "./support/http";
import { CWD, addEntries, addSession, makeStore, removeStores, type Entry } from "./support/session-store";

const PANE = "w8:p1";
const OTHER = "w8:p2";

// Entries in the shapes Atomic writes.
const user = (text: string): Entry => ({ type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: 1 } });
const assistant = (...content: unknown[]): Entry => ({
  type: "message",
  message: { role: "assistant", content, api: "anthropic-messages", model: "claude-opus-5-5", stopReason: "stop" },
});
const text = (value: string) => ({ type: "text", text: value });
const thinking = (value: string) => ({ type: "thinking", thinking: value, thinkingSignature: "CAQSlgcKEAgTGAI4AUIIdGhpbmtpbmcSDDxwGZ" });
const toolCall = (name: string, args: unknown) => ({ type: "toolCall", id: "toolu_01", name, arguments: args });
const toolResult = (value: string): Entry => ({ type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: value }] } });
const imageResult = (): Entry => ({
  type: "message",
  message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: "Read image file [image/png]" }, { type: "image", data: "iVBORw0KGgo".repeat(50), mimeType: "image/png" }] },
});
const custom = (): Entry => ({ type: "custom", customType: "task-completion-ack", data: { completionId: "x" } });

// Every fake herdr and store made in this file, removed after the last test.
afterAll(() => {
  disposeFakes();
  removeStores();
});

const agent = (pane_id: string, cwd = CWD): FakeAgent => ({ agent: "atomic", pane_id, agent_status: "idle", state_change_seq: 1, cwd });

function setup({ store, screens, agents = [agent(PANE), agent(OTHER)] }: { store: string | null; screens: Record<string, string>; agents?: FakeAgent[] }) {
  let opened: SessionStore | null = null;
  let candidateLookups = 0;
  const openStore = () => {
    if (!store) throw new Error("no store");
    opened = openSessionStore(store);
    const candidates = opened.candidates;
    return { ...opened, candidates: (cwd: string) => (candidateLookups++, candidates(cwd)) };
  };
  const { fake, request } = makeHarness({ agents, outputs: screens }, { history: (herdr) => createHistory({ herdr, openStore }) });
  const get = async (path: string, { login, method = "GET" }: { login?: string | null; method?: string } = {}) => {
    const response = await request(method, path, { login });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return { fake, get, opened: () => opened, candidateLookups: () => candidateLookups, setScreens: (next: Record<string, string>) => fake.setConfig({ agents, outputs: next }) };
}

const historyPath = (pane: string, query = "") => `/api/terminals/${encodeURIComponent(pane)}/history${query}`;
const allText = (messages: { blocks: { kind: string; text?: string; summary?: string }[] }[]) =>
  messages.flatMap((message) => message.blocks.map((block) => block.text ?? block.summary)).join("\n");

// A conversation of numbered turns; the screen shows the last two messages.
function numberedSession(id: string, turns: number, last = "the latest answer is on the screen right now") {
  const entries: Entry[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    entries.push(user(`question number ${turn} about the release`));
    entries.push(assistant(thinking(`secret thinking ${turn}`), toolCall("bash", { command: `echo step ${turn}` })));
    entries.push(toolResult(`step ${turn}`));
    entries.push(custom());
    entries.push(assistant(text(turn === turns ? last : `answer number ${turn} for the release notes`)));
  }
  return { id, entries };
}
const screenOf = (...lines: string[]) => ` ${lines.join("\n ")}\n ───────\n ❯ \n (anthropic) claude-opus-5-5 • ~/weather-app\n`;

describe.concurrent("history pages", () => {
  test("user and assistant messages come in order, page by page, with no message twice and none missed", async () => {
    const store = makeStore([numberedSession("s1", 40)]);
    const { get } = setup({
      store,
      screens: { [PANE]: screenOf("question number 40 about the release", "$ echo step 40", "the latest answer is on the screen right now") },
    });
    const seen: number[] = [];
    const pages = [];
    let before: number | null | undefined;
    do {
      const { status, body } = await get(historyPath(PANE, `?limit=7${before ? `&before=${before}` : ""}`));
      expect(status).toBe(200);
      pages.push(body.history);
      seen.unshift(...body.history.messages.map((message: { seq: number }) => message.seq));
      before = body.history.before;
    } while (before !== null && pages.length < 50);
    expect(pages[0].session).toBe("s1");
    expect(pages.slice(0, -1).every((page) => page.messages.length === 7)).toBe(true);
    // Every page is in order, and the pages join without a gap or a repeat.
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
    // Turns 1-39 are history: user, tool call and answer for each (thinking-only,
    // tool result and custom entries are not messages). Turn 40 is on screen.
    expect(seen.length).toBe(39 * 3);
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBe(39 * 5);
  });

  test("tool calls are one line each (tool name and a short argument summary); thinking, signatures, tool results and images are skipped", async () => {
    const long = `cd /home/you/project && ${"x".repeat(200)}`;
    const store = makeStore([
      {
        id: "s1",
        entries: [
          user("please check the build"),
          assistant(thinking("private reasoning"), text("Checking it."), toolCall("bash", { command: `${long}\nsecond line`, timeout: 10 }), toolCall("read", { path: "src/app.ts" })),
          imageResult(),
          toolResult("build output"),
          assistant(toolCall("ask_user_question", { questions: [{ header: "Platforms", question: "Which ones?" }] })),
          user("next question here please"),
          assistant(text("the latest answer is on the screen right now")),
        ],
      },
    ]);
    const { get } = setup({ store, screens: { [PANE]: screenOf("next question here please", "the latest answer is on the screen right now") } });
    const { body } = await get(historyPath(PANE));
    expect(body.history.messages).toEqual([
      { seq: 1, role: "user", blocks: [{ kind: "text", text: "please check the build" }] },
      {
        seq: 2,
        role: "assistant",
        blocks: [
          { kind: "text", text: "Checking it." },
          { kind: "tool", name: "bash", summary: `${long.replace(/\s+/g, " ").slice(0, 79)}…` },
          { kind: "tool", name: "read", summary: "src/app.ts" },
        ],
      },
      { seq: 5, role: "assistant", blocks: [{ kind: "tool", name: "ask_user_question", summary: "Platforms" }] },
    ]);
    const raw = JSON.stringify(body);
    for (const skipped of ["private reasoning", "thinkingSignature", "CAQSlgcK", "iVBORw0KGgo", "build output", "Read image file"]) expect(raw).not.toContain(skipped);
    expect(body.history.before).toBeNull();
  });

  test("text is passed on exactly as stored, markup included; the page escapes it", async () => {
    const nasty = `<script>alert("x")</script> & 'quotes' $HOME`;
    const store = makeStore([{ id: "s1", entries: [user(nasty), assistant(text(`**bold** <img src=x onerror=alert(1)> \`<b>\``)), user("the newest question is on screen"), assistant(text("the latest answer is on the screen right now"))] }]);
    const { get } = setup({ store, screens: { [PANE]: screenOf("the newest question is on screen", "the latest answer is on the screen right now") } });
    const { body } = await get(historyPath(PANE));
    expect(body.history.messages[0].blocks[0].text).toBe(nasty);
    const html = historyHtml(body.history.messages);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39; $HOME");
    expect(html).toContain(`<span class="a-code">&lt;b&gt;</span>`);
    // Only the renderer's own tags and attributes reach the page.
    const tags = [...html.matchAll(/<([a-z]+)([^>]*)>/g)].map(([, tag, attributes]) => `${tag}${attributes.replace(/"[^"]*"/g, '""')}`);
    expect(new Set(tags)).toEqual(new Set(['div class="" data-seq=""', 'div class=""', 'p class=""', 'span class=""']));
  });
  test("control characters other than tab and newline are dropped from stored text", async () => {
    const store = makeStore([{ id: "s1", entries: [user("bell\x07 and\x01 del\x7f gone\ttab kept\nnext line"), user("the newest question is on screen"), assistant(text("the latest answer is on the screen right now"))] }]);
    const { get } = setup({ store, screens: { [PANE]: screenOf("the newest question is on screen", "the latest answer is on the screen right now") } });
    const { body } = await get(historyPath(PANE));
    expect(body.history.messages[0].blocks[0].text).toBe("bell and del gone\ttab kept\nnext line");
  });
});

describe.concurrent("the Join with the live screen", () => {
  test("a message only partly on screen: its lines above the screen end the first page, and nothing on screen is repeated", async () => {
    const lines = Array.from({ length: 12 }, (_, n) => `paragraph line ${n + 1} of the long final report`);
    const store = makeStore([{ id: "s1", entries: [user("write the final report please"), assistant(text(lines.join("\n")))] }]);
    // The screen shows the report from line 8 down (the top scrolled away).
    const { get } = setup({ store, screens: { [PANE]: screenOf(...lines.slice(7)) } });
    const { body } = await get(historyPath(PANE));
    const messages = body.history.messages;
    expect(messages.map((message: { seq: number }) => message.seq)).toEqual([1, 2]);
    expect(messages[1].partial).toBe(true);
    expect(messages[1].blocks).toEqual([{ kind: "text", text: lines.slice(0, 7).join("\n") }]);
    expect(allText(messages)).not.toContain(lines[7]);
    // The next page starts below the partial message, so it is never sent again.
    expect(body.history.before).toBeNull();
  });

  test("messages fully on screen are left to the live screen; the first page ends just above them", async () => {
    const store = makeStore([numberedSession("s1", 3)]);
    const { get } = setup({
      store,
      screens: {
        [PANE]: screenOf("answer number 2 for the release notes", "question number 3 about the release", "$ echo step 3", "the latest answer is on the screen right now"),
      },
    });
    const { body } = await get(historyPath(PANE));
    const seqs = body.history.messages.map((message: { seq: number }) => message.seq);
    // Turn 1 (1, 2, 5), and turn 2's question and tool call (6, 7). Turn 2's answer (10) is on screen.
    expect(seqs).toEqual([1, 2, 5, 6, 7]);
  });

  test("a short line and a blank line just above the screen, but not on it, stay in the first page", async () => {
    // "final report" is short and also part of other lines on screen.
    const report = ["the opening paragraph of the final report", "final report", "", "paragraph line two of the long final report", "paragraph line three of the long final report"];
    const store = makeStore([{ id: "s1", entries: [user("write the final report please"), assistant(text(report.join("\n")))] }]);
    // The screen starts at "paragraph line two"; the lines above it scrolled away.
    const { get } = setup({ store, screens: { [PANE]: screenOf(...report.slice(3)) } });
    const { body } = await get(historyPath(PANE));
    const head = body.history.messages.at(-1);
    expect(head.partial).toBe(true);
    expect(head.blocks).toEqual([{ kind: "text", text: report.slice(0, 2).join("\n") }]);
  });

  test("a short line that is on screen just above the first long one is left to the live screen", async () => {
    const report = ["the opening paragraph of the final report", "final report", "paragraph line two of the long final report"];
    const store = makeStore([{ id: "s1", entries: [user("write the final report please"), assistant(text(report.join("\n")))] }]);
    const { get } = setup({ store, screens: { [PANE]: screenOf(...report.slice(1)) } });
    const { body } = await get(historyPath(PANE));
    expect(body.history.messages.at(-1).blocks).toEqual([{ kind: "text", text: report[0] }]);
  });
});

describe.concurrent("filling the gap while the agent keeps working", () => {
  test("after the screen moves on, ?from=<join> returns just what scrolled off, in order, with no older page fetched again", async () => {
    const store = makeStore([numberedSession("s1", 10, "answer number 10 for the release notes")]);
    const { get, setScreens } = setup({
      store,
      screens: { [PANE]: screenOf("question number 10 about the release", "$ echo step 10", "answer number 10 for the release notes") },
    });
    const first = (await get(historyPath(PANE))).body.history;
    // Turn 10 (46, 47, 50) is on screen; the Join is its question.
    expect(first.join).toBe(46);
    expect(first.messages.at(-1).seq).toBe(45);

    // The agent works on: turns 11 to 14 are written, and the screen now shows only turn 14.
    addEntries(store, "s1", 51, numberedSession("s1", 14, "the latest answer is on the screen right now").entries.slice(50));
    setScreens({ [PANE]: screenOf("question number 14 about the release", "$ echo step 14", "the latest answer is on the screen right now") });
    const gap = (await get(historyPath(PANE, `?from=${first.join}&limit=100`))).body.history;
    const seqs = gap.messages.map((message: { seq: number }) => message.seq);
    // Turn 10 and turns 11-13 scrolled off; nothing older than the old Join comes back.
    expect(seqs).toEqual([46, 47, 50, 51, 52, 55, 56, 57, 60, 61, 62, 65]);
    expect(gap.join).toBe(66);
    expect(gap.before).toBeNull();
    // First page plus the gap: every message once, in order, up to the new Join.
    const all = [...first.messages.map((message: { seq: number }) => message.seq), ...seqs];
    expect(all).toEqual([...new Set(all)].sort((a, b) => a - b));
    expect(all.length).toBe(13 * 3);
  });

  test("a partial message at the Join comes back whole once it has scrolled off", async () => {
    const lines = Array.from({ length: 12 }, (_, n) => `paragraph line ${n + 1} of the long final report`);
    const store = makeStore([{ id: "s1", entries: [user("write the final report please"), assistant(text(lines.join("\n")))] }]);
    const { get, setScreens } = setup({ store, screens: { [PANE]: screenOf(...lines.slice(7)) } });
    const first = (await get(historyPath(PANE))).body.history;
    expect(first.join).toBe(2);
    expect(first.messages.at(-1).partial).toBe(true);
    addEntries(store, "s1", 3, [user("thanks, now tag the release"), assistant(text("the latest answer is on the screen right now"))]);
    setScreens({ [PANE]: screenOf("thanks, now tag the release", "the latest answer is on the screen right now") });
    const gap = (await get(historyPath(PANE, `?from=${first.join}&limit=100`))).body.history;
    expect(gap.messages).toEqual([{ seq: 2, role: "assistant", blocks: [{ kind: "text", text: lines.join("\n") }] }]);
    expect(gap.join).toBe(3);
    expect(gap.before).toBeNull();
  });

  test("more scrolled off than one page holds: the answer says so (before is not null)", async () => {
    const store = makeStore([numberedSession("s1", 3, "answer number 3 for the release notes")]);
    const { get, setScreens } = setup({
      store,
      screens: { [PANE]: screenOf("question number 3 about the release", "$ echo step 3", "answer number 3 for the release notes") },
    });
    const first = (await get(historyPath(PANE))).body.history;
    addEntries(store, "s1", 16, numberedSession("s1", 30, "the latest answer is on the screen right now").entries.slice(15));
    setScreens({ [PANE]: screenOf("question number 30 about the release", "$ echo step 30", "the latest answer is on the screen right now") });
    const gap = (await get(historyPath(PANE, `?from=${first.join}&limit=5`))).body.history;
    expect(gap.messages).toHaveLength(5);
    expect(gap.messages.every((message: { seq: number }) => message.seq >= first.join)).toBe(true);
    expect(gap.before).not.toBeNull();
  });
});

describe.concurrent("a pane that moves to another Atomic session", () => {
  test("the same pane's next answers come from the new session, so the page can tell and start again", async () => {
    const store = makeStore([numberedSession("s1", 10, "answer number 10 for the release notes")]);
    const { get, setScreens } = setup({
      store,
      screens: { [PANE]: screenOf("question number 10 about the release", "$ echo step 10", "answer number 10 for the release notes") },
    });
    const first = (await get(historyPath(PANE))).body.history;
    expect(first.session).toBe("s1");
    // /new in the same folder: s2 has said one thing, and it is on the screen.
    addSession(store, {
      id: "s2",
      modified: "2026-10-29T11:00:00Z",
      entries: [user("start something new"), assistant(text("the new session answers here")), user("and a second thing"), assistant(text("the new session's latest answer"))],
    });
    setScreens({ [PANE]: screenOf("and a second thing", "the new session's latest answer") });
    const gap = (await get(historyPath(PANE, `?from=${first.join}&limit=100`))).body.history;
    expect(gap.session).toBe("s2");
    expect(gap.messages.every((message: { seq: number }) => message.seq <= 4)).toBe(true);
    const older = (await get(historyPath(PANE, `?before=${first.messages[0].seq}&limit=5`))).body.history;
    expect(older.session).toBe("s2");
  });
});

describe.concurrent("panes with no match", () => {
  test("asked again with the same screen, a no-match pane doesn't look up its folder's sessions again", async () => {
    const store = makeStore([numberedSession("s1", 3)]);
    const { get, candidateLookups, setScreens } = setup({ store, screens: { [PANE]: screenOf("a fresh session that has said nothing yet") } });
    for (let i = 0; i < 5; i++) expect((await get(historyPath(PANE))).body).toEqual({ history: null, reason: "no_match" });
    expect(candidateLookups()).toBe(1);
    // When its screen changes, it is checked again.
    setScreens({ [PANE]: screenOf("the latest answer is on the screen right now") });
    expect((await get(historyPath(PANE))).body.history.session).toBe("s1");
    expect(candidateLookups()).toBe(2);
  });
});

describe.concurrent("matching a pane to its session", () => {
  test("only the session in the pane's folder whose latest assistant text is on screen is used", async () => {
    const store = makeStore([
      numberedSession("other-folder", 3),
      { ...numberedSession("same-folder-older", 3, "an older session ended with a different answer"), modified: "2026-10-29T12:00:00Z" },
      numberedSession("match", 2, "the latest answer is on the screen right now"),
    ].map((session, index) => (index === 0 ? { ...session, cwd: "/home/you/elsewhere" } : session)));
    const { get } = setup({ store, screens: { [PANE]: screenOf("question number 2 about the release", "the latest answer is on the screen right now") } });
    const { body } = await get(historyPath(PANE));
    expect(body.history.session).toBe("match");
  });

  test("no session whose latest assistant text is on screen: no history, not a guess", async () => {
    const store = makeStore([numberedSession("s1", 3)]);
    const { get } = setup({ store, screens: { [PANE]: screenOf("a fresh session that has said nothing yet") } });
    expect((await get(historyPath(PANE))).body).toEqual({ history: null, reason: "no_match" });
  });

  test("the same text in another folder's session doesn't count", async () => {
    const store = makeStore([{ ...numberedSession("s1", 3), cwd: "/home/you/elsewhere" }]);
    const { get } = setup({ store, screens: { [PANE]: screenOf("the latest answer is on the screen right now") } });
    expect((await get(historyPath(PANE))).body).toEqual({ history: null, reason: "no_match" });
  });

  test("two sessions whose latest assistant text is on screen: no history", async () => {
    const store = makeStore([numberedSession("a", 3), numberedSession("b", 2)]);
    const { get } = setup({ store, screens: { [PANE]: screenOf("the latest answer is on the screen right now") } });
    expect((await get(historyPath(PANE))).body).toEqual({ history: null, reason: "ambiguous" });
  });

  test("the match is cached per pane, and checked again when the screen stops showing it", async () => {
    const store = makeStore([numberedSession("first", 3, "first session latest answer is visible"), numberedSession("second", 3, "second session latest answer is visible")]);
    const setupResult = setup({ store, screens: { [PANE]: screenOf("first session latest answer is visible") } });
    const { get, candidateLookups, setScreens } = setupResult;
    expect((await get(historyPath(PANE))).body.history.session).toBe("first");
    expect((await get(historyPath(PANE))).body.history.session).toBe("first");
    expect(candidateLookups()).toBe(1);
    // A new session in the same pane.
    setScreens({ [PANE]: screenOf("second session latest answer is visible") });
    expect((await get(historyPath(PANE))).body.history.session).toBe("second");
    expect(candidateLookups()).toBe(2);
    // Nothing of either on screen any more.
    setScreens({ [PANE]: screenOf("something else entirely is on this screen") });
    expect((await get(historyPath(PANE))).body).toEqual({ history: null, reason: "no_match" });
  });

  test("without a readable session store there is no history", async () => {
    const { get } = setup({ store: null, screens: { [PANE]: screenOf("anything") } });
    expect((await get(historyPath(PANE))).body).toEqual({ history: null, reason: "unavailable" });
  });
});

describe.concurrent("a session store that can't be opened", () => {
  test.serial("is logged once and not tried again until a back-off has passed; a store that appears is then used", async () => {
    const path = makeStore([numberedSession("s1", 3)]);
    renameSync(path, `${path}.away`);
    let clock = 1_000;
    let opens = 0;
    const openStore = () => {
      opens++;
      return openSessionStore(path);
    };
    const { request } = makeHarness(
      { agents: [agent(PANE)], outputs: { [PANE]: screenOf("the latest answer is on the screen right now") } },
      { history: (herdr) => createHistory({ herdr, openStore, now: () => clock }) },
    );
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      const page = async () => (await (await request("GET", historyPath(PANE))).json()) as { history: { session: string } | null; reason?: string };
      expect(await page()).toEqual({ history: null, reason: "unavailable" });
      expect(await page()).toEqual({ history: null, reason: "unavailable" });
      expect([opens, errors.mock.calls.length]).toEqual([1, 1]);
      expect(String(errors.mock.calls[0][0])).toContain("session store");
      // Still missing once the back-off has passed: tried again, not logged again.
      clock = 1_000 + STORE_RETRY_MS - 1;
      expect(await page()).toEqual({ history: null, reason: "unavailable" });
      expect(opens).toBe(1);
      clock = 1_000 + STORE_RETRY_MS;
      expect(await page()).toEqual({ history: null, reason: "unavailable" });
      expect([opens, errors.mock.calls.length]).toEqual([2, 1]);
      // The store is back: used after the next back-off, and kept open.
      renameSync(`${path}.away`, path);
      clock = 1_000 + 2 * STORE_RETRY_MS - 1;
      expect(await page()).toEqual({ history: null, reason: "unavailable" });
      clock = 1_000 + 2 * STORE_RETRY_MS;
      expect((await page()).history?.session).toBe("s1");
      expect((await page()).history?.session).toBe("s1");
      expect([opens, errors.mock.calls.length]).toEqual([3, 1]);
    } finally {
      errors.mockRestore();
    }
  });
});

describe.concurrent("store rows in the wrong shape", () => {
  // A store from another Atomic version could have looser columns than the
  // STRICT schema the fixtures copy; the server checks each row's shape.
  function looseStore(sessionId: unknown, entries: [seq: unknown, entry: unknown][]) {
    const path = makeStore([]);
    const db = new Database(path);
    db.run("DROP TABLE session_sessions");
    db.run("DROP TABLE session_entries");
    db.run("CREATE TABLE session_sessions (id, cwd, internal, modified_at)");
    db.run("CREATE TABLE session_entries (session_id, seq, entry_json)");
    db.run("INSERT INTO session_sessions VALUES (?, ?, 0, '2026-10-29')", [sessionId as number, CWD]);
    for (const [seq, entry] of entries) db.run("INSERT INTO session_entries VALUES (?, ?, ?)", [sessionId as number, seq as number, JSON.stringify(entry)]);
    db.close();
    return path;
  }
  const latest = "the latest answer is on the screen right now";
  const screens = { [PANE]: screenOf(latest) };
  const turn: [number, Entry][] = [[1, user("question number one about the release")], [2, assistant(text("answer number one for the release notes"))], [3, assistant(text(latest))]];

  test("a session whose id isn't text is not a candidate", async () => {
    const { get } = setup({ store: looseStore(42, turn), screens });
    expect((await get(historyPath(PANE))).body).toEqual({ history: null, reason: "no_match" });
  });

  test.serial("an entry whose seq isn't a whole number fails the request like any other store error, and is logged", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { get } = setup({ store: looseStore("s1", [[1.5, user("question number one about the release")], ...turn.slice(1)]), screens });
      expect(await get(historyPath(PANE))).toEqual({ status: 500, body: { error: { code: "server_error", message: "The server hit an unexpected error." } } });
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });

  test("message entries in the wrong shape are skipped; the well-formed ones still come back", async () => {
    const wrong: Entry[] = [
      { type: "message", message: "user" },
      { type: "message", message: { role: "user", content: 5 } },
      { type: "message", message: { role: "assistant", content: [null, 7, "text", { type: "text", text: 9 }, { type: "toolCall", name: 3 }] } },
      { type: "message", message: { role: "assistant", content: { type: "text", text: "not a list" } } },
    ];
    const store = makeStore([{ id: "s1", entries: [user("question number one about the release"), ...wrong, assistant(text(latest))] }]);
    const { get } = setup({ store, screens });
    const { status, body } = await get(historyPath(PANE));
    expect(status).toBe(200);
    expect(body.history.messages).toEqual([{ seq: 1, role: "user", blocks: [{ kind: "text", text: "question number one about the release" }] }]);
  });
});

describe.concurrent("the history route", () => {
  const store = makeStore([numberedSession("s1", 3)]);
  const screens = { [PANE]: screenOf("the latest answer is on the screen right now") };

  for (const query of ["?before=0", "?before=-1", "?before=abc", "?before=", "?before=1.5", "?before=1e3", "?limit=0", "?limit=101", "?limit=", "?limit=ten", "?before=99999999999999999", "?from=0", "?from=abc", "?from="]) {
    test(`a bad query (${query}) is refused with 400 before herdr runs`, async () => {
      const { get, fake } = setup({ store, screens });
      const { status, body } = await get(historyPath(PANE, query));
      expect(status).toBe(400);
      expect(body.error.code).toBe("bad_request");
      expect(fake.calls()).toEqual([]);
    });
  }

  test("a target that isn't a pane ID is refused with 400 before herdr runs", async () => {
    const { get, fake } = setup({ store, screens });
    expect((await get(historyPath("--help"))).status).toBe(400);
    expect(fake.calls()).toEqual([]);
  });

  test("only GET is allowed", async () => {
    const { get, fake } = setup({ store, screens });
    for (const method of ["POST", "PUT", "DELETE"]) expect((await get(historyPath(PANE), { method })).status).toBe(405);
    expect(fake.calls()).toEqual([]);
  });

  test("403 without the right login, before herdr runs or the store opens", async () => {
    const { get, fake, opened } = setup({ store, screens });
    for (const login of [null, "", "someone.else@example.com"]) expect((await get(historyPath(PANE), { login })).status).toBe(403);
    expect(fake.calls()).toEqual([]);
    expect(opened()).toBeNull();
  });

  // The screen is read as the page's output route reads it, with `pane read`.
  test("herdr is only asked for the agent (agent get) and its plain screen (pane read)", async () => {
    const { get, fake } = setup({ store, screens });
    await get(historyPath(PANE));
    await get(historyPath(PANE, "?before=3"));
    const commands = new Set(fake.calls().map((argv) => argv.slice(0, 2).join(" ")));
    expect(commands).toEqual(new Set(["agent get", "pane read"]));
    expect(fake.calls().filter((argv) => argv[1] === "read").every((argv) => !argv.includes("--format"))).toBe(true);
  });
});

describe.concurrent("the session store is read-only", () => {
  test("the store is opened read-only: a write through its handle fails, and the file never changes", async () => {
    const store = makeStore([numberedSession("s1", 30)]);
    const before = { bytes: readFileSync(store), mtime: statSync(store).mtimeMs };
    const { get, opened } = setup({ store, screens: { [PANE]: screenOf("the latest answer is on the screen right now") } });
    for (let i = 0; i < 5; i++) await get(historyPath(PANE));
    expect(() => opened()!.db.run("INSERT INTO session_entries VALUES ('s1', 999, 'x', '{}')")).toThrow(/readonly/i);
    expect(() => opened()!.db.run("UPDATE session_sessions SET name = NULL")).toThrow(/readonly/i);
    expect(() => opened()!.db.run("CREATE TABLE written (x)")).toThrow(/readonly/i);
    expect(readFileSync(store).equals(before.bytes)).toBe(true);
    expect(statSync(store).mtimeMs).toBe(before.mtime);
    // The fixture is in WAL mode, as Atomic's store is: a reader adds only SQLite's
    // WAL index and an empty log next to it (a write would go into that log).
    expect(readdirSync(dirname(store)).sort()).toEqual(["journal.sqlite", "journal.sqlite-shm", "journal.sqlite-wal"]);
    expect(statSync(`${store}-wal`).size).toBe(0);
  });

  test("code check: the store module opens with readonly: true and has only SELECT statements", () => {
    const source = readFileSync(resolve(import.meta.dir, "../server/history.ts"), "utf8");
    expect(source).toContain("new Database(path, { readonly: true })");
    expect(source.match(/new Database\(/g)).toHaveLength(1);
    const code = source.replace(/\/\/.*$/gm, "");
    // SQL keywords that write (upper case, as the SQL here is written), and any
    // spelling of the statements that change the file or lock it.
    for (const word of ["INSERT", "UPDATE", "DELETE", "REPLACE", "UPSERT", "ATTACH", "CREATE", "DROP", "ALTER", "BEGIN", "COMMIT"]) {
      expect(code).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    for (const word of ["vacuum", "pragma", "checkpoint", "exclusive", "immediate", "journal_mode", "create: true", "readwrite"]) {
      expect(code.toLowerCase()).not.toContain(word);
    }
    // Every entry read is by session_id and seq, with a LIMIT.
    const statements = [...code.matchAll(/"(SELECT [^"]*(?:"\s*\+\s*"[^"]*)*)"/g)].map(([statement]) => statement.replace(/"\s*\+\s*"/g, ""));
    expect(statements).toHaveLength(2);
    for (const statement of statements) expect(statement).toMatch(/LIMIT \?\d/);
    expect(statements.find((statement) => statement.includes("session_entries"))).toContain("WHERE session_id = ?1 AND seq < ?2 ORDER BY seq DESC LIMIT ?3");
    // No other server file opens a database.
    for (const file of ["app.ts", "events.ts", "herdr.ts", "latest-line.ts", "main.ts", "roster.ts"]) {
      expect(readFileSync(resolve(import.meta.dir, `../server/${file}`), "utf8")).not.toContain("bun:sqlite");
    }
  });
});
