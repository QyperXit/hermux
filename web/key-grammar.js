// The key names a send may use, written once for the server (server/herdr.ts
// refuses any other) and the page (the key picker makes only these, and a saved
// bar holds only these). They are the names herdr 0.9.5 accepts in the families
// the app allows, probed on disposable panes. Canonical lower-case names
// only: herdr's aliases (Escape, return, bs, control+x, meta+x, any case) and
// keys outside these families are refused. herdr has no name for PgUp, PgDn,
// Home, End or Delete.

/** @type {[pattern: string, named: string][]} */
const KEY_FAMILIES = [
  ["(?:ctrl|alt)\\+[a-z]", "ctrl+ or alt+ with a letter"],
  ["ctrl\\+\\\\", "ctrl+\\"],
  ["shift\\+tab", "shift+tab"],
  ["backspace", "backspace"],
  ["f(?:[1-9]|1[0-2])", "f1-f12"],
  ...["up", "down", "left", "right", "esc", "tab", "enter"].map((name) => /** @type {[string, string]} */ ([name, name])),
  ["[0-9]", "a digit"],
];
const KEY_GRAMMAR = new RegExp(`^(?:${KEY_FAMILIES.map(([pattern]) => pattern).join("|")})$`);
const KEY_NAMES = KEY_FAMILIES.map(([, named]) => named);

export const KEY_HELP = `Use ${KEY_NAMES.slice(0, -1).join(", ")} or ${KEY_NAMES.at(-1)}.`;

/**
 * @param {unknown} key
 * @returns {key is string}
 */
export function isAllowedKey(key) {
  return typeof key === "string" && KEY_GRAMMAR.test(key);
}
