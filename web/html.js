// HTML pieces the page's renderers share. No DOM here, so the tests can import it.

/** @type {Record<string, string>} */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {unknown} value */
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

/**
 * @param {string} id
 * @param {string} [extra] more classes, with a leading space
 */
export const icon = (id, extra = "") => `<svg class="icon${extra}" aria-hidden="true"><use href="#${id}"/></svg>`;

// The widest leading indent a Reader line or earlier message keeps, in ch.
export const MAX_INDENT_CH = 12;
