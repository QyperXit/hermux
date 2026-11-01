// The agent screen's terminal keys and saved commands. The key bar and
// the saved commands are kept on the phone in localStorage; these functions take
// the store as an argument so tests can pass memoryStorage().
import { isAllowedKey } from "./key-grammar.js";

/**
 * One key of the bar: the key name the server accepts, and its label.
 * @typedef {{ key: string, label: string }} BarEntry
 */

/**
 * The part of localStorage these functions use.
 * @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} Store
 */

export const BAR_STORE_KEY = "agents.keys";
export const COMMANDS_STORE_KEY = "agents.commands";

// Shown only while the agent is blocked, before the bar; never saved or edited.
/** @type {BarEntry[]} */
export const ANSWER_KEYS = [
  { key: "1", label: "1" },
  { key: "2", label: "2" },
  { key: "3", label: "3" },
  { key: "4", label: "4" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
];

// The bar before the user changes it.
/** @type {BarEntry[]} */
export const DEFAULT_BAR = [
  { key: "esc", label: "Esc" },
  { key: "tab", label: "Tab" },
  { key: "up", label: "Up" },
  { key: "down", label: "Down" },
  { key: "enter", label: "Enter" },
  { key: "ctrl+c", label: "Ctrl C" },
];

const DEFAULT_COMMANDS = ["continue", "yes, go ahead", "status?"];

// These interrupt, end or suspend what runs in the pane, so they send only
// after a hold (or a second press from the keyboard), wherever they are.
const HOLD_KEYS = ["ctrl+c", "ctrl+d", "ctrl+z", "ctrl+\\"];
/** @param {string} key */
export const isHoldKey = (key) => HOLD_KEYS.includes(key);

// Keys drawn as icons when they carry their own label.
/** @type {Record<string, string>} */
export const KEY_ICONS = { left: "i-left", right: "i-right", tab: "i-tab", up: "i-up", down: "i-down", enter: "i-enter" };

export const LABEL_MAX = 12;

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

// The picker's key list. `mods` says which modifiers the key takes: a letter
// takes Ctrl or Alt (one of them, and needs it), \ takes Ctrl (and needs it),
// Tab may take Shift, and the rest take none. The picker makes only key names
// of the shared grammar (web/key-grammar.js), the one the server checks.
/**
 * A key the picker offers; `mods` as above.
 * @typedef {{ base: string, label: string, mods?: "letter" | "ctrl" | "shift" }} PickerKey
 */

/** @type {{ group: string, keys: PickerKey[] }[]} */
export const PICKER_GROUPS = [
  { group: "Letters, with Ctrl or Alt", keys: LETTERS.map((letter) => ({ base: letter, label: letter.toUpperCase(), mods: "letter" })) },
  { group: "Backslash, with Ctrl", keys: [{ base: "\\", label: "\\", mods: "ctrl" }] },
  {
    group: "Keys",
    keys: [
      { base: "esc", label: "Esc" },
      { base: "tab", label: "Tab", mods: "shift" },
      { base: "enter", label: "Enter" },
      { base: "backspace", label: "Backspace" },
    ],
  },
  { group: "Arrows", keys: ["up", "down", "left", "right"].map((base) => ({ base, label: base[0].toUpperCase() + base.slice(1) })) },
  { group: "Function keys", keys: Array.from({ length: 12 }, (_, index) => ({ base: `f${index + 1}`, label: `F${index + 1}` })) },
  { group: "Digits", keys: "0123456789".split("").map((digit) => ({ base: digit, label: digit })) },
];

const PICKER_KEYS = PICKER_GROUPS.flatMap(({ keys }) => keys);

// The key name and its default label for a picker choice, or the reason the
// combination can't be sent. A name outside the shared grammar is never made.
/**
 * @typedef {{ key: string, label: string, error?: undefined } | { error: string, key?: undefined, label?: undefined }} PickedKey
 */

/**
 * @param {{ ctrl?: boolean, alt?: boolean, shift?: boolean, base: string }} choice
 * @returns {PickedKey}
 */
export function pickedKey({ ctrl = false, alt = false, shift = false, base }) {
  const picked = pickedName({ ctrl, alt, shift, base });
  if (picked.key !== undefined && !isAllowedKey(picked.key)) return { error: "Pick a key." };
  return picked;
}

/**
 * @param {{ ctrl: boolean, alt: boolean, shift: boolean, base: string }} choice
 * @returns {PickedKey}
 */
function pickedName({ ctrl, alt, shift, base }) {
  const entry = PICKER_KEYS.find((candidate) => candidate.base === base);
  if (!entry) return { error: "Pick a key." };
  if (entry.mods === "letter") {
    if (shift) return { error: "Shift goes only with Tab." };
    if (ctrl && alt) return { error: "Pick Ctrl or Alt, not both." };
    if (!ctrl && !alt) return { error: "A letter needs Ctrl or Alt." };
    return ctrl ? { key: `ctrl+${base}`, label: `Ctrl ${entry.label}` } : { key: `alt+${base}`, label: `Alt ${entry.label}` };
  }
  if (entry.mods === "ctrl") {
    if (!ctrl || alt || shift) return { error: "Backslash goes with Ctrl only." };
    return { key: "ctrl+\\", label: "Ctrl \\" };
  }
  if (ctrl || alt || (shift && entry.mods !== "shift")) {
    return { error: entry.mods === "shift" ? "Tab takes Shift only." : `${entry.label} takes no Ctrl, Alt or Shift.` };
  }
  if (shift) return { key: "shift+tab", label: "Shift Tab" };
  return { key: entry.base, label: entry.base === "backspace" ? "Bksp" : entry.label };
}

// The label the picker gives a key name, e.g. "Ctrl X" for ctrl+x.
/** @param {string} key */
export function defaultLabel(key) {
  const [modifier, base] = key.length > 1 && key.includes("+") ? key.split(/\+(.+)/) : [null, key];
  return pickedKey({ ctrl: modifier === "ctrl", alt: modifier === "alt", shift: modifier === "shift", base }).label ?? key;
}

// Every key name the picker can make.
export function pickerKeyNames() {
  /** @type {Set<string>} */
  const names = new Set();
  for (const { base } of PICKER_KEYS) {
    for (const ctrl of [false, true]) {
      for (const alt of [false, true]) {
        for (const shift of [false, true]) {
          const { key } = pickedKey({ ctrl, alt, shift, base });
          if (key) names.add(key);
        }
      }
    }
  }
  return names;
}

/**
 * @param {Pick<Store, "getItem">} store
 * @param {string} name
 * @returns {unknown}
 */
function read(store, name) {
  try {
    return JSON.parse(store.getItem(name) ?? "null");
  } catch {
    return null;
  }
}

/**
 * @param {unknown} entry
 * @returns {entry is BarEntry}
 */
const isBarEntry = (entry) =>
  typeof entry === "object" &&
  entry !== null &&
  "key" in entry &&
  typeof entry.key === "string" &&
  isAllowedKey(entry.key) &&
  "label" in entry &&
  typeof entry.label === "string" &&
  entry.label.length > 0 &&
  entry.label.length <= LABEL_MAX;

// The saved bar, or the default when nothing (or something unreadable) is saved.
/**
 * @param {Pick<Store, "getItem">} store
 * @returns {BarEntry[]}
 */
export function loadBar(store) {
  const saved = read(store, BAR_STORE_KEY);
  if (Array.isArray(saved) && saved.every(isBarEntry)) return saved.map(({ key, label }) => ({ key, label }));
  return DEFAULT_BAR.map((entry) => ({ ...entry }));
}

/**
 * @param {Pick<Store, "setItem">} store
 * @param {BarEntry[]} bar
 */
export function saveBar(store, bar) {
  store.setItem(BAR_STORE_KEY, JSON.stringify(bar.map(({ key, label }) => ({ key, label }))));
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

// Saved commands are kept exactly as written.
/**
 * @param {Pick<Store, "getItem">} store
 * @returns {string[]}
 */
export function loadCommands(store) {
  const saved = read(store, COMMANDS_STORE_KEY);
  if (isStringList(saved)) return saved;
  return [...DEFAULT_COMMANDS];
}

/**
 * @param {Pick<Store, "setItem">} store
 * @param {string[]} commands
 */
export function saveCommands(store, commands) {
  store.setItem(COMMANDS_STORE_KEY, JSON.stringify(commands));
}

// A copy of `list` with the item at `index` moved by `delta` places (kept in range).
/**
 * @template T
 * @param {T[]} list
 * @param {number} index
 * @param {number} delta
 * @returns {T[]}
 */
export function moveItem(list, index, delta) {
  const to = Math.max(0, Math.min(list.length - 1, index + delta));
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(to, 0, item);
  return copy;
}
