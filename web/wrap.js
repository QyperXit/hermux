// Text matching shared by the server and the page. No DOM here. How an
// Atomic screen is read is web/screen.js.

// Letters and digits only, lower-cased: what stays the same when Atomic
// renders, rewraps or indents a line. The server's Join matching and the
// page's dedupe of earlier messages compare lines by this key, so both use it.
/** @param {string} text */
export const matchKey = (text) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// Control characters other than tab and newline; they never reach the page.
export const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
