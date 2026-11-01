// The user's theme choice. System follows the phone's light/dark setting;
// Light and Dark override it. The choice is stored in localStorage, and
// index.html applies a stored Light or Dark in <head> before the first paint.
// No DOM here beyond the document passed in, so the tests can import it.

/** @typedef {"system" | "light" | "dark"} Theme */

export const THEME_KEY = "agents.theme";
/** @type {readonly Theme[]} */
const THEMES = ["system", "light", "dark"];
/** @type {Record<Theme, string>} */
const NAMES = { system: "System", light: "Light", dark: "Dark" };

/**
 * @param {string | null} value
 * @returns {value is Theme}
 */
const isTheme = (value) => THEMES.some((theme) => theme === value);

/** @param {{ getItem(key: string): string | null }} storage */
export const storedTheme = (storage) => {
  const theme = storage.getItem(THEME_KEY);
  return isTheme(theme) ? theme : "system";
};

/** @param {Theme} theme */
export const nextTheme = (theme) => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];

/** @param {Theme} theme */
export const themeLabel = (theme) => `Theme: ${NAMES[theme]}. Switch to ${NAMES[nextTheme(theme)]}`;

// Each theme-color meta carries both colours (data-light, data-dark). Under
// System each keeps the colour for its own media query, so the browser follows
// the phone as it changes; Light or Dark gives both metas that theme's colour.
/**
 * One <meta> tag of the page's head.
 * @typedef {{ content: string, media: string, dataset: DOMStringMap }} MetaTag
 */

/**
 * The parts of `document` that applyTheme reads and writes; the page gives it
 * its <meta> tags as MetaTags.
 * @typedef {object} ThemeDocument
 * @property {{ dataset: DOMStringMap }} documentElement
 * @property {(selector: string) => Iterable<MetaTag>} querySelectorAll
 * @property {(selector: string) => { content: string } | null} querySelector
 */

/**
 * @param {ThemeDocument} doc
 * @param {Theme} theme
 */
export function applyTheme(doc, theme) {
  if (theme === "system") delete doc.documentElement.dataset.theme;
  else doc.documentElement.dataset.theme = theme;
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    meta.content = meta.dataset[theme === "system" ? (meta.media.includes("dark") ? "dark" : "light") : theme] ?? "";
  }
  const scheme = doc.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.content = theme === "system" ? "light dark" : theme;
}
