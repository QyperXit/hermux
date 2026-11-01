// A small stand-in for the page's DOM, enough for the key bar (web/key-bar.js)
// to draw into and be used through: markup set with innerHTML or
// insertAdjacentHTML is parsed into elements, so markup that escaped its
// escaping shows up as elements or attributes that shouldn't be there.
// Selectors: tags, #id, .class, [attr], [attr="value"], :disabled and :not()
// of those, descendants, and lists. Events bubble. Focus goes only to an
// attached element that isn't disabled or inside a hidden one. No layout.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return ENTITIES[name] ?? whole;
  });

export class FakeText {
  parent: FakeElement | null = null;
  constructor(public text: string) {}
}

export type FakeNode = FakeElement | FakeText;

export type FakeEventInit = { button?: number; detail?: number; pointerId?: number };

export class FakeEvent {
  target: FakeElement | null = null;
  currentTarget: FakeElement | null = null;
  defaultPrevented = false;
  button: number;
  detail: number;
  pointerId: number;
  constructor(
    public type: string,
    { button = 0, detail = 1, pointerId = 1 }: FakeEventInit = {},
  ) {
    this.button = button;
    this.detail = detail;
    this.pointerId = pointerId;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
}

type Listener = (event: FakeEvent) => void;

// The document an element tree belongs to: its root, and which element has focus.
export class FakeDocument {
  activeElement: FakeElement | null = null;
  root: FakeElement;
  constructor(rootTag = "main") {
    this.root = new FakeElement(rootTag, this);
  }
}

export class FakeElement {
  parent: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly style = { height: "" };
  scrollHeight = 46;
  pointerCaptures: number[] = [];
  private listeners = new Map<string, Listener[]>();
  private ownValue: string | undefined;
  private ownChecked: boolean | undefined;

  constructor(
    public localName: string,
    public ownerDocument: FakeDocument,
  ) {}

  get tagName() {
    return this.localName.toUpperCase();
  }

  get children() {
    return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  private reflect(name: string, on: boolean) {
    if (on) this.setAttribute(name, "");
    else this.removeAttribute(name);
  }

  get id() {
    return this.getAttribute("id") ?? "";
  }
  get hidden() {
    return this.hasAttribute("hidden");
  }
  set hidden(on: boolean) {
    this.reflect("hidden", on);
  }
  get disabled() {
    return this.hasAttribute("disabled");
  }
  set disabled(on: boolean) {
    this.reflect("disabled", on);
  }
  get placeholder() {
    return this.getAttribute("placeholder") ?? "";
  }
  set placeholder(text: string) {
    this.setAttribute("placeholder", text);
  }
  get checked() {
    return this.ownChecked ?? this.hasAttribute("checked");
  }
  set checked(on: boolean) {
    this.ownChecked = on;
  }
  get value(): string {
    if (this.ownValue !== undefined) return this.ownValue;
    if (this.localName === "textarea") return this.textContent;
    if (this.localName === "select") return this.querySelector("option")?.value ?? "";
    if (this.localName === "option") return this.getAttribute("value") ?? this.textContent;
    return this.getAttribute("value") ?? "";
  }
  set value(text: string) {
    this.ownValue = String(text);
  }

  get classList() {
    const read = () => (this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    const write = (classes: string[]) => this.setAttribute("class", [...new Set(classes)].join(" "));
    return {
      contains: (name: string) => read().includes(name),
      add: (...names: string[]) => write([...read(), ...names]),
      remove: (...names: string[]) => write(read().filter((name) => !names.includes(name))),
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !read().includes(name);
        write(on ? [...read(), name] : read().filter((other) => other !== name));
        return on;
      },
    };
  }

  get dataset(): Record<string, string | undefined> {
    const attribute = (key: string) => `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_, key) => (typeof key === "string" ? (this.getAttribute(attribute(key)) ?? undefined) : undefined),
      set: (_, key, value) => {
        if (typeof key === "string") this.setAttribute(attribute(key), String(value));
        return true;
      },
      deleteProperty: (_, key) => {
        if (typeof key === "string") this.removeAttribute(attribute(key));
        return true;
      },
    });
  }

  get textContent(): string {
    return this.childNodes.map((node) => (node instanceof FakeText ? node.text : node.textContent)).join("");
  }
  set textContent(text: string | null) {
    this.replaceChildren(...(text ? [new FakeText(text)] : []));
  }

  set innerHTML(html: string) {
    this.replaceChildren(...parse(html, this.ownerDocument));
  }

  insertAdjacentHTML(where: "afterbegin" | "beforeend", html: string) {
    const nodes = parse(html, this.ownerDocument);
    for (const node of nodes) node.parent = this;
    this.childNodes = where === "afterbegin" ? [...nodes, ...this.childNodes] : [...this.childNodes, ...nodes];
  }

  replaceChildren(...nodes: FakeNode[]) {
    for (const node of this.childNodes) node.parent = null;
    for (const node of nodes) node.parent = this;
    this.childNodes = nodes;
  }

  // Every element under this one, in document order.
  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  matches(selector: string) {
    return selectorList(selector).some((complex) => matchesComplex(this, complex));
  }
  querySelectorAll(selector: string) {
    return this.descendants().filter((element) => element.matches(selector));
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector: string) {
    for (let element: FakeElement | null = this; element; element = element.parent) if (element.matches(selector)) return element;
    return null;
  }

  get isConnected() {
    let element: FakeElement = this;
    while (element.parent) element = element.parent;
    return element === this.ownerDocument.root;
  }

  // Shown, as far as the markup says: neither it nor any element around it is hidden.
  get shown() {
    for (let element: FakeElement | null = this; element; element = element.parent) if (element.hidden) return false;
    return this.isConnected;
  }

  focus() {
    if (this.shown && !this.disabled) this.ownerDocument.activeElement = this;
  }

  setPointerCapture(pointerId: number) {
    this.pointerCaptures.push(pointerId);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((other) => other !== listener));
  }

  // Dispatches the event here and then on each element around this one.
  dispatchEvent(event: FakeEvent) {
    event.target = this;
    for (let element: FakeElement | null = this; element; element = element.parent) {
      event.currentTarget = element;
      for (const listener of element.listeners.get(event.type) ?? []) listener(event);
    }
    return !event.defaultPrevented;
  }

  dispatch(type: string, init?: FakeEventInit) {
    const event = new FakeEvent(type, init);
    this.dispatchEvent(event);
    return event;
  }
}

// Markup to nodes, the way a browser reads it in a tag's body: a stray end tag
// closes the elements it ends, a void element has no end tag, and raw text
// elements (script, textarea, …) hold text up to their end tag.
function parse(html: string, doc: FakeDocument): FakeNode[] {
  const top = new FakeElement("#fragment", doc);
  const open: FakeElement[] = [top];
  const current = () => open[open.length - 1];
  const append = (node: FakeNode) => {
    node.parent = current();
    current().childNodes.push(node);
  };
  let at = 0;
  while (at < html.length) {
    const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(at));
    if (!tag) {
      const next = html.indexOf("<", at + 1);
      const end = next < 0 ? html.length : next;
      append(new FakeText(decode(html.slice(at, end))));
      at = end;
      continue;
    }
    at += tag[0].length;
    const [, closing, rawName, rest] = tag;
    const name = rawName.toLowerCase();
    if (closing) {
      const index = open.map((element) => element.localName).lastIndexOf(name);
      if (index > 0) open.length = index;
      continue;
    }
    const element = new FakeElement(name, doc);
    for (const [, attribute, double, single, bare] of rest.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      if (!element.attributes.has(attribute.toLowerCase())) element.setAttribute(attribute.toLowerCase(), decode(double ?? single ?? bare ?? ""));
    }
    append(element);
    if (RAW_TEXT.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, at);
      const text = html.slice(at, end < 0 ? html.length : end);
      if (text) element.childNodes.push(Object.assign(new FakeText(name === "textarea" || name === "title" ? decode(text) : text), { parent: element }));
      at = end < 0 ? html.length : html.indexOf(">", end) + 1;
      continue;
    }
    if (!VOID.has(name) && !rest.trimEnd().endsWith("/")) open.push(element);
  }
  return top.childNodes;
}

type Compound = { tag?: string; id?: string; classes: string[]; attributes: { name: string; value?: string }[]; disabled?: boolean; not: Compound[] };

// "a b, c" to [[a, b], [c]]: commas and spaces outside brackets, quotes and parentheses.
function split(selector: string, separator: string) {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let part = "";
  for (const char of selector) {
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;
    else if (depth === 0 && (separator === " " ? /\s/.test(char) : char === separator)) {
      if (part.trim()) parts.push(part.trim());
      part = "";
      continue;
    }
    part += char;
  }
  if (part.trim()) parts.push(part.trim());
  return parts;
}

const selectorList = (selector: string) => split(selector, ",").map((complex) => split(complex, " ").map(compound));

function compound(text: string): Compound {
  const parsed: Compound = { classes: [], attributes: [], not: [] };
  const pattern = /^(?:([a-z][a-z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:disabled|:not\(((?:[^()]|\([^()]*\))*)\))/i;
  let rest = text;
  while (rest) {
    const token = pattern.exec(rest);
    if (!token) throw new Error(`The fake DOM can't read the selector ${JSON.stringify(text)}.`);
    const [whole, tag, id, className, attribute, value, inner] = token;
    if (tag) parsed.tag = tag.toLowerCase();
    else if (id) parsed.id = id;
    else if (className) parsed.classes.push(className);
    else if (attribute) parsed.attributes.push({ name: attribute, value });
    else if (inner !== undefined) parsed.not.push(compound(inner));
    else parsed.disabled = true;
    rest = rest.slice(whole.length);
  }
  return parsed;
}

function matchesCompound(element: FakeElement, { tag, id, classes, attributes, disabled, not }: Compound): boolean {
  if (tag && element.localName !== tag) return false;
  if (id && element.id !== id) return false;
  if (!classes.every((name) => element.classList.contains(name))) return false;
  if (!attributes.every(({ name, value }) => (value === undefined ? element.hasAttribute(name) : element.getAttribute(name) === value))) return false;
  if (disabled && !element.disabled) return false;
  return not.every((inner) => !matchesCompound(element, inner));
}

function matchesComplex(element: FakeElement, parts: Compound[]): boolean {
  if (!matchesCompound(element, parts[parts.length - 1])) return false;
  let ancestor = element.parent;
  for (let index = parts.length - 2; index >= 0; index--) {
    while (ancestor && !matchesCompound(ancestor, parts[index])) ancestor = ancestor.parent;
    if (!ancestor) return false;
    ancestor = ancestor.parent;
  }
  return true;
}

// A page with `html` drawn in its root element (`<main id="app" class="app">`).
export function fakePage(html: string) {
  const doc = new FakeDocument();
  doc.root.setAttribute("id", "app");
  doc.root.setAttribute("class", "app");
  doc.root.innerHTML = html;
  return { doc, root: doc.root };
}

// The fake stands in for the page's element where the key bar takes one. It
// has every member the key bar uses, not all of HTMLElement's, so this is the
// one place it is handed over as one.
export const asPageElement = (element: FakeElement) => element as unknown as HTMLElement;
