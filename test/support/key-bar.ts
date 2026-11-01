// A Terminal screen with the key bar attached (web/key-bar.js), as the page
// attaches it, for the tests: a fake DOM page (test/support/fake-dom.ts), a
// fake clock, memoryStorage() for the phone's storage, and records of what the
// key bar asked the page to send and announce. Gestures go through the events
// a phone or a keyboard would fire.
import { memoryStorage } from "../../web/home.js";
import { createKeyBar } from "../../web/key-bar.js";
import { asPageElement, fakePage, type FakeElement } from "./fake-dom";

// The clock the key bar's timing runs on. Nothing runs until `advance`.
export function fakeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const pending = new Map<number, { at: number; run: () => void }>();
  let frames: (() => void)[] = [];
  return {
    timers: {
      setTimeout: (run: () => void, ms: number) => {
        pending.set(nextId, { at: now + ms, run });
        return nextId++;
      },
      clearTimeout: (id: number) => void pending.delete(id),
      now: () => now,
      requestAnimationFrame: (run: () => void) => void frames.push(run),
    },
    // Moves time on by `ms`, running each timer that falls due on the way, and then the next frame.
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...pending].filter(([, timer]) => timer.at <= end).sort(([, a], [, b]) => a.at - b.at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = end;
      const ready = frames;
      frames = [];
      for (const run of ready) run();
    },
  };
}

// The page's controls under the key bar, as the agent screen's template draws them.
const CONTROLS = `
    <div class="controls">
      <form class="composer" autocomplete="off"><textarea id="message" name="message"></textarea></form>
      <p class="notice" role="status" aria-live="polite"></p>
    </div>`;

export type Storage = ReturnType<typeof memoryStorage>;

export function keyBarScreen({ storage = memoryStorage(), clock = fakeClock() }: { storage?: Storage; clock?: ReturnType<typeof fakeClock> } = {}) {
  const { doc, root } = fakePage(CONTROLS);
  const sentKeys: { key: string; label: string }[] = [];
  const sentTexts: string[] = [];
  const notices: { message: string; error?: boolean }[] = [];
  const keyBar = createKeyBar({ storage, timers: clock.timers });
  keyBar.attach(asPageElement(root), {
    sendKey: (key, label) => void sentKeys.push({ key, label }),
    sendText: (text) => void sentTexts.push(text),
    announce: (message, options) => void notices.push({ message, ...options }),
  });

  const nameOf = (element: FakeElement) => element.getAttribute("aria-label") ?? element.textContent.trim();
  const shownButtons = () => root.querySelectorAll("button").filter((button) => button.shown);
  // The one shown button with this accessible name.
  const button = (name: string) => {
    const found = shownButtons().filter((candidate) => nameOf(candidate) === name);
    if (found.length !== 1) throw new Error(`Expected one shown button named ${JSON.stringify(name)}, found ${found.length}: ${JSON.stringify(shownButtons().map(nameOf))}`);
    return found[0];
  };
  const group = (name: string) => {
    const found = root.querySelectorAll('[role="group"]').find((element) => element.getAttribute("aria-label") === name);
    if (!found) throw new Error(`No group named ${JSON.stringify(name)}`);
    return found;
  };
  // A shown form control by its label's text.
  const field = (label: string) => {
    const owner = root.querySelectorAll("label").find((candidate) => candidate.shown && candidate.textContent.trim().startsWith(label));
    const control = owner && (owner.querySelector("input, select, textarea") ?? root.querySelector(`#${owner.getAttribute("for")}`));
    if (!control) throw new Error(`No shown field labelled ${JSON.stringify(label)}`);
    return control;
  };

  return {
    doc,
    root,
    clock,
    storage,
    keyBar,
    sentKeys,
    sentTexts,
    notices,
    button,
    group,
    field,
    // The names of the shown buttons in a group, in order.
    names: (groupName: string) => group(groupName).querySelectorAll("button").filter((candidate) => candidate.shown).map(nameOf),
    announced: () => notices.map(({ message }) => message),
    focused: () => doc.activeElement,
    // A finger: down, up, and the click the browser fires after it.
    tap(target: FakeElement) {
      target.dispatch("pointerdown");
      target.dispatch("pointerup");
      target.dispatch("click", { detail: 1 });
    },
    press(target: FakeElement) {
      target.dispatch("pointerdown");
    },
    release(target: FakeElement) {
      target.dispatch("pointerup");
      target.dispatch("click", { detail: 1 });
    },
    hold(target: FakeElement, ms: number) {
      target.dispatch("pointerdown");
      clock.advance(ms);
      target.dispatch("pointerup");
      target.dispatch("click", { detail: 1 });
    },
    // Enter or Space on a focused button: a click with no pointer (detail 0).
    keyboard(target: FakeElement) {
      target.dispatch("click", { detail: 0 });
    },
    // A click on a button, as the browser does it: nothing when disabled; a submit button submits its form.
    click(target: FakeElement) {
      if (target.disabled) return;
      target.dispatch("click", { detail: 1 });
      if (target.getAttribute("type") === "submit") target.closest("form")?.dispatch("submit");
    },
    choose(control: FakeElement, value: string) {
      control.value = value;
      control.dispatch("input");
      control.dispatch("change");
    },
    tick(control: FakeElement, on: boolean) {
      control.checked = on;
      control.dispatch("input");
      control.dispatch("change");
    },
    type(control: FakeElement, text: string) {
      control.value = text;
      control.dispatch("input");
    },
    pageHas: (name: string) => root.classList.contains(name),
  };
}
