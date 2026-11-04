/** @typedef {import("./session.js").Route} Route */

/** @param {string} paneId */
export function terminalHref(paneId) {
  return `#/agent/${encodeURIComponent(paneId)}`;
}

/**
 * @param {string} hash
 * @returns {Route}
 */
export function parseRoute(hash) {
  if (hash === "#/all") return { name: "all" };
  const match = hash.match(/^#\/agent\/(.+)$/);
  return match ? { name: "agent", paneId: decodeURIComponent(match[1]) } : { name: "home" };
}
