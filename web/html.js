/** @type {Record<string, string>} */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {unknown} value */
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);

/**
 * @param {string} id
 * @param {string} [className]
 */
export const icon = (id, className = "") => `<svg class="${className ? `icon ${className}` : "icon"}" aria-hidden="true"><use href="#${id}"/></svg>`;

export const MAX_INDENT_CH = 12;
