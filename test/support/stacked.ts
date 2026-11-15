export const ESC = "\x1b";
export const BOLD = `${ESC}[0m${ESC}[1m`;
export const CYAN = `${ESC}[0m${ESC}[38;2;0;255;255m`;
export const RESET = `${ESC}[0m`;

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

type Row = { title: string | null; fields: [string | null, string][] };

// What a reader of the page sees: each row's title and its lines, as plain text.
export function rowsOf(html: string): Row[] {
  return [...html.matchAll(/<section class="stacked-row">(.*?)<\/section>/g)].map(([, inner]) => {
    const title = inner.match(/<strong class="stacked-title">(.*?)<\/strong>/)?.[1];
    const fields = [...inner.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>|<p class="stacked-line">(.*?)<\/p>/g)].map(
      (field): [string | null, string] => [field[1] === undefined ? null : text(field[1]), text(field[2] ?? field[3])],
    );
    return { title: title === undefined ? null : text(title), fields };
  });
}
