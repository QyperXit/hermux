// The message box of a Terminal screen (web/composer.js), drawn into the same
// fake page the key bar's tests use: what it says about its target, its send
// arrow while a send is in flight, and what it does while the Agent is blocked
// (D5, D34). The "/" popover is the key bar's (test/key-bar.test.ts).
import { describe, expect, test } from "bun:test";
import { drawComposer } from "../web/composer.js";
import { asPageElement } from "./support/fake-dom";
import { keyBarScreen } from "./support/key-bar";

function composer(state: { target?: string; sending?: boolean; blocked?: boolean } = {}) {
  const screen = keyBarScreen();
  const draw = (next: typeof state = {}) => drawComposer(asPageElement(screen.root), { target: "weather-app", sending: false, blocked: false, ...state, ...next });
  draw();
  return { screen, draw };
}

describe("the message box names its target", () => {
  test("the placeholder, the field's label, the send arrow and the saved commands all name the Terminal", () => {
    const { screen } = composer();
    expect(screen.field("Message weather-app").placeholder).toBe("Message weather-app");
    expect(screen.field("Message weather-app").getAttribute("name")).toBe("message");
    expect(screen.button("Send to weather-app").getAttribute("type")).toBe("submit");
    expect(screen.dialog("Send a saved command to weather-app").shown).toBe(false);
  });

  test("a different Terminal renames all of them, and the arrow sends nothing by itself", () => {
    const { screen, draw } = composer();
    draw({ target: "usage-dashboard" });
    expect(screen.field("Message usage-dashboard").placeholder).toBe("Message usage-dashboard");
    screen.button("Send to usage-dashboard");
    expect(screen.root.querySelectorAll("button").filter((button) => button.getAttribute("aria-label")?.includes("weather-app"))).toEqual([]);
    expect(screen.sentTexts).toEqual([]);
  });

  test("the send arrow is only an arrow: no visible text, and the old separate Send button and commands row are gone", () => {
    const { screen } = composer();
    expect(screen.root.querySelector(".send")?.textContent).toBe("");
    expect(screen.root.querySelectorAll(".send-label, .replies, .reply")).toEqual([]);
    expect(screen.root.querySelectorAll(".composer-box .slash, .composer-box .send")).toHaveLength(2);
  });
});

describe("while a send is in flight", () => {
  test("the arrow is busy and disabled, still naming its target, and works again when the send ends", () => {
    const { screen, draw } = composer();
    const arrow = () => screen.root.querySelector(".send")!;
    expect([arrow().disabled, arrow().getAttribute("aria-busy")]).toEqual([false, "false"]);
    draw({ sending: true });
    expect([arrow().disabled, arrow().getAttribute("aria-busy"), arrow().getAttribute("aria-label")]).toEqual([true, "true", "Sending to weather-app"]);
    // A disabled arrow does not submit.
    let submitted = 0;
    screen.root.querySelector(".composer")!.addEventListener("submit", () => void submitted++);
    screen.click(arrow());
    expect(submitted).toBe(0);
    draw({ sending: false });
    expect([arrow().disabled, arrow().getAttribute("aria-busy"), arrow().getAttribute("aria-label")]).toEqual([false, "false", "Send to weather-app"]);
    screen.click(arrow());
    expect(submitted).toBe(1);
  });
});

describe("a blocked Agent", () => {
  test("hides the message box and shows the blocked note, and the box comes back when it isn't blocked", () => {
    const { screen, draw } = composer();
    const note = () => screen.root.querySelector(".blocked-note")!;
    expect([screen.root.querySelector(".composer")!.shown, note().shown]).toEqual([true, false]);
    draw({ blocked: true });
    expect([screen.root.querySelector(".composer")!.shown, note().shown]).toEqual([false, true]);
    expect(note().textContent).toContain("Waiting for your answer. Read the question above, then pick with the keys.");
    expect(screen.root.querySelector("#message")!.shown).toBe(false);
    draw({ blocked: false });
    expect([screen.root.querySelector(".composer")!.shown, note().shown]).toEqual([true, false]);
  });
});

describe("leaving the screen with the saved commands open", () => {
  test("a later tap on whatever the page shows next is ignored, not an error", () => {
    const { screen } = composer();
    screen.tap(screen.button("Saved commands"));
    expect(screen.dialog("Send a saved command to weather-app").shown).toBe(true);
    screen.root.innerHTML = '<button type="button">A home row</button>';
    const homeRow = screen.root.querySelectorAll("button")[0];
    expect(() => screen.tap(homeRow)).not.toThrow();
    expect(() => screen.tap(homeRow)).not.toThrow();
  });
});
