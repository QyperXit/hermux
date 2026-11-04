// Letters and digits only, lower-cased: what stays the same when Atomic
// renders, rewraps or indents a line.
/** @param {string} text */
export const matchKey = (text) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
