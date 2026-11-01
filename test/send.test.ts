// Sends on /api/terminals: one matrix over the three ways a terminal is sent
// to (a herdr built-in agent kind, a custom-kind agent and a plain shell), with
// every guard on the way: the body and key checks, the re-check of the pane
// just before each send, and D10's rules for custom-kind agents.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../server/app";
import { createHerdr, isBuiltInKind } from "../server/herdr";
import { makeFakeHerdr, type FakeConfig } from "./fake-herdr";
import { WEB } from "./support/agents";
import { ALLOWED_LOGIN, auditCalls, disposeFakes, herdrError, paste } from "./support/http";
import { REFUSED_KEYS, REPRESENTATIVE_KEYS } from "./support/key-grammar";
import { AGENTS, ATOMIC, CONFIG, OTHER_AGENT, PI, SHELLS, SHELL_PANE, keys, pane, path, prompt, setup, without } from "./support/terminals";

afterAll(disposeFakes);

type Call = string[];
type Target = {
  name: string;
  pane: string;
  // The kind the page saw, sent back with every send.
  kind: string;
  // The re-check just before every send.
  recheck: Call;
  // What herdr runs for a message and for keys.
  message: (text: string) => Call[];
  keys: (list: string[]) => Call[];
  // The same pane now running another kind than the page saw.
  changed: FakeConfig;
};

const TARGETS: Target[] = [
  {
    name: "built-in agent (pi)",
    pane: PI,
    kind: "pi",
    recheck: ["agent", "get", PI],
    message: (text) => [["agent", "prompt", PI, text]],
    keys: (list) => [["agent", "send-keys", PI, ...list]],
    changed: { ...CONFIG, agents: AGENTS.map((agent) => (agent.pane_id === PI ? { ...agent, agent: "atomic" } : agent)) },
  },
  {
    name: "custom-kind agent (atomic)",
    pane: ATOMIC,
    kind: "atomic",
    recheck: ["agent", "get", ATOMIC],
    message: (text) => [["pane", "send-text", ATOMIC, paste(text)], ["pane", "send-keys", ATOMIC, "enter"]],
    keys: (list) => [["pane", "send-keys", ATOMIC, ...list]],
    changed: { ...CONFIG, agents: AGENTS.map((agent) => (agent.pane_id === ATOMIC ? { ...agent, agent: "claude" } : agent)) },
  },
  {
    name: "plain shell",
    pane: SHELL_PANE,
    kind: "shell",
    recheck: ["pane", "get", SHELL_PANE],
    message: (text) => [["pane", "send-text", SHELL_PANE, text], ["pane", "send-keys", SHELL_PANE, "enter"]],
    keys: (list) => [["pane", "send-keys", SHELL_PANE, ...list]],
    changed: { ...CONFIG, agents: [...AGENTS, { ...SHELLS[0], agent: "atomic", agent_status: "idle", state_change_seq: 1 }], shells: SHELLS.slice(1) },
  },
];
const [BUILT_IN, CUSTOM, SHELL] = TARGETS;
const AGENT_TARGETS = [BUILT_IN, CUSTOM];

const errorOf = async (response: Response) => [response.status, (await response.json()).error?.code];

describe.concurrent("messages", () => {
  const messages = [
    `He said "don't" and it's fine`,
    "cost is $5 and $HOME and ${PATH} and $(whoami)",
    "run `rm -rf /` please; echo pwned | cat && exit",
    "line one\nline two\n\nline four\n",
    "café, naïve, 日本語, emoji 🚀👍🏽, RTL שלום",
    "-v",
    "--help",
    "--",
    "--wait --timeout 1",
    "  leading and trailing spaces  ",
    "tab\there\r\nwindows line",
    "\\backslash\\ and 'single' quotes",
  ];
  for (const target of TARGETS) {
    for (const text of messages) {
      test(`${target.name}: ${JSON.stringify(text)} is sent once, unchanged, straight after the re-check`, async () => {
        const { request, calls } = setup();
        const response = await request("POST", ...prompt(target.pane, text, target.kind));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(calls()).toEqual([target.recheck, ...target.message(text)]);
      });
    }
  }

  // An agent's message is pasted (by herdr's `agent prompt`, or by the server for
  // a custom kind), so it can't hold the paste end; a shell's is typed as it is.
  test("text holding the paste end ESC [201~ is refused with 400 for agents before herdr runs; a shell gets it as typed", async () => {
    const text = "before \x1b[201~ after";
    const { request, calls } = setup();
    for (const target of AGENT_TARGETS) {
      expect([target.name, ...(await errorOf(await request("POST", ...prompt(target.pane, text, target.kind))))]).toEqual([target.name, 400, "bad_request"]);
    }
    expect(calls()).toEqual([]);
    expect((await request("POST", ...prompt(SHELL.pane, text, SHELL.kind))).status).toBe(200);
    expect(calls()).toEqual([SHELL.recheck, ...SHELL.message(text)]);
  });

  const badBodies = [{}, { text: 5 }, { text: null }, { text: ["a"] }, "not json", [1], { text: "a\u0000b" }];
  for (const body of badBodies) {
    test(`body ${JSON.stringify(body)} is refused with 400 before herdr runs, for every kind`, async () => {
      const { request, calls } = setup();
      for (const target of TARGETS) {
        const sent = typeof body === "object" && !Array.isArray(body) ? { ...body, kind: target.kind } : body;
        expect([target.name, ...(await errorOf(await request("POST", path(target.pane, "prompt"), { body: sent })))]).toEqual([target.name, 400, "bad_request"]);
      }
      expect(calls()).toEqual([]);
    });
  }

  test("a custom-kind agent's text is one bracketed paste, then Enter; a shell's is never wrapped (herdr reports no paste mode)", async () => {
    const { request, calls } = setup();
    expect((await request("POST", ...prompt(SHELL.pane, "a\nb", SHELL.kind))).status).toBe(200);
    expect((await request("POST", ...prompt(CUSTOM.pane, "a\nb", CUSTOM.kind))).status).toBe(200);
    expect(calls().filter((call) => call[1] === "send-text").map((call) => call[3])).toEqual(["a\nb", paste("a\nb")]);
  });

  for (const target of [CUSTOM, SHELL]) {
    test(`${target.name}: if Enter fails after the text went out, 502 enter_not_sent says so and the text is not sent again`, async () => {
      const failed = herdrError("pane_not_found", `pane ${target.pane} not found`, "cli:pane:send-keys");
      const { request, calls } = setup({ ...CONFIG, answers: { "pane send-keys": failed } });
      const response = await request("POST", ...prompt(target.pane, "typed once", target.kind));
      expect(response.status).toBe(502);
      const { error } = await response.json();
      expect(error.code).toBe("enter_not_sent");
      expect(error.message).toContain(`pane ${target.pane} not found`);
      expect(calls()).toEqual([target.recheck, ...target.message("typed once")]);
    });

    test(`${target.name}: if the text fails, Enter is not sent`, async () => {
      const { request, calls } = setup({ ...CONFIG, answers: { "pane send-text": herdrError("pane_send_failed", "pty closed") } });
      const response = await request("POST", ...prompt(target.pane, "hi", target.kind));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: { code: "pane_send_failed", message: "pty closed" } });
      expect(calls()).toEqual([target.recheck, target.message("hi")[0]]);
    });
  }

  // The tests' harness skips the wait; the server itself waits as herdr's own `agent prompt` does.
  test.serial("without a submit delay given, the server waits 300 ms between a custom-kind agent's paste and Enter", async () => {
    const fake = makeFakeHerdr(CONFIG);
    const app = createApp({ herdr: createHerdr(fake.bin), allowedLogin: ALLOWED_LOGIN, webRoot: WEB });
    const sleep = spyOn(Bun, "sleep");
    try {
      const started = performance.now();
      const response = await app(new Request(`http://127.0.0.1${path(ATOMIC, "prompt")}`, {
        method: "POST",
        headers: { "Tailscale-User-Login": ALLOWED_LOGIN, "content-type": "application/json" },
        body: JSON.stringify({ text: "waits", kind: "atomic" }),
      }));
      expect(response.status).toBe(200);
      expect(performance.now() - started).toBeGreaterThanOrEqual(300);
      expect(sleep.mock.calls).toEqual([[300]]);
    } finally {
      sleep.mockRestore();
    }
    expect(fake.calls()).toEqual([["agent", "get", ATOMIC], ["pane", "send-text", ATOMIC, paste("waits")], ["pane", "send-keys", ATOMIC, "enter"]]);
    auditCalls(fake.calls());
    fake.dispose();
  });
});

describe.concurrent("keys", () => {
  for (const target of TARGETS) {
    // One key of each family; every key of the grammar is checked in key-grammar.test.ts.
    test(`${target.name}: a key of each family goes in one call straight after the re-check`, async () => {
      const { request, calls } = setup();
      for (const key of REPRESENTATIVE_KEYS) {
        expect([key, (await request("POST", ...keys(target.pane, [key], target.kind))).status]).toEqual([key, 200]);
      }
      expect(calls()).toEqual(REPRESENTATIVE_KEYS.flatMap((key) => [target.recheck, ...target.keys([key])]));
    });

    test(`${target.name}: several keys go in one call, in order`, async () => {
      const { request, calls } = setup();
      const list = ["ctrl+x", "f5", "shift+tab", "2", "enter"];
      expect((await request("POST", ...keys(target.pane, list, target.kind))).status).toBe(200);
      expect(calls()).toEqual([target.recheck, ...target.keys(list)]);
    });
  }

  // A list of strings outside the grammar (or an empty list) is key_not_allowed;
  // anything that isn't a list of strings is bad_request.
  const refused: [unknown, string][] = [
    ...REFUSED_KEYS.map((key): [unknown, string] => [[key], "key_not_allowed"]),
    [["enter", "pageup"], "key_not_allowed"],
    [["ctrl+x", "ctrl+"], "key_not_allowed"],
    [[], "key_not_allowed"],
    ["enter", "bad_request"],
    [[1], "bad_request"],
    [[null], "bad_request"],
    [null, "bad_request"],
  ];
  for (const [list, code] of refused) {
    test(`keys ${JSON.stringify(list)} are refused with 400 ${code} before herdr runs, for every kind`, async () => {
      const { request, calls } = setup();
      for (const target of TARGETS) {
        expect([target.name, ...(await errorOf(await request("POST", ...keys(target.pane, list, target.kind))))]).toEqual([target.name, 400, code]);
      }
      expect(calls()).toEqual([]);
    });
  }
});

describe.concurrent("the kind the page saw", () => {
  test("a send without it (`kind`) is refused with 400 before herdr runs, for every kind", async () => {
    const { request, calls } = setup();
    for (const kind of [undefined, "", 5, null]) {
      for (const target of TARGETS) {
        for (const [route, init] of [prompt(target.pane, "hi"), keys(target.pane, ["enter"])]) {
          const body = kind === undefined ? init.body : { ...init.body, kind };
          expect([target.name, String(kind), ...(await errorOf(await request("POST", route, { body })))]).toEqual([target.name, String(kind), 400, "bad_request"]);
        }
      }
    }
    expect(calls()).toEqual([]);
  });

  test("herdr 0.9.5's built-in kinds are its 24 kinds and their aliases, matched as its parse_agent_label matches them", () => {
    const kinds = ["pi", "claude", "codex", "gemini", "cursor", "devin", "agy", "cline", "omp", "mastracode", "opencode", "copilot", "kimi", "kiro", "droid", "amp", "grok", "hermes", "kilo", "qodercli", "qwen", "letta", "maki", "muse"];
    expect(kinds).toHaveLength(24);
    for (const kind of [...kinds, "claude-code", "cursor-agent", "antigravity", "github-copilot", "kiro-cli", "Claude", " pi ", "codex.exe", "/usr/local/bin/claude", "muse-bin-0.1.0"]) {
      expect([kind, isBuiltInKind(kind)]).toEqual([kind, true]);
    }
    for (const kind of ["atomic", "Atomic", "", "custom:atomic", "pi-atomic", "muse-binary", "muse-bin", undefined, null, 5]) {
      expect([kind, isBuiltInKind(kind)]).toEqual([kind, false]);
    }
  });
});

describe.concurrent("the pane is re-checked just before every send", () => {
  const sendBoth = async (request: ReturnType<typeof setup>["request"], paneId: string, kind: string) => {
    const out = [];
    for (const [route, init] of [prompt(paneId, "echo must-not-run", kind), keys(paneId, ["ctrl+c"], kind)]) out.push(await errorOf(await request("POST", route, init)));
    return out;
  };

  for (const target of TARGETS) {
    test(`${target.name}: the re-check follows the pane between sends; once it runs another kind, 409 terminal_changed and nothing is sent`, async () => {
      const { request, calls, fake } = setup();
      expect((await request("POST", ...prompt(target.pane, "first", target.kind))).status).toBe(200);
      fake.setConfig(target.changed);
      expect(await sendBoth(request, target.pane, target.kind)).toEqual([[409, "terminal_changed"], [409, "terminal_changed"]]);
      expect(calls()).toEqual([target.recheck, ...target.message("first"), target.recheck, target.recheck]);
    });

    for (const other of TARGETS.filter((candidate) => candidate.kind !== target.kind)) {
      test(`${target.name}, sent to as ${other.name}: 409 terminal_changed and nothing is sent`, async () => {
        const { request, calls } = setup();
        expect(await sendBoth(request, target.pane, other.kind)).toEqual([[409, "terminal_changed"], [409, "terminal_changed"]]);
        // An agent kind is re-checked with `agent get`, and a pane with no agent then with `pane get`.
        const recheck = other === SHELL ? [["pane", "get", target.pane]] : target === SHELL ? [["agent", "get", target.pane], ["pane", "get", target.pane]] : [["agent", "get", target.pane]];
        expect(calls()).toEqual([...recheck, ...recheck]);
      });
    }

    test(`${target.name}: a pane that vanished is 404 pane_not_found; nothing is sent`, async () => {
      const { request, calls } = setup({ ...CONFIG, agents: without(target.pane), shells: SHELLS.filter((shell) => shell.pane_id !== target.pane) });
      expect(await sendBoth(request, target.pane, target.kind)).toEqual([[404, "pane_not_found"], [404, "pane_not_found"]]);
      expect(calls().every((call) => call[1] === "get")).toBe(true);
    });
  }

  for (const target of AGENT_TARGETS) {
    test(`${target.name}: a pane that is now a plain shell is 409 terminal_changed after \`agent get\` and \`pane get\`; nothing is sent`, async () => {
      const { request, calls, fake } = setup();
      const { agent, agent_status, state_change_seq, completion_seq, ...shellNow } = AGENTS.find((row) => row.pane_id === target.pane)!;
      fake.setConfig({ ...CONFIG, agents: without(target.pane), shells: [...SHELLS, shellNow] });
      expect(await sendBoth(request, target.pane, target.kind)).toEqual([[409, "terminal_changed"], [409, "terminal_changed"]]);
      expect(calls()).toEqual([target.recheck, ["pane", "get", target.pane], target.recheck, ["pane", "get", target.pane]]);
    });
  }

  test("an agent with no named kind, sent to as an agent kind, is 409 terminal_changed naming no agent; nothing is sent", async () => {
    const unnamed = { ...pane("w9:pU", "w9", "w9:tU"), agent_status: "idle", state_change_seq: 5 };
    const { request, calls } = setup({ ...CONFIG, agents: [...AGENTS, unnamed] });
    for (const kind of ["atomic", "pi"]) {
      for (const [route, init] of [prompt(unnamed.pane_id, "hi", kind), keys(unnamed.pane_id, ["esc"], kind)]) {
        const response = await request("POST", route, init);
        expect([route, response.status, await response.json()]).toEqual([
          route,
          409,
          { error: { code: "terminal_changed", message: `Pane w9:pU now runs no named agent, not ${kind}. Nothing was sent.` } },
        ]);
      }
    }
    expect(calls()).toEqual(Array.from({ length: 4 }, () => ["agent", "get", unnamed.pane_id]));
  });
});

describe.concurrent("blocked agents", () => {
  // OTHER_AGENT is an atomic agent waiting on a question.
  test("custom-kind agent: a message is refused with 409 agent_blocked and nothing is sent", async () => {
    const { request, calls } = setup();
    expect(await errorOf(await request("POST", ...prompt(OTHER_AGENT, "should not arrive", "atomic")))).toEqual([409, "agent_blocked"]);
    expect(calls()).toEqual([["agent", "get", OTHER_AGENT]]);
  });

  test("custom-kind agent: the re-check catches a block between sends", async () => {
    const { request, calls, fake } = setup();
    expect((await request("POST", ...prompt(ATOMIC, "first", "atomic"))).status).toBe(200);
    fake.setConfig({ ...CONFIG, agents: AGENTS.map((agent) => (agent.pane_id === ATOMIC ? { ...agent, agent_status: "blocked" } : agent)) });
    expect(await errorOf(await request("POST", ...prompt(ATOMIC, "second", "atomic")))).toEqual([409, "agent_blocked"]);
    expect(calls()).toEqual([CUSTOM.recheck, ...CUSTOM.message("first"), CUSTOM.recheck]);
  });

  test("built-in agent: herdr's own `agent prompt` refusal is answered as 409 agent_blocked with herdr's message", async () => {
    const blocked = { ...CONFIG, agents: AGENTS.map((agent) => (agent.pane_id === PI ? { ...agent, agent_status: "blocked" } : agent)), answers: { prompt: herdrError("agent_blocked", `agent ${PI} is blocked`, "cli:agent:prompt") } };
    const { request, calls } = setup(blocked);
    const response = await request("POST", ...prompt(PI, "hello", "pi"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "agent_blocked", message: `agent ${PI} is blocked` } });
    expect(calls()).toEqual([BUILT_IN.recheck, ...BUILT_IN.message("hello")]);
  });

  test("keys still reach a blocked agent of either kind, so its question can be answered", async () => {
    const blocked = { ...CONFIG, agents: AGENTS.map((agent) => (agent.pane_id === PI ? { ...agent, agent_status: "blocked" } : agent)) };
    const { request, calls } = setup(blocked);
    expect((await request("POST", ...keys(OTHER_AGENT, ["2", "enter"], "atomic"))).status).toBe(200);
    expect((await request("POST", ...keys(PI, ["2", "enter"], "pi"))).status).toBe(200);
    expect(calls()).toEqual([["agent", "get", OTHER_AGENT], ["pane", "send-keys", OTHER_AGENT, "2", "enter"], BUILT_IN.recheck, ...BUILT_IN.keys(["2", "enter"])]);
  });
});
