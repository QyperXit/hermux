// Draws the Live screen into its element, changing only what changed (D29).
// The Reader gives one HTML string per element. An element whose HTML is the
// same as last time stays as it is; a box-drawn block (a workflow graph, panel
// or table) whose HTML changed keeps its element and gets only new contents,
// so its sideways scroll position, and a scroll in progress, survive the
// refresh. A block is matched by its identity: its kind (its classes) and its
// order among the blocks of that kind. Anything else that changed is new.
// Matches keep their order, so no kept element is ever moved, which would lose
// its scroll position.

/** @typedef {{ parts: string[], elements: Element[] }} Drawn */

/** @type {WeakMap<HTMLElement, Drawn>} */
const drawn = new WeakMap();

// Each element's kind and order among the elements of that kind, e.g. "block#0".
/** @param {Element[]} elements */
function identities(elements) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return elements.map((element) => {
    const kind = element.getAttribute("class") ?? element.localName;
    const order = seen.get(kind) ?? 0;
    seen.set(kind, order + 1);
    return `${kind}#${order}`;
  });
}

/**
 * @param {HTMLElement} live
 * @param {string[]} parts one HTML string per element, in order
 */
export function drawLive(live, parts) {
  const before = drawn.get(live);
  const scratch = live.ownerDocument.createElement("div");
  scratch.innerHTML = parts.join("");
  const fresh = [...scratch.children];
  // Anything else drawn here since (a "Reading output…" line, an error) is replaced whole.
  const intact = before && before.elements.length === live.children.length && before.elements.every((element, index) => live.children[index] === element);
  if (!before || !intact || fresh.length !== parts.length) {
    live.replaceChildren(...fresh);
    drawn.set(live, { parts: fresh.length === parts.length ? parts : [], elements: fresh });
    return;
  }
  const oldIds = identities(before.elements);
  const newIds = identities(fresh);
  /** @type {Element[]} */
  const elements = [];
  let next = 0;
  fresh.forEach((element, index) => {
    const same = before.parts.indexOf(parts[index], next);
    if (same >= 0) {
      elements.push(before.elements[same]);
      next = same + 1;
      return;
    }
    const block = element.classList.contains("block") ? oldIds.indexOf(newIds[index], next) : -1;
    if (block >= 0) {
      const kept = before.elements[block];
      kept.replaceChildren(...element.childNodes);
      elements.push(kept);
      next = block + 1;
      return;
    }
    elements.push(element);
  });
  const keep = new Set(elements);
  for (const element of before.elements) if (!keep.has(element)) element.remove();
  elements.forEach((element, index) => {
    if (live.children[index] !== element) live.insertBefore(element, live.children[index] ?? null);
  });
  drawn.set(live, { parts, elements });
}
