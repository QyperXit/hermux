// The key grammar (web/key-grammar.js, the server's isAllowedKey in
// server/herdr.ts), checked directly against the independent lists in
// test/support/key-grammar.ts. The HTTP tests send a few keys of each family;
// this is where every key is checked. The picker is checked against the same
// lists in test/keys.test.ts.
import { expect, test } from "bun:test";
import { createHerdr, isAllowedKey } from "../server/herdr";
import { REFUSED_KEYS, REPRESENTATIVE_KEYS, VALID_KEYS } from "./support/key-grammar";

test("every key name of the approved families is allowed", () => {
  expect(VALID_KEYS).toHaveLength(84);
  for (const key of VALID_KEYS) expect([key, isAllowedKey(key)]).toEqual([key, true]);
});

test("aliases, other spellings, keys outside the families and malformed names are refused", () => {
  for (const key of REFUSED_KEYS) expect([key, isAllowedKey(key)]).toEqual([key, false]);
});

test("nothing outside the list is allowed: every modifier with every printable character, and f0 to f30", () => {
  const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index));
  const candidates = [
    ...printable,
    ...["ctrl", "alt", "shift", "meta", "super", "ctrl+alt", "ctrl+shift", "alt+shift"].flatMap((modifier) => printable.map((char) => `${modifier}+${char}`)),
    ...Array.from({ length: 31 }, (_, index) => `f${index}`),
    ...["up", "down", "left", "right", "esc", "tab", "enter", "backspace"].flatMap((name) => [name, name.toUpperCase(), `ctrl+${name}`, `alt+${name}`, `shift+${name}`]),
  ];
  for (const key of candidates) expect([key, isAllowedKey(key)]).toEqual([key, VALID_KEYS.includes(key)]);
});

test("only strings are keys", () => {
  for (const value of [undefined, null, 1, ["enter"], { key: "enter" }]) expect(isAllowedKey(value)).toBe(false);
});

test("the keys the HTTP routes are driven with cover each family and are all valid", () => {
  expect(REPRESENTATIVE_KEYS.every((key) => VALID_KEYS.includes(key))).toBe(true);
  for (const pattern of [/^ctrl\+[a-z]$/, /^alt\+[a-z]$/, /^ctrl\+\\$/, /^shift\+tab$/, /^backspace$/, /^f\d+$/, /^(up|down|left|right)$/, /^(esc|tab|enter)$/, /^\d$/]) {
    expect([String(pattern), REPRESENTATIVE_KEYS.some((key) => pattern.test(key))]).toEqual([String(pattern), true]);
  }
});

test("a refused key list is answered with the key and the families to use, before herdr runs", async () => {
  const herdr = createHerdr("/nonexistent/herdr");
  const help = "Use ctrl+ or alt+ with a letter, ctrl+\\, shift+tab, backspace, f1-f12, up, down, left, right, esc, tab, enter or a digit.";
  await expect(herdr.sendKeys("w9:pD", ["enter", "pageup"], "pi")).rejects.toMatchObject({ code: "key_not_allowed", message: `Key not allowed: "pageup". ${help}` });
  await expect(herdr.sendKeys("w9:pD", [], "shell")).rejects.toMatchObject({ code: "key_not_allowed", message: `Key not allowed: (none). ${help}` });
});
