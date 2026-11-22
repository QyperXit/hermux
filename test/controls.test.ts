import { describe, expect, test } from "bun:test";
import { createAttachment } from "../web/attach.js";
import { composerHtml } from "../web/composer.js";
import { drawTerminalControls } from "../web/controls.js";
import { memoryStorage } from "../web/home.js";
import { createKeyBar } from "../web/key-bar.js";
import { attachPausedCard } from "../web/paused-card.js";
import { attachQuestionCard } from "../web/question-card.js";
import { readScreen } from "../web/screen.js";
import { stripHtml } from "../web/subagent-strip.js";
import { fakeClock } from "./support/key-bar";
import { asPageElement, fakePage } from "./support/fake-dom";
import * as A from "./support/atomic-0100";

const atomic = (status: string) => ({ pane_id: "w8:p1", kind: "atomic", status, cwd: "/home/you/garden", title: null, tab: { id: "w8:t1", label: "garden", number: 1 }, workspace: { id: "w8", label: "garden" } });

function controlsScreen() {
  const { root } = fakePage(`${stripHtml()}<div class="output" tabindex="0"></div><div class="controls">${composerHtml()}<p class="notice"></p></div>`);
  const page = asPageElement(root);
  const keyBar = createKeyBar({ storage: memoryStorage(), timers: fakeClock().timers });
  keyBar.attach(page, { sendKey: () => {}, sendText: () => {}, announce: () => {} });
  const attachment = createAttachment({
    client: { isSample: false, uploadImage: async () => ({ path: "", name: "", size: 0 }) } as unknown as Parameters<typeof createAttachment>[0]["client"],
    previews: { create: () => "blob:x", revoke: () => {} },
    prepare: async (file) => ({ blob: file, name: file.name }),
  });
  attachment.attach(page);
  attachQuestionCard(page, async () => {});
  attachPausedCard(page, async () => {});
  const draw = (status: string, screen: string) => drawTerminalControls(page, { terminal: atomic(status), sending: false, screen: readScreen(screen) }, { keyBar, attachment });
  const shown = (selector: string) => root.querySelector(selector)!.shown;
  const click = (selector: string) => root.querySelector(selector)!.dispatch("click", { detail: 1 });
  return { root, draw, shown, click };
}

describe("the controls beside the subagent card", () => {
  test("the saved commands and the attach menu stay open across redraws while the card leaves the message box shown", () => {
    const { draw, shown, click } = controlsScreen();
    draw("blocked", A.WAITING_SCREEN);
    expect([shown(".question-card"), shown(".composer")]).toEqual([true, true]);
    click(".slash");
    expect(shown(".saved")).toBe(true);
    for (let redraw = 0; redraw < 3; redraw++) draw("blocked", A.WAITING_SCREEN);
    expect(shown(".saved")).toBe(true);
    click(".attach");
    expect(shown(".clip-menu")).toBe(true);
    for (let redraw = 0; redraw < 3; redraw++) draw("blocked", A.WAITING_SCREEN);
    expect(shown(".clip-menu")).toBe(true);
  });

  const ownMenuState = (root: ReturnType<typeof controlsScreen>["root"]) => ({
    saved: [!root.querySelector(".saved")!.hidden, root.querySelector(".slash")!.getAttribute("aria-expanded")],
    clip: [!root.querySelector(".clip-menu")!.hidden, root.querySelector(".attach")!.getAttribute("aria-expanded")],
  });

  test("they close when the message box hides (a question on screen, or a block with no card) and stay closed when it is back", () => {
    for (const [status, screen] of [
      ["working", A.QUESTION_SCREEN],
      ["blocked", A.MAIN_AGAIN_SCREEN],
    ]) {
      const { draw, click, root } = controlsScreen();
      draw("blocked", A.WAITING_SCREEN);
      click(".slash");
      expect(ownMenuState(root).saved).toEqual([true, "true"]);
      draw(status, screen);
      expect(ownMenuState(root).saved).toEqual([false, "false"]);
      draw("blocked", A.WAITING_SCREEN);
      expect(ownMenuState(root).saved).toEqual([false, "false"]);
      click(".attach");
      expect(ownMenuState(root).clip).toEqual([true, "true"]);
      draw(status, screen);
      expect(ownMenuState(root).clip).toEqual([false, "false"]);
      draw("blocked", A.WAITING_SCREEN);
      expect(ownMenuState(root).clip).toEqual([false, "false"]);
    }
  });

  test("they close when a question's typing field opens, so a saved command can't go as the answer", () => {
    for (const typing of [A.TYPE_FOCUSED_SCREEN, A.TYPE_TYPED_SCREEN]) {
      const { draw, click, root, shown } = controlsScreen();
      draw("working", A.MAIN_AGAIN_SCREEN);
      click(".slash");
      expect(ownMenuState(root).saved).toEqual([true, "true"]);
      draw("working", typing);
      expect([shown(".composer"), shown(".slash"), shown(".attach")]).toEqual([true, false, false]);
      expect(ownMenuState(root).saved).toEqual([false, "false"]);
      draw("working", A.MAIN_AGAIN_SCREEN);
      click(".attach");
      expect(ownMenuState(root).clip).toEqual([true, "true"]);
      draw("working", typing);
      expect(ownMenuState(root).clip).toEqual([false, "false"]);
    }
  });

  test("the strip, the card and the box's label follow the screen", () => {
    const { draw, shown, root } = controlsScreen();
    draw("blocked", A.QUESTION_SCREEN);
    expect([shown(".subagent-strip"), shown(".question-card"), shown(".composer")]).toEqual([true, false, false]);
    draw("done", A.NARROW_DONE_SCREEN);
    expect(root.querySelector("#message")!.getAttribute("placeholder")).toBe("Message @asker");
    draw("done", A.MAIN_AGAIN_SCREEN);
    expect(shown(".subagent-strip")).toBe(false);
    expect(root.querySelector("#message")!.getAttribute("placeholder")).toBe("Message garden");
  });
});
