import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../web/app.css", import.meta.url), "utf8");

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|\b(?:white|black|red|orange|yellow|green|blue|purple|pink|brown|gray|grey|silver)\b/i;

// Every innermost rule of the stylesheet, comments removed: its selector and its declarations.
function rulesOf(text: string) {
  const plain = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    declarations: body
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => ({ property: declaration.slice(0, declaration.indexOf(":")).trim(), value: declaration.slice(declaration.indexOf(":") + 1).trim() })),
  }));
}

const colourLiteralsOutsideTokens = (text: string) =>
  rulesOf(text)
    .filter((rule) => !rule.selector.startsWith(":root"))
    .flatMap((rule) => rule.declarations.filter((declaration) => COLOUR_LITERAL.test(declaration.value)).map((declaration) => `${rule.selector} { ${declaration.property}: ${declaration.value} }`));

test("app.css names no colour outside the :root tokens: every rule takes its colours from a token", () => {
  expect(colourLiteralsOutsideTokens(css)).toEqual([]);
  expect(rulesOf(css).filter((rule) => rule.selector.startsWith(":root")).flatMap((rule) => rule.declarations).some((declaration) => COLOUR_LITERAL.test(declaration.value))).toBe(true);
  expect(colourLiteralsOutsideTokens(".row {\n  color: var(--ink);\n}\n.x { border-color: #fff }\n.y { box-shadow: 0 1px 3px rgb(226 86 15 / 0.45); }")).toEqual([
    ".x { border-color: #fff }",
    ".y { box-shadow: 0 1px 3px rgb(226 86 15 / 0.45) }",
  ]);
});

test("a question dialog's options use ink tokens only, never the orange signal", () => {
  const optionRules = rulesOf(css).filter((rule) => /\.opt\b|\.opt-/.test(rule.selector));
  expect(optionRules.length).toBeGreaterThan(0);
  expect(optionRules.flatMap((rule) => rule.declarations.filter((declaration) => declaration.value.includes("--signal")).map((declaration) => `${rule.selector} { ${declaration.property}: ${declaration.value} }`))).toEqual([]);
});
