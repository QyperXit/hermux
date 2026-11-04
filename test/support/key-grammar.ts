// Every key name herdr 0.9.5 accepts in the approved families (probed on
// disposable panes).
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

export const VALID_KEYS: readonly string[] = [
  ...LETTERS.map((letter) => `ctrl+${letter}`),
  ...LETTERS.map((letter) => `alt+${letter}`),
  "ctrl+\\",
  "shift+tab",
  "backspace",
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
  "up", "down", "left", "right",
  "esc", "tab", "enter",
  ..."0123456789".split(""),
];

// Key names that must be refused: names herdr 0.9.5 has no key for, its
// aliases and other spellings, keys it accepts outside the approved families,
// and malformed or hostile strings.
export const REFUSED_KEYS: readonly string[] = [
  "pageup", "pagedown", "pgup", "home", "end", "delete", "insert",
  "escape", "ESC", "Enter", "return", "bs", "Ctrl+x", "CTRL+X", "ctrl+X", "control+x", "meta+x", "alt+X", "C-x", "Shift+Tab", "backtab",
  "ctrl+alt+x", "ctrl+shift+x", "ctrl+1", "alt+1", "ctrl+[", "ctrl+space", "shift+enter", "ctrl+up", "f0", "f13", "f24", "space", "a", "A", "/", "\\",
  "ctrl+", "alt+", "ctrl+ab", "ctrl+\\\\", "", " enter", "enter ", "enter\n", "enter; rm -rf ~", "rm -rf", "$(id)", "--help", "-x", "10",
];

// The keys each HTTP send route is driven with: one of each family. Every
// key of VALID_KEYS is checked against the server's grammar directly in
// test/key-grammar.test.ts, so the routes need only show that a key passes
// through to herdr unchanged.
export const REPRESENTATIVE_KEYS: readonly string[] = ["ctrl+c", "alt+x", "ctrl+\\", "shift+tab", "backspace", "f1", "f12", "up", "esc", "7", "enter"];
