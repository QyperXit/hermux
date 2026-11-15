import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "../../web/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule of app.css, read because the fake DOM has no layout. The rules inside an @media block are among them. */
export const cssRules = [...css.matchAll(/(?:^|\n)([^{}\n@][^{}]*)\{([^}]*)\}/g)].map(([, selectors, body]) => ({
  selectors: selectors.split(",").map((each) => each.trim()),
  declarations: Object.fromEntries(
    body
      .split(";")
      .filter((line) => line.includes(":"))
      .map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]),
  ) as Record<string, string>,
}));

/** What the rules naming exactly `selector` declare, a later rule's value over an earlier one's. */
export function declarations(selector: string): Record<string, string> {
  const named = cssRules.filter((rule) => rule.selectors.includes(selector));
  if (!named.length) throw new Error(`No rule for ${selector}`);
  return Object.assign({}, ...named.map((rule) => rule.declarations));
}
