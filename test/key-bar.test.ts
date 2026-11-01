// The key bar through its interface (web/key-bar.js): attached to a Terminal
// screen, used with a finger or a keyboard, and asked to send keys and text and
// to announce. The screen is a fake DOM, the clock a fake one and the phone's
// storage memoryStorage() (test/support/key-bar.ts). No real DOM, no timers.
import { describe, expect, test } from "bun:test";
import { memoryStorage } from "../web/home.js";
import { createKeyBar } from "../web/key-bar.js";
import { keyBarScreen } from "./support/key-bar";

const BAR = "Terminal keys";
const COMMANDS = "Saved commands";
const DEFAULT_BAR_NAMES = ["Send Esc", "Send Tab", "Send Up", "Send Down", "Send Enter", "Hold to send Ctrl C"];
const ANSWER_NAMES = ["Send 1", "Send 2", "Send 3", "Send 4", "Send Left", "Send Right"];

// A phone that already keeps this bar or these commands.
function storageWith({ bar, commands }: { bar?: { key: string; label: string }[]; commands?: string[] }) {
  const storage = memoryStorage();
  if (bar) storage.setItem("agents.keys", JSON.stringify(bar));
  if (commands) storage.setItem("agents.commands", JSON.stringify(commands));
  return storage;
}

describe("hold keys", () => {
  test("holding Ctrl C for 700 ms sends Ctrl+C exactly once, and not at 699 ms", () => {
    const screen = keyBarScreen();
    const ctrlC = screen.button("Hold to send Ctrl C");
    screen.press(ctrlC);
    expect(ctrlC.classList.contains("is-holding")).toBe(true);
    screen.clock.advance(699);
    expect(screen.sentKeys).toEqual([]);
    screen.clock.advance(1);
    expect(screen.sentKeys).toEqual([{ key: "ctrl+c", label: "Ctrl C" }]);
    expect(ctrlC.classList.contains("is-holding")).toBe(false);
    screen.release(ctrlC);
    screen.clock.advance(5000);
    expect(screen.sentKeys).toEqual([{ key: "ctrl+c", label: "Ctrl C" }]);
    expect(screen.notices).toEqual([]);
  });

  test("a short tap on Ctrl C sends nothing and says to hold it", () => {
    const screen = keyBarScreen();
    const ctrlC = screen.button("Hold to send Ctrl C");
    screen.hold(ctrlC, 150);
    screen.clock.advance(5000);
    expect(screen.sentKeys).toEqual([]);
    expect(screen.announced()).toEqual(["Hold Ctrl C until it fills to send it."]);
    expect(ctrlC.classList.contains("is-holding")).toBe(false);
  });

  test("from the keyboard Ctrl C needs a second press within 2.5 s", () => {
    const screen = keyBarScreen();
    const ctrlC = screen.button("Hold to send Ctrl C");
    screen.keyboard(ctrlC);
    expect(screen.sentKeys).toEqual([]);
    expect(screen.announced()).toEqual(["Press Ctrl C again to send it."]);
    screen.clock.advance(2499);
    screen.keyboard(ctrlC);
    expect(screen.sentKeys).toEqual([{ key: "ctrl+c", label: "Ctrl C" }]);
    // Sent, so the next press starts again.
    screen.keyboard(ctrlC);
    expect(screen.sentKeys).toHaveLength(1);
    expect(screen.announced()).toEqual(["Press Ctrl C again to send it.", "Press Ctrl C again to send it."]);
  });

  test("a second keyboard press after 2.5 s only asks again", () => {
    const screen = keyBarScreen();
    const ctrlC = screen.button("Hold to send Ctrl C");
    screen.keyboard(ctrlC);
    screen.clock.advance(2500);
    screen.keyboard(ctrlC);
    expect(screen.sentKeys).toEqual([]);
    expect(screen.announced()).toEqual(["Press Ctrl C again to send it.", "Press Ctrl C again to send it."]);
    screen.clock.advance(1000);
    screen.keyboard(ctrlC);
    expect(screen.sentKeys).toEqual([{ key: "ctrl+c", label: "Ctrl C" }]);
  });

  test("Ctrl D, Ctrl Z and Ctrl \\ are hold keys too, wherever they are on the bar", () => {
    const bar = [
      { key: "ctrl+d", label: "Ctrl D" },
      { key: "esc", label: "Esc" },
      { key: "ctrl+z", label: "Suspend" },
      { key: "ctrl+\\", label: "Ctrl \\" },
    ];
    const screen = keyBarScreen({ storage: storageWith({ bar }) });
    const holdNames = ["Hold to send Ctrl D", "Hold to send Suspend", "Hold to send Ctrl \\"];
    expect(screen.names(BAR)).toEqual([...ANSWER_NAMES, holdNames[0], "Send Esc", holdNames[1], holdNames[2], "Add a key"]);
    for (const name of holdNames) screen.tap(screen.button(name));
    expect(screen.sentKeys).toEqual([]);
    for (const name of holdNames) screen.hold(screen.button(name), 700);
    expect(screen.sentKeys).toEqual([
      { key: "ctrl+d", label: "Ctrl D" },
      { key: "ctrl+z", label: "Suspend" },
      { key: "ctrl+\\", label: "Ctrl \\" },
    ]);
  });
});

describe("tap keys", () => {
  test("the bar shows the answer keys, the default keys in order, then the + key", () => {
    const screen = keyBarScreen();
    expect(screen.names(BAR)).toEqual([...ANSWER_NAMES, ...DEFAULT_BAR_NAMES, "Add a key"]);
  });

  test("a tap on Esc or Up sends that key once, with its name", () => {
    const screen = keyBarScreen();
    screen.tap(screen.button("Send Esc"));
    screen.tap(screen.button("Send Up"));
    screen.clock.advance(5000);
    expect(screen.sentKeys).toEqual([
      { key: "esc", label: "Esc" },
      { key: "up", label: "Up" },
    ]);
    expect(screen.notices).toEqual([]);
  });

  test("the answer keys send on a tap, even with the picker open, and are never edited", () => {
    const screen = keyBarScreen();
    screen.tap(screen.button("Send 2"));
    screen.tap(screen.button("Send Right"));
    expect(screen.sentKeys).toEqual([
      { key: "2", label: "2" },
      { key: "right", label: "Right" },
    ]);
    screen.click(screen.button("Add a key"));
    expect(screen.names(BAR)).toEqual([...ANSWER_NAMES, "Edit Esc", "Edit Tab", "Edit Up", "Edit Down", "Edit Enter", "Edit Ctrl C", "Add a key"]);
    screen.tap(screen.button("Send 2"));
    expect(screen.sentKeys).toEqual([
      { key: "2", label: "2" },
      { key: "right", label: "Right" },
      { key: "2", label: "2" },
    ]);
  });
});

describe("editing the bar", () => {
  test("a long press of 500 ms opens the key's edit menu and sends nothing; Right moves it and the bar keeps the order", () => {
    const storage = memoryStorage();
    const screen = keyBarScreen({ storage });
    const esc = screen.button("Send Esc");
    screen.press(esc);
    screen.clock.advance(499);
    expect(screen.root.querySelector(".key-menu")?.shown).toBe(false);
    screen.clock.advance(1);
    expect(screen.group("Edit the Esc key").shown).toBe(true);
    screen.release(esc);
    expect(screen.sentKeys).toEqual([]);
    expect(screen.focused()).toBe(screen.button("Move Esc right"));

    screen.click(screen.button("Move Esc right"));
    const moved = [...ANSWER_NAMES, "Send Tab", "Send Esc", "Send Up", "Send Down", "Send Enter", "Hold to send Ctrl C", "Add a key"];
    expect(screen.names(BAR)).toEqual(moved);
    expect(screen.focused()).toBe(screen.button("Move Esc right"));
    expect(screen.sentKeys).toEqual([]);

    expect(keyBarScreen({ storage }).names(BAR)).toEqual(moved);
  });

  test("the context menu opens the edit menu too; Remove takes the key off and says the bar is saved", () => {
    const storage = memoryStorage();
    const screen = keyBarScreen({ storage });
    const menu = screen.button("Send Up").dispatch("contextmenu");
    expect(menu.defaultPrevented).toBe(true);
    expect(screen.group("Edit the Up key").shown).toBe(true);
    screen.click(screen.button("Remove Up"));
    const removed = [...ANSWER_NAMES, "Send Esc", "Send Tab", "Send Down", "Send Enter", "Hold to send Ctrl C", "Add a key"];
    expect(screen.names(BAR)).toEqual(removed);
    expect(screen.announced()).toEqual(["Removed Up. The bar is saved on this phone."]);
    expect(screen.focused()).toBe(screen.button("Add a key"));
    expect(keyBarScreen({ storage }).names(BAR)).toEqual(removed);
    expect(screen.sentKeys).toEqual([]);
  });

  test("the first key can't move left; Done closes the menu and gives the key its focus back", () => {
    const screen = keyBarScreen();
    screen.hold(screen.button("Send Esc"), 500);
    expect(screen.button("Move Esc left").disabled).toBe(true);
    expect(screen.focused()).toBe(screen.button("Move Esc right"));
    screen.click(screen.button("Done"));
    expect(screen.root.querySelector(".key-menu")?.shown).toBe(false);
    expect(screen.focused()).toBe(screen.button("Send Esc"));
  });

  test("the picker adds Ctrl X (Ctrl ticked, X chosen): the bar gains it, keeps it and says so", () => {
    const storage = memoryStorage();
    const screen = keyBarScreen({ storage });
    screen.click(screen.button("Add a key"));
    expect(screen.pageHas("is-editing-keys")).toBe(true);
    expect(screen.focused()).toBe(screen.field("Key"));
    expect(screen.field("Ctrl").checked).toBe(true);
    screen.choose(screen.field("Key"), "x");
    expect(screen.root.querySelector(".picker-status")?.textContent).toBe("Adds Ctrl X.");
    screen.click(screen.button("Add key"));
    expect(screen.announced()).toEqual(["Added Ctrl X. The bar is saved on this phone."]);
    expect(JSON.parse(storage.getItem("agents.keys") ?? "null")).toEqual([
      { key: "esc", label: "Esc" },
      { key: "tab", label: "Tab" },
      { key: "up", label: "Up" },
      { key: "down", label: "Down" },
      { key: "enter", label: "Enter" },
      { key: "ctrl+c", label: "Ctrl C" },
      { key: "ctrl+x", label: "Ctrl X" },
    ]);

    // With the picker open, a bar key is edited, not sent.
    screen.tap(screen.button("Edit Ctrl X"));
    expect(screen.sentKeys).toEqual([]);
    expect(screen.group("Edit the Ctrl X key").shown).toBe(true);

    screen.click(screen.root.querySelector("[data-picker-done]")!);
    expect(screen.pageHas("is-editing-keys")).toBe(false);
    expect(screen.focused()).toBe(screen.button("Add a key"));
    screen.tap(screen.button("Send Ctrl X"));
    expect(screen.sentKeys).toEqual([{ key: "ctrl+x", label: "Ctrl X" }]);
    expect(keyBarScreen({ storage }).names(BAR)).toContain("Send Ctrl X");
  });

  test("the picker says why a combination can't be added, and adds a key under the user's own label", () => {
    const screen = keyBarScreen();
    screen.click(screen.button("Add a key"));
    const status = () => screen.root.querySelector(".picker-status")?.textContent;
    const add = () => screen.button("Add key");
    screen.choose(screen.field("Key"), "x");
    screen.tick(screen.field("Ctrl"), false);
    expect([status(), add().disabled]).toEqual(["A letter needs Ctrl or Alt.", true]);
    screen.tick(screen.field("Ctrl"), true);
    screen.tick(screen.field("Alt"), true);
    expect([status(), add().disabled]).toEqual(["Pick Ctrl or Alt, not both.", true]);
    screen.tick(screen.field("Alt"), false);
    screen.choose(screen.field("Key"), "tab");
    expect([status(), add().disabled]).toEqual(["Tab takes Shift only.", true]);
    screen.click(add());
    expect(screen.notices).toEqual([]);
    screen.tick(screen.field("Ctrl"), false);
    screen.tick(screen.field("Shift"), true);
    screen.type(screen.field("Label"), "  Back tab ");
    expect([status(), add().disabled]).toEqual(["Adds Shift Tab, labelled “Back tab”.", false]);
    screen.click(add());
    expect(screen.announced()).toEqual(["Added Back tab. The bar is saved on this phone."]);
    expect(screen.field("Label").value).toBe("");
    expect(screen.names(BAR)).toContain("Edit Back tab");
  });
});

describe("saved commands", () => {
  const command = `say "hi" and $HOME\nthen 'stop' & \`id\``;

  test("a saved command with quotes, $ and a newline is sent exactly as written", () => {
    const screen = keyBarScreen({ storage: storageWith({ commands: ["  /compact  ", command] }) });
    expect(screen.names(COMMANDS)).toEqual(["Edit saved commands", "/compact", command]);
    screen.click(screen.button(command));
    screen.click(screen.button("/compact"));
    expect(screen.sentTexts).toEqual([command, "  /compact  "]);
  });

  test("a command written in the editor is kept on the phone and sent as written after a reload", () => {
    const storage = memoryStorage();
    const screen = keyBarScreen({ storage });
    screen.click(screen.button("Edit saved commands"));
    screen.click(screen.button("Add command"));
    expect(screen.focused()).toBe(screen.field("Command 4"));
    screen.type(screen.field("Command 4"), command);
    // Kept as it is typed, so leaving the screen without Done loses nothing.
    expect(keyBarScreen({ storage }).names(COMMANDS)).toEqual(["Edit saved commands", "continue", "yes, go ahead", "status?", command]);
    screen.click(screen.root.querySelector("[data-commands-done]")!);

    const again = keyBarScreen({ storage });
    expect(again.names(COMMANDS)).toEqual(["Edit saved commands", "continue", "yes, go ahead", "status?", command]);
    again.click(again.button(command));
    expect(again.sentTexts).toEqual([command]);
  });

  test("the editor moves and deletes commands, and drops empty ones when it closes", () => {
    const storage = memoryStorage();
    const screen = keyBarScreen({ storage });
    screen.click(screen.button("Edit saved commands"));
    expect(screen.pageHas("is-editing-commands")).toBe(true);
    expect(screen.field("Command 1").value).toBe("continue");
    expect(screen.focused()).toBe(screen.field("Command 1"));
    expect(screen.button("Move command 1 up").disabled).toBe(true);
    expect(screen.button("Move command 3 down").disabled).toBe(true);

    screen.click(screen.button("Move command 1 down"));
    expect([1, 2, 3].map((n) => screen.field(`Command ${n}`).value)).toEqual(["yes, go ahead", "continue", "status?"]);
    expect(screen.focused()).toBe(screen.button("Move command 2 down"));

    screen.click(screen.button("Delete command 3"));
    expect(screen.announced()).toEqual(["Command deleted. Saved commands are kept on this phone."]);
    expect(screen.focused()).toBe(screen.button("Add command"));

    screen.click(screen.button("Add command"));
    screen.type(screen.field("Command 3"), "   ");
    screen.click(screen.root.querySelector("[data-commands-done]")!);
    expect(screen.pageHas("is-editing-commands")).toBe(false);
    expect(screen.focused()).toBe(screen.button("Edit saved commands"));
    expect(screen.names(COMMANDS)).toEqual(["Edit saved commands", "yes, go ahead", "continue"]);
    expect(JSON.parse(storage.getItem("agents.commands") ?? "null")).toEqual(["yes, go ahead", "continue"]);
  });

  test("while the Agent is blocked the saved commands are hidden", () => {
    const screen = keyBarScreen();
    screen.keyBar.setBlocked(true);
    expect(screen.group(COMMANDS).shown).toBe(false);
    screen.keyBar.setBlocked(false);
    expect(screen.group(COMMANDS).shown).toBe(true);
  });
});

test("making the key bar writes nothing to the phone and touches no page; attaching and sending write nothing either", () => {
  const storage = memoryStorage();
  const keyBar = createKeyBar({ storage });
  expect(Object.keys(keyBar)).toEqual(["attach", "setBlocked"]);
  expect(storage.length).toBe(0);
  expect(() => keyBar.setBlocked(true)).toThrow("The key bar isn't attached to a screen.");
  const screen = keyBarScreen({ storage });
  screen.tap(screen.button("Send Esc"));
  screen.click(screen.button("continue"));
  expect(storage.length).toBe(0);
});
