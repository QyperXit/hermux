import { expect, test } from "bun:test";
import { memoryStorage } from "../web/home.js";
import {
  ANSWER_KEYS,
  BAR_STORE_KEY,
  COMMANDS_STORE_KEY,
  DEFAULT_BAR,
  PICKER_GROUPS,
  isHoldKey,
  loadBar,
  loadCommands,
  moveItem,
  pickedKey,
  pickerKeyNames,
  saveBar,
  saveCommands,
} from "../web/keys.js";
import { isAllowedKey } from "../server/herdr";
import { REFUSED_KEYS, VALID_KEYS } from "./support/key-grammar";

test("the bar defaults to the v1 keys, and the answer keys stay apart from it", () => {
  expect(loadBar(memoryStorage())).toEqual([
    { key: "esc", label: "Esc" },
    { key: "tab", label: "Tab" },
    { key: "up", label: "Up" },
    { key: "down", label: "Down" },
    { key: "enter", label: "Enter" },
    { key: "ctrl+c", label: "Ctrl C" },
  ]);
  expect(ANSWER_KEYS.map(({ key }) => key)).toEqual(["1", "2", "3", "4", "left", "right"]);
});

test("a changed bar is saved and read back in its order, labels included", () => {
  const store = memoryStorage();
  const bar = [...DEFAULT_BAR, { key: "ctrl+x", label: "Exit nano" }, { key: "f5", label: "F5" }];
  saveBar(store, moveItem(bar, 6, -6));
  expect(loadBar(store)).toEqual([{ key: "ctrl+x", label: "Exit nano" }, ...DEFAULT_BAR, { key: "f5", label: "F5" }]);
  saveBar(store, []);
  expect(loadBar(store)).toEqual([]);
});

test("a saved bar with a key outside the grammar, or unreadable, falls back to the default", () => {
  for (const saved of ['[{"key":"pageup","label":"PgUp"}]', '[{"key":"ctrl+x","label":""}]', '[{"key":"Ctrl+x","label":"x"}]', "{", '"esc"', "null"]) {
    const store = memoryStorage();
    store.setItem(BAR_STORE_KEY, saved);
    expect([saved, loadBar(store)]).toEqual([saved, DEFAULT_BAR]);
  }
});

test("Ctrl C, Ctrl D, Ctrl Z and Ctrl \\ are hold keys wherever they are; no other key is", () => {
  expect(["ctrl+c", "ctrl+d", "ctrl+z", "ctrl+\\"].every(isHoldKey)).toBe(true);
  const others = [...pickerKeyNames()].filter((key) => !["ctrl+c", "ctrl+d", "ctrl+z", "ctrl+\\"].includes(key));
  expect(others.filter(isHoldKey)).toEqual([]);
  expect([...DEFAULT_BAR, ...ANSWER_KEYS].filter(({ key }) => isHoldKey(key)).map(({ key }) => key)).toEqual(["ctrl+c"]);
});

test("the picker makes exactly the keys the server accepts", () => {
  const made = [...pickerKeyNames()];
  expect(made.every(isAllowedKey)).toBe(true);
  expect(made.sort()).toEqual([...VALID_KEYS].sort());
  // herdr 0.9.5 has no name for these, so the picker doesn't offer them.
  const bases = PICKER_GROUPS.flatMap(({ keys }) => keys.map(({ base }) => base));
  for (const missing of ["pageup", "pagedown", "home", "end", "delete"]) expect(bases).not.toContain(missing);
});

// The picker's own key list against the independent list: a key it offers
// that the grammar refuses, or one the grammar takes that it lacks, fails here.
test("every key the picker offers can be added, and none it makes is refused", () => {
  const combos = [false, true].flatMap((ctrl) => [false, true].flatMap((alt) => [false, true].map((shift) => ({ ctrl, alt, shift }))));
  const unmade = PICKER_GROUPS.flatMap(({ keys }) => keys.map(({ base }) => base)).filter((base) => !combos.some((mods) => pickedKey({ ...mods, base }).key));
  expect(unmade).toEqual([]);
  const made = pickerKeyNames();
  expect(REFUSED_KEYS.filter((key) => made.has(key))).toEqual([]);
});

test("a saved bar may hold any key of the grammar and no other", () => {
  for (const key of [...VALID_KEYS, ...REFUSED_KEYS]) {
    const store = memoryStorage();
    saveBar(store, [{ key, label: "k" }]);
    expect([key, loadBar(store)[0]]).toEqual([key, VALID_KEYS.includes(key) ? { key, label: "k" } : DEFAULT_BAR[0]]);
  }
});

test("the picker names the key, its default label, or why a combination can't be sent", () => {
  expect(pickedKey({ ctrl: true, base: "x" })).toEqual({ key: "ctrl+x", label: "Ctrl X" });
  expect(pickedKey({ alt: true, base: "b" })).toEqual({ key: "alt+b", label: "Alt B" });
  expect(pickedKey({ ctrl: true, base: "\\" })).toEqual({ key: "ctrl+\\", label: "Ctrl \\" });
  expect(pickedKey({ shift: true, base: "tab" })).toEqual({ key: "shift+tab", label: "Shift Tab" });
  expect(pickedKey({ base: "f5" })).toEqual({ key: "f5", label: "F5" });
  expect(pickedKey({ base: "backspace" })).toEqual({ key: "backspace", label: "Bksp" });
  expect(pickedKey({ base: "x" }).error).toBe("A letter needs Ctrl or Alt.");
  expect(pickedKey({ ctrl: true, alt: true, base: "x" }).error).toBe("Pick Ctrl or Alt, not both.");
  expect(pickedKey({ ctrl: true, shift: true, base: "x" }).error).toBe("Shift goes only with Tab.");
  expect(pickedKey({ ctrl: true, base: "tab" }).error).toBe("Tab takes Shift only.");
  expect(pickedKey({ ctrl: true, base: "up" }).error).toBe("Up takes no Ctrl, Alt or Shift.");
  expect(pickedKey({ ctrl: true, base: "1" }).error).toBe("1 takes no Ctrl, Alt or Shift.");
  expect(pickedKey({ base: "pageup" }).error).toBe("Pick a key.");
});

test("saved commands default to the three quick replies and are kept exactly as written", () => {
  const store = memoryStorage();
  expect(loadCommands(store)).toEqual(["continue", "yes, go ahead", "status?"]);
  const commands = ["/compact", `say "hi" and $HOME\nthen 'stop'\n`, "  spaced  ", "continue"];
  saveCommands(store, moveItem(commands, 0, 1));
  expect(loadCommands(store)).toEqual([`say "hi" and $HOME\nthen 'stop'\n`, "/compact", "  spaced  ", "continue"]);
  store.setItem(COMMANDS_STORE_KEY, "[1]");
  expect(loadCommands(store)).toEqual(["continue", "yes, go ahead", "status?"]);
});

test("moving an item stops at either end", () => {
  expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
});
