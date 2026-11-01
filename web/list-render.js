// The home and All screens are rebuilt only when their HTML changed, so a
// refresh that changes nothing keeps text selection, focus and sideways
// scroll. Home's freshness line ("Live · 14:05") is left out of the
// comparison: when only it changed, it alone is replaced. No DOM here, so the
// tests can import it.
export function listRenderer() {
  /** @type {{ screen: string, html: string, freshness: string } | null} */
  let last = null;
  return {
    // `screen` is the screen to draw, `shown` the one on the page now (another
    // screen may have replaced the list since). Answers "rebuild",
    // "freshness" (replace only the freshness line) or "none".
    /**
     * @param {{ screen: string, shown: string | undefined, html: string, freshness?: string }} drawing
     * @returns {"rebuild" | "freshness" | "none"}
     */
    next({ screen, shown, html, freshness = "" }) {
      const previous = last;
      const same = previous !== null && previous.screen === screen && shown === screen && previous.html === html;
      const change = !same ? "rebuild" : previous.freshness !== freshness ? "freshness" : "none";
      last = { screen, html, freshness };
      return change;
    },
  };
}
