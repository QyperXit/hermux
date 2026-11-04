import { isAllowedKey } from "./key-grammar.js";

/**
 * @typedef {{ key: string, label: string }} BarEntry
 */

/**
 * @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} Store
 */

export const BAR_STORE_KEY = "agents.keys";
export const COMMANDS_STORE_KEY = "agents.commands";

/** @type {BarEntry[]} */
export const ANSWER_KEYS = [
  { key: "1", label: "1" },
  { key: "2", label: "2" },
  { key: "3", label: "3" },
  { key: "4", label: "4" },
  { key: "left", label: "Left" },
  { key: "right", label: "Right" },
];

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

const INTERRUPT_KEYS = ["ctrl+c", "ctrl+d", "ctrl+z", "ctrl+\\"];
/** @param {string} key */
export const isHoldKey = (key) => INTERRUPT_KEYS.includes(key);

/** @type {Record<string, string>} */
export const KEY_ICONS = { left: "i-left", right: "i-right", tab: "i-tab", up: "i-up", down: "i-down", enter: "i-enter" };

export const LABEL_MAX = 12;

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

/**
 * @typedef {{ base: string, label: string, mods?: "ctrl-or-alt" | "ctrl-only" | "shift-optional" }} PickerKey
 */

/** @type {{ group: string, keys: PickerKey[] }[]} */
export const PICKER_GROUPS = [
  { group: "Letters, with Ctrl or Alt", keys: LETTERS.map((letter) => ({ base: letter, label: letter.toUpperCase(), mods: "ctrl-or-alt" })) },
  { group: "Backslash, with Ctrl", keys: [{ base: "\\", label: "\\", mods: "ctrl-only" }] },
  {
    group: "Keys",
    keys: [
      { base: "esc", label: "Esc" },
      { base: "tab", label: "Tab", mods: "shift-optional" },
      { base: "enter", label: "Enter" },
      { base: "backspace", label: "Backspace" },
    ],
  },
  { group: "Arrows", keys: ["up", "down", "left", "right"].map((base) => ({ base, label: base[0].toUpperCase() + base.slice(1) })) },
  { group: "Function keys", keys: Array.from({ length: 12 }, (_, index) => ({ base: `f${index + 1}`, label: `F${index + 1}` })) },
  { group: "Digits", keys: "0123456789".split("").map((digit) => ({ base: digit, label: digit })) },
];

const PICKER_KEYS = PICKER_GROUPS.flatMap(({ keys }) => keys);

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
  if (entry.mods === "ctrl-or-alt") {
    if (shift) return { error: "Shift goes only with Tab." };
    if (ctrl && alt) return { error: "Pick Ctrl or Alt, not both." };
    if (!ctrl && !alt) return { error: "A letter needs Ctrl or Alt." };
    return ctrl ? { key: `ctrl+${base}`, label: `Ctrl ${entry.label}` } : { key: `alt+${base}`, label: `Alt ${entry.label}` };
  }
  if (entry.mods === "ctrl-only") {
    if (!ctrl || alt || shift) return { error: "Backslash goes with Ctrl only." };
    return { key: "ctrl+\\", label: "Ctrl \\" };
  }
  if (ctrl || alt || (shift && entry.mods !== "shift-optional")) {
    return { error: entry.mods === "shift-optional" ? "Tab takes Shift only." : `${entry.label} takes no Ctrl, Alt or Shift.` };
  }
  if (shift) return { key: "shift+tab", label: "Shift Tab" };
  return { key: entry.base, label: entry.base === "backspace" ? "Bksp" : entry.label };
}

/** @param {string} key */
export function defaultLabel(key) {
  const [modifier, base] = key.length > 1 && key.includes("+") ? key.split(/\+(.+)/) : [null, key];
  return pickedKey({ ctrl: modifier === "ctrl", alt: modifier === "alt", shift: modifier === "shift", base }).label ?? key;
}

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
