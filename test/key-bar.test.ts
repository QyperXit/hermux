// The key bar through its interface (web/key-bar.js): attached to a Terminal
// screen, used with a finger or a keyboard, and asked to send keys and text and
// to announce. The screen is a fake DOM, the clock a fake one and the phone's
// storage memoryStorage() (test/support/key-bar.ts). No real DOM, no timers.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { memoryStorage } from "../web/home.js";
import { createKeyBar } from "../web/key-bar.js";
import { keyBarScreen } from "./support/key-bar";

const BAR = "Terminal keys";
const SLASH = "Saved commands";
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

describe("the key row", () => {
  // A phone is the only layout engine that counts, but the rules that keep the
  // row to one line are in the stylesheet, so they are read from it.
  const rule = (selector: string) => {
    const css = readFileSync(join(import.meta.dir, "../web/app.css"), "utf8");
    const found = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, "\\$&")} \\{([^}]*)\\}`));
    if (!found) throw new Error(`No rule for ${selector}`);
    return Object.fromEntries(found[1].split(";").map((line) => line.split(":").map((part) => part.trim())).filter((pair) => pair.length === 2));
  };

  test("every key, the answer keys, the bar and + included, is in one row that swipes sideways instead of wrapping", () => {
    const screen = keyBarScreen();
    const rows = screen.root.querySelectorAll(".keys");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll("button")).toHaveLength(ANSWER_NAMES.length + DEFAULT_BAR_NAMES.length + 1);
    expect(screen.root.querySelectorAll(".key-add").map((key) => key.parent)).toEqual([rows[0]]);
    const row = rule(".keys");
    expect([row.display, row["flex-wrap"], row["overflow-x"]]).toEqual(["flex", "nowrap", "auto"]);
  });

  test("a key keeps its 48px height and never shrinks, so a long bar scrolls instead of squeezing", () => {
    const key = rule(".key");
    expect([key.flex, key.height, key["min-width"]]).toEqual(["none", "var(--key)", "var(--key)"]);
  });
});

describe("saved commands", () => {
  const command = `say "hi" and $HOME\nthen 'stop' & \`id\``;
  type Screen = ReturnType<typeof keyBarScreen>;
  const slash = (screen: Screen) => screen.button(SLASH);
  const open = (screen: Screen) => screen.click(slash(screen));
  const popover = (screen: Screen) => screen.root.querySelector(".saved")!;
  // The shown buttons of the open popover, in order: the commands, then Edit.
  const listed = (screen: Screen) => popover(screen).querySelectorAll("button").filter((candidate) => candidate.shown).map((candidate) => candidate.getAttribute("aria-label") ?? candidate.textContent.trim());

  test("the / button opens the saved commands as a popover and Esc closes it, giving the focus back to /", () => {
    const screen = keyBarScreen();
    expect(popover(screen).shown).toBe(false);
    expect(slash(screen).getAttribute("aria-expanded")).toBe("false");
    open(screen);
    expect(popover(screen).shown).toBe(true);
    expect(slash(screen).getAttribute("aria-expanded")).toBe("true");
    expect(screen.focused()).toBe(screen.button("continue"));
    expect(listed(screen)).toEqual(["continue", "yes, go ahead", "status?", "Edit saved commands"]);
    expect(screen.sentTexts).toEqual([]);

    screen.focused()!.dispatch("keydown", { key: "Escape" });
    expect(popover(screen).shown).toBe(false);
    expect(slash(screen).getAttribute("aria-expanded")).toBe("false");
    expect(screen.focused()).toBe(slash(screen));
    expect(screen.sentTexts).toEqual([]);
  });

  test("a tap anywhere else closes the popover and the focus goes back to /; a second tap on / closes it too", () => {
    const screen = keyBarScreen();
    open(screen);
    screen.click(screen.root.querySelector(".output")!);
    expect(popover(screen).shown).toBe(false);
    expect(screen.focused()).toBe(slash(screen));

    open(screen);
    expect(popover(screen).shown).toBe(true);
    open(screen);
    expect(popover(screen).shown).toBe(false);
    expect(screen.focused()).toBe(slash(screen));
    expect(screen.sentTexts).toEqual([]);
  });

  test("an empty command has no button, and the others keep sending their own text", () => {
    const screen = keyBarScreen({ storage: storageWith({ commands: ["", "  ", "go"] }) });
    open(screen);
    expect(listed(screen)).toEqual(["go", "Edit saved commands"]);
    screen.click(screen.button("go"));
    expect(screen.sentTexts).toEqual(["go"]);
  });

  test("a tap inside the popover that isn't on a command leaves it open", () => {
    const screen = keyBarScreen();
    open(screen);
    screen.click(screen.root.querySelector(".saved-list")!);
    expect(popover(screen).shown).toBe(true);
  });

  test("a saved command with quotes, $, a newline and padding is sent exactly as written, and the popover closes", () => {
    const screen = keyBarScreen({ storage: storageWith({ commands: ["  /compact  ", command] }) });
    open(screen);
    expect(listed(screen)).toEqual(["/compact", command, "Edit saved commands"]);
    screen.click(screen.button(command));
    expect(screen.sentTexts).toEqual([command]);
    expect(popover(screen).shown).toBe(false);
    expect(screen.focused()).toBe(slash(screen));
    open(screen);
    screen.click(screen.button("/compact"));
    expect(screen.sentTexts).toEqual([command, "  /compact  "]);
  });

  test("a command written in the editor is kept on the phone and sent as written after a reload", () => {
    const storage = memoryStorage();
    const screen = keyBarScreen({ storage });
    open(screen);
    screen.click(screen.button("Edit saved commands"));
    expect(popover(screen).shown).toBe(false);
    screen.click(screen.button("Add command"));
    expect(screen.focused()).toBe(screen.field("Command 4"));
    screen.type(screen.field("Command 4"), command);
    // Kept as it is typed, so leaving the screen without Done loses nothing.
    const reloaded = keyBarScreen({ storage });
    open(reloaded);
    expect(listed(reloaded)).toEqual(["continue", "yes, go ahead", "status?", command, "Edit saved commands"]);
    screen.click(screen.root.querySelector("[data-commands-done]")!);

    const again = keyBarScreen({ storage });
    open(again);
    again.click(again.button(command));
    expect(again.sentTexts).toEqual([command]);
  });

  test("the editor moves and deletes commands, and drops empty ones when it closes; Done gives the focus back to /", () => {
    const storage = memoryStorage();
    const screen = keyBarScreen({ storage });
    open(screen);
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
    expect(screen.focused()).toBe(slash(screen));
    open(screen);
    expect(listed(screen)).toEqual(["yes, go ahead", "continue", "Edit saved commands"]);
    expect(JSON.parse(storage.getItem("agents.commands") ?? "null")).toEqual(["yes, go ahead", "continue"]);
  });

  test("with no commands the popover holds only Edit, and opening the key picker closes it", () => {
    const screen = keyBarScreen({ storage: storageWith({ commands: [] }) });
    open(screen);
    expect(listed(screen)).toEqual(["Edit saved commands"]);
    expect(screen.focused()).toBe(screen.button("Edit saved commands"));
    screen.click(screen.button("Add a key"));
    expect(popover(screen).shown).toBe(false);
    expect(slash(screen).getAttribute("aria-expanded")).toBe("false");
  });

  test("while the Agent is blocked an open popover closes", () => {
    const screen = keyBarScreen();
    open(screen);
    screen.keyBar.setBlocked(true);
    expect(popover(screen).shown).toBe(false);
    expect(slash(screen).getAttribute("aria-expanded")).toBe("false");
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
  screen.click(screen.button(SLASH));
  screen.click(screen.button("continue"));
  expect(storage.length).toBe(0);
});
