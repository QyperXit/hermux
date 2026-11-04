// The home and All screens are rebuilt only when their HTML changed, so a
// refresh that changes nothing keeps text selection, focus and sideways
// scroll.
export function listRenderer() {
  /** @type {{ screen: string, html: string, freshness: string } | null} */
  let last = null;
  return {
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
