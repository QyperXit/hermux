/**
 * @typedef {import("./screen.js").Run} Run
 * @typedef {import("./screen.js").Line} Line
 */

/**
 * @param {Line} line
 * @param {number} start
 * @param {number} [end]
 * @returns {Line}
 */
export function sliceLine(line, start, end = line.text.length) {
  /** @type {Run[]} */
  const runs = [];
  let offset = 0;
  for (const run of line.runs) {
    const from = Math.max(start - offset, 0);
    const to = Math.min(end - offset, run.text.length);
    if (to > from) runs.push({ text: run.text.slice(from, to), cls: run.cls });
    offset += run.text.length;
  }
  return { text: line.text.slice(start, end), runs, band: line.band };
}

/** @param {Line} line */
export const trimEnd = (line) => sliceLine(line, 0, line.text.trimEnd().length);
/** @param {Line} line */
export const leading = (line) => line.text.length - line.text.trimStart().length;
/** @param {Line} line */
export const trimStart = (line) => sliceLine(line, leading(line));
/** @param {Line} line */
export const isBlank = (line) => !line.text.trim();
