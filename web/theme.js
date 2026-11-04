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

/**
 * @typedef {{ content: string, media: string, dataset: DOMStringMap }} MetaTag
 */

/**
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
