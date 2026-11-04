import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryStorage } from "../web/home.js";
import { THEME_KEY, applyTheme, nextTheme, storedTheme, themeLabel } from "../web/theme.js";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const head = html.slice(0, html.indexOf("</head>"));

// The page's own <meta> tags, as a minimal document for applyTheme and the head script.
function fakeDocument() {
  const metas = [...head.matchAll(/<meta ([^>]*)>/g)].map(([, attributes]) => {
    const attribute = (name: string) => attributes.match(new RegExp(`(?:^| )${name}="([^"]*)"`))?.[1] ?? "";
    const dataset = Object.fromEntries([...attributes.matchAll(/data-([a-z]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    return { name: attribute("name"), media: attribute("media"), content: attribute("content"), dataset };
  }).filter(({ name }) => name === "theme-color" || name === "color-scheme");
  const named = (selector: string) => metas.filter((meta) => meta.name === selector.match(/name="([^"]+)"/)?.[1]);
  return {
    documentElement: { dataset: {} as Record<string, string> },
    querySelectorAll: named,
    querySelector: (selector: string) => named(selector)[0] ?? null,
    state() {
      return { theme: this.documentElement.dataset.theme, metas: metas.map(({ name, media, content }) => ({ name, media, content })) };
    },
  };
}

const store = (theme: string | null) => {
  const storage = memoryStorage();
  if (theme !== null) storage.setItem(THEME_KEY, theme);
  return storage;
};

test("the control cycles System, Light, Dark and back to System, and says what a tap does", () => {
  expect((["system", "light", "dark"] as const).map(nextTheme)).toEqual(["light", "dark", "system"]);
  expect(themeLabel("system")).toBe("Theme: System. Switch to Light");
  expect(themeLabel("light")).toBe("Theme: Light. Switch to Dark");
  expect(themeLabel("dark")).toBe("Theme: Dark. Switch to System");
});

test("the choice is stored under agents.theme; nothing or anything else stored is System", () => {
  expect(THEME_KEY).toBe("agents.theme");
  expect([null, "system", "light", "dark", "Dark", "sepia", ""].map((value) => storedTheme(store(value)))).toEqual(["system", "system", "light", "dark", "system", "system", "system"]);
});

test("Light and Dark set data-theme, color-scheme and both theme-color metas; System leaves each meta to its media query", () => {
  const dark = fakeDocument();
  applyTheme(dark, "dark");
  expect(dark.state()).toEqual({
    theme: "dark",
    metas: [
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#1c1c1a" },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#1c1c1a" },
      { name: "color-scheme", media: "", content: "dark" },
    ],
  });
  const light = fakeDocument();
  applyTheme(light, "light");
  expect(light.state().metas.map((meta) => meta.content)).toEqual(["#ebe8e2", "#ebe8e2", "light"]);
  applyTheme(light, "system");
  expect(light.state()).toEqual(fakeDocument().state());
  expect(fakeDocument().state().metas.map((meta) => meta.content)).toEqual(["#ebe8e2", "#1c1c1a", "light dark"]);
});

test("index.html applies the stored choice in <head>, after the metas and before the stylesheet and app script", () => {
  const inline = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  expect(inline).toHaveLength(1);
  const [tag, code] = inline[0];
  const at = head.indexOf(tag);
  expect(at).toBeGreaterThan(head.lastIndexOf("<meta "));
  expect(at).toBeLessThan(head.indexOf('<link rel="stylesheet"'));
  expect(at).toBeLessThan(head.indexOf('<script type="module"'));
  for (const value of [null, "system", "light", "dark", "sepia"]) {
    const page = fakeDocument();
    new Function("document", "localStorage", code)(page, store(value));
    const expected = fakeDocument();
    applyTheme(expected, storedTheme(store(value)));
    expect([value, page.state()]).toEqual([value, expected.state()]);
  }
});
