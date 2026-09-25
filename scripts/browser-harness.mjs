// A browser, reduced to what this tracker's own client actually touches.
//
// DNC-007 and DNC-008 are both defects of the browser's *state across a sign-in*,
// not of any one function: the previous account's rendered rows survived an
// account change, and two controls that one code path hid were never un-hidden by
// the path that took over. Neither is visible to a test that calls a helper in
// isolation, and neither is visible to a test that only speaks to the API — the
// worker was correct in both cases. They are only visible by running the served
// page: parse the real markup, execute the real script inside it, drive the real
// forms and buttons, and then look at what is on screen.
//
// So that is what this does. It implements the DOM surface worker/client.js uses
// and nothing else, and routes fetch() straight into the Worker with a cookie jar
// in between, so a sign-in here is a real sign-in against the real session code.
// Deliberately not a general-purpose DOM: every shortcut below is safe only
// because the client is known, and it is checked against the client on every run
// by the assertions in smoke-test.mjs.

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);
// Attributes the client reads or writes as properties. Kept as attributes so that
// [attr] selectors, getAttribute() and the property agree with one another —
// `dialog[open]` and `dialog.open` are the same fact in a real browser too.
const BOOLEAN_PROPERTIES = ["hidden", "open", "disabled", "required", "checked", "readOnly", "multiple"];
const STRING_PROPERTIES = ["title", "placeholder", "href", "src", "type", "name"];
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  bull: "•", times: "×", mdash: "—", ndash: "–", hellip: "…",
};

function decodeEntities(text) {
  return text.replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, name) => {
    if (name[0] === "#") {
      const hex = name[1] === "x" || name[1] === "X";
      const code = hex ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole;
  });
}

function escapeText(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

const attributeName = (property) => "data-" + property.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const propertyName = (attribute) => attribute.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// --- Selectors ---------------------------------------------------------------
// Comma-separated lists of compound selectors: tag, #id, .class and [attr] or
// [attr="value"]. That is the whole vocabulary worker/client.js uses — there is
// not one descendant or child combinator in it — so anything richer would be
// untested scaffolding.
function matchesCompound(element, selector) {
  const tokens = selector.match(/\[[^\]]*\]|[.#]?[\w-]+|\*/g);
  if (!tokens) return false;
  return tokens.every((token) => {
    if (token === "*") return true;
    if (token[0] === "#") return element.getAttribute("id") === token.slice(1);
    if (token[0] === ".") return element.classList.contains(token.slice(1));
    if (token[0] === "[") {
      const parsed = token.slice(1, -1).match(/^([^=\]]+?)\s*(?:=\s*"?([^"\]]*)"?)?$/);
      if (!parsed) return false;
      const [, name, value] = parsed;
      if (!element.hasAttribute(name)) return false;
      return value === undefined || element.getAttribute(name) === value;
    }
    return element.localName === token.toLowerCase();
  });
}

function matchesSelector(element, selector) {
  if (element.nodeType !== 1) return false;
  return String(selector).split(",").map((part) => part.trim()).filter(Boolean)
    .some((part) => matchesCompound(element, part));
}

// --- Nodes -------------------------------------------------------------------

class TextNode {
  constructor(text, ownerDocument) {
    this.nodeType = 3;
    this.nodeValue = String(text);
    this.parentElement = null;
    this.ownerDocument = ownerDocument;
  }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  replaceWith(...nodes) {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.childNodes.indexOf(this);
    const incoming = nodes.flatMap((node) => (node.nodeType === 11 ? node.childNodes.slice() : [node]));
    incoming.forEach((node) => node.remove?.());
    parent.childNodes.splice(index, 1, ...incoming);
    incoming.forEach((node) => { node.parentElement = parent; });
    this.parentElement = null;
    parent.ownerDocument.touch();
  }
  closest() { return null; }
}

class DocumentFragment {
  constructor(ownerDocument) {
    this.nodeType = 11;
    this.childNodes = [];
    this.ownerDocument = ownerDocument;
  }
  appendChild(node) {
    node.remove?.();
    this.childNodes.push(node);
    node.parentElement = null;
    return node;
  }
}

class Element {
  constructor(tagName, ownerDocument) {
    this.nodeType = 1;
    this.localName = String(tagName).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributeMap = new Map();
    this.childNodes = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.style = createStyle();
    this.selectedIndex = 0;
    this.ownValue = null;
    this.files = [];
    this.dataset = createDataset(this);
  }

  // --- attributes ---
  hasAttribute(name) { return this.attributeMap.has(String(name).toLowerCase()); }
  getAttribute(name) {
    const value = this.attributeMap.get(String(name).toLowerCase());
    return value === undefined ? null : value;
  }
  setAttribute(name, value) {
    this.attributeMap.set(String(name).toLowerCase(), String(value));
    this.ownerDocument.touch();
  }
  removeAttribute(name) {
    this.attributeMap.delete(String(name).toLowerCase());
    this.ownerDocument.touch();
  }
  get attributes() { return this.attributeMap; }

  get id() { return this.getAttribute("id") || ""; }
  get className() { return this.getAttribute("class") || ""; }
  set className(value) { this.setAttribute("class", value); }
  get classList() {
    const element = this;
    const read = () => (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    const write = (list) => element.setAttribute("class", list.join(" "));
    return {
      contains: (name) => read().includes(name),
      add: (...names) => write([...new Set([...read(), ...names])]),
      remove: (...names) => write(read().filter((name) => !names.includes(name))),
      toggle: (name, force) => {
        const present = read().includes(name);
        const next = force === undefined ? !present : Boolean(force);
        if (next === present) return next;
        write(next ? [...read(), name] : read().filter((entry) => entry !== name));
        return next;
      },
    };
  }

  // --- tree ---
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) return node;
    this.childNodes.splice(index, 1);
    node.parentElement = null;
    this.ownerDocument.touch();
    return node;
  }
  appendChild(node) {
    if (node.nodeType === 11) {
      node.childNodes.slice().forEach((child) => this.appendChild(child));
      node.childNodes.length = 0;
      return node;
    }
    node.remove?.();
    this.childNodes.push(node);
    node.parentElement = this;
    this.ownerDocument.touch();
    return node;
  }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  replaceWith(...nodes) { TextNode.prototype.replaceWith.call(this, ...nodes); }

  descendants() {
    const found = [];
    const walk = (node) => node.childNodes.forEach((child) => {
      found.push(child);
      if (child.nodeType === 1) walk(child);
    });
    walk(this);
    return found;
  }
  querySelectorAll(selector) {
    return this.descendants().filter((node) => matchesSelector(node, selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    let node = this;
    while (node && node.nodeType === 1) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  matches(selector) { return matchesSelector(this, selector); }

  // --- content ---
  get textContent() {
    return this.descendants().filter((node) => node.nodeType === 3).map((node) => node.nodeValue).join("");
  }
  set textContent(value) {
    this.childNodes.forEach((node) => { node.parentElement = null; });
    this.childNodes = value === "" || value == null ? [] : [new TextNode(value, this.ownerDocument)];
    this.childNodes.forEach((node) => { node.parentElement = this; });
    this.ownerDocument.touch();
  }
  get innerHTML() { return this.childNodes.map((node) => serialize(node)).join(""); }
  set innerHTML(html) {
    this.childNodes.forEach((node) => { node.parentElement = null; });
    this.childNodes = parseNodes(String(html), this.ownerDocument);
    this.childNodes.forEach((node) => { node.parentElement = this; });
    this.ownerDocument.touch();
  }

  // --- form controls ---
  get options() { return this.querySelectorAll("option"); }
  get value() {
    if (this.localName === "select") {
      const option = this.options[this.selectedIndex];
      return option ? optionValue(option) : "";
    }
    if (this.ownValue !== null) return this.ownValue;
    if (this.localName === "textarea") return this.textContent;
    return this.getAttribute("value") || "";
  }
  set value(next) {
    if (this.localName === "select") {
      const index = this.options.findIndex((option) => optionValue(option) === String(next));
      this.selectedIndex = index;
      return;
    }
    this.ownValue = next == null ? "" : String(next);
  }
  reset() {
    this.querySelectorAll("input,select,textarea").forEach((field) => {
      if (field.localName === "select") {
        const marked = field.options.findIndex((option) => option.hasAttribute("selected"));
        field.selectedIndex = marked < 0 ? 0 : marked;
      } else if (field.localName === "textarea") {
        field.ownValue = null;
      } else {
        field.ownValue = null;
        field.checked = field.hasAttribute("checked");
      }
    });
  }

  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  showModal() { this.open = true; }
  show() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
  scrollIntoView() {}

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }
}

for (const property of BOOLEAN_PROPERTIES) {
  const attribute = property.toLowerCase();
  Object.defineProperty(Element.prototype, property, {
    get() { return this.hasAttribute(attribute); },
    set(value) { if (value) this.setAttribute(attribute, ""); else this.removeAttribute(attribute); },
  });
}
for (const property of STRING_PROPERTIES) {
  Object.defineProperty(Element.prototype, property, {
    get() { return this.getAttribute(property) || ""; },
    set(value) { this.setAttribute(property, value); },
  });
}

const optionValue = (option) => (option.hasAttribute("value") ? option.getAttribute("value") : option.textContent);

function createStyle() {
  const style = { cssText: "", removeProperty() {}, setProperty(name, value) { style[name] = value; } };
  return style;
}

function createDataset(element) {
  return new Proxy({}, {
    get(_, key) {
      if (typeof key !== "string") return undefined;
      const value = element.getAttribute(attributeName(key));
      return value === null ? undefined : value;
    },
    set(_, key, value) { element.setAttribute(attributeName(key), value); return true; },
    has(_, key) { return typeof key === "string" && element.hasAttribute(attributeName(key)); },
    deleteProperty(_, key) { element.removeAttribute(attributeName(key)); return true; },
    ownKeys() {
      return [...element.attributeMap.keys()].filter((name) => name.startsWith("data-")).map(propertyName);
    },
    getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
  });
}

function serialize(node) {
  if (node.nodeType === 3) return escapeText(node.nodeValue);
  const attributes = [...node.attributeMap.entries()]
    .map(([name, value]) => (value === "" ? ` ${name}` : ` ${name}="${escapeText(value).replaceAll('"', "&quot;")}"`))
    .join("");
  if (VOID_ELEMENTS.has(node.localName)) return `<${node.localName}${attributes}>`;
  return `<${node.localName}${attributes}>${node.childNodes.map(serialize).join("")}</${node.localName}>`;
}

// --- Parsing -----------------------------------------------------------------

const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<(\/?)([a-zA-Z][-a-zA-Z0-9]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]*))?)*)\s*(\/?)>/gi;
const ATTRIBUTE = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseNodes(html, ownerDocument) {
  const root = new Element("#root", ownerDocument);
  const stack = [root];
  let cursor = 0;
  TAG.lastIndex = 0;
  let match;
  const addText = (text) => {
    if (!text) return;
    stack.at(-1).appendChild(new TextNode(decodeEntities(text), ownerDocument));
  };
  while ((match = TAG.exec(html)) !== null) {
    addText(html.slice(cursor, match.index));
    cursor = TAG.lastIndex;
    const [whole, closing, name] = match;
    if (!name) continue; // comment, CDATA or doctype
    const tag = name.toLowerCase();
    if (closing) {
      const index = stack.findLastIndex((element) => element.localName === tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const element = new Element(tag, ownerDocument);
    const attributes = match[3] || "";
    ATTRIBUTE.lastIndex = 0;
    let attribute;
    while ((attribute = ATTRIBUTE.exec(attributes)) !== null) {
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      element.setAttribute(attribute[1], decodeEntities(value));
    }
    stack.at(-1).appendChild(element);
    if (!VOID_ELEMENTS.has(tag) && !match[4]) stack.push(element);
    void whole;
  }
  addText(html.slice(cursor));
  const children = root.childNodes.slice();
  children.forEach((node) => { node.parentElement = null; });
  return children;
}

// --- Document ----------------------------------------------------------------

class HarnessDocument {
  constructor() {
    this.nodeType = 9;
    this.version = 0;
    this.indexVersion = -1;
    this.index = new Map();
    this.listeners = new Map();
    this.activeElement = null;
    this.body = new Element("body", this);
    this.documentElement = new Element("html", this);
    this.ownerDocument = this;
  }
  touch() { this.version += 1; }
  ids() {
    if (this.indexVersion !== this.version) {
      this.index = new Map();
      for (const node of this.body.descendants()) {
        if (node.nodeType !== 1) continue;
        const id = node.getAttribute("id");
        if (id && !this.index.has(id)) this.index.set(id, node);
      }
      this.indexVersion = this.version;
    }
    return this.index;
  }
  getElementById(id) { return this.ids().get(String(id)) || null; }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  querySelector(selector) { return this.body.querySelector(selector); }
  createElement(tag) { return new Element(tag, this); }
  createTextNode(text) { return new TextNode(text, this); }
  createDocumentFragment() { return new DocumentFragment(this); }
  createTreeWalker(root) {
    const nodes = root.descendants().filter((node) => node.nodeType === 3);
    let position = -1;
    return { nextNode: () => (++position < nodes.length ? nodes[position] : null) };
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener() {}
}

// --- The browser --------------------------------------------------------------

// `cookie` seeds the jar, which is how a second browser can be opened as an
// already-signed-in account — the honest way to ask "what would this person see
// if they pressed refresh?", which is the whole of DNC-008's requirement.
export function createBrowser({ page, handler, origin = "https://tracker.example", cookie: initialCookie = "" }) {
  const scriptMatch = String(page).match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error("The served page carries no inline script to run.");
  const script = scriptMatch[1];
  const markup = String(page)
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<script>[\s\S]*?<\/script>/g, "");
  const bodyMatch = markup.match(/<body>([\s\S]*)<\/body>/);

  const document = new HarnessDocument();
  parseNodes(bodyMatch ? bodyMatch[1] : markup, document).forEach((node) => document.body.appendChild(node));

  // --- timers: held, never real, so an idle watch scheduled for 45 minutes does
  // not keep the test process alive and cannot fire in the middle of an assertion.
  const timers = new Map();
  let nextTimer = 1;
  const addTimer = (fn, delay, repeating) => {
    const id = nextTimer++;
    timers.set(id, { fn, delay: Number(delay) || 0, repeating });
    return id;
  };
  const runDueTimers = (maxDelay) => {
    const due = [...timers.entries()].filter(([, timer]) => !timer.repeating && timer.delay <= maxDelay);
    due.forEach(([id]) => timers.delete(id));
    due.forEach(([, timer]) => timer.fn());
    return due.length > 0;
  };

  // --- cookies: the same jar a browser keeps, so sign-in, session renewal and
  // sign-out are exercised exactly as the Worker writes them.
  let cookie = initialCookie;
  const applySetCookie = (values) => {
    for (const value of values) {
      const [pair] = value.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const content = pair.slice(separator + 1).trim();
      if (!content) cookie = "";
      else cookie = `${name}=${content}`;
    }
  };

  let pending = 0;
  const requests = [];
  async function harnessFetch(input, options = {}) {
    pending += 1;
    try {
      const url = new URL(String(input), origin);
      const headers = new Headers(options.headers || {});
      if (cookie) headers.set("cookie", cookie);
      const request = new Request(url, {
        method: options.method || "GET",
        headers,
        body: options.body,
      });
      const response = await handler(request);
      requests.push({ method: request.method, path: url.pathname, status: response.status });
      const setCookies = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
      applySetCookie(setCookies);
      return response;
    } finally {
      pending -= 1;
    }
  }

  const window = {
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
    innerWidth: 1440, innerHeight: 900, document,
  };
  const location = {
    hash: "", pathname: "/", href: origin + "/", origin,
    assign() {}, replace() {}, reload() {},
  };
  const history = {
    replaceState(_state, _title, url) { location.hash = String(url || "").startsWith("#") ? String(url) : location.hash; },
    pushState(...args) { history.replaceState(...args); },
  };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => (storage.has(String(key)) ? storage.get(String(key)) : null),
    setItem: (key, value) => storage.set(String(key), String(value)),
    removeItem: (key) => storage.delete(String(key)),
    clear: () => storage.clear(),
  };
  const broadcasts = [];
  class HarnessBroadcastChannel {
    constructor(name) { this.name = name; this.onmessage = null; }
    postMessage(message) { broadcasts.push(message); }
    close() {}
    addEventListener() {}
  }
  class HarnessURL extends URL {
    static createObjectURL() { return "blob:harness"; }
    static revokeObjectURL() {}
  }
  class HarnessImage {
    constructor() { this.onload = null; this.onerror = null; this.src = ""; }
  }

  // --- events: one real bubbling path, so the client's delegated document-level
  // listeners see the click exactly as they do in a browser.
  function fire(target, type, init = {}) {
    const element = typeof target === "string" ? document.getElementById(target) : target;
    if (!element) throw new Error(`No element to fire ${type} at: ${target}`);
    let defaultPrevented = false;
    const event = {
      type, target: element, currentTarget: element, defaultPrevented: false,
      preventDefault() { defaultPrevented = true; this.defaultPrevented = true; },
      stopPropagation() {}, stopImmediatePropagation() {},
      ...init,
    };
    const path = [];
    for (let node = element; node; node = node.parentElement) path.push(node);
    path.push(document);
    const results = [];
    for (const node of path) {
      const handlers = (node.listeners && node.listeners.get(type)) || [];
      for (const handler of handlers.slice()) {
        event.currentTarget = node;
        results.push(handler.call(node, event));
      }
    }
    return { defaultPrevented, results: Promise.all(results.map((value) => Promise.resolve(value))) };
  }

  // Waits for the page to go quiet: no request in flight, no short timer left to
  // run. Long timers (the inactivity watch) are deliberately left pending.
  //
  // Bounded by elapsed time, not by a pass count. An in-process handler settles
  // in microseconds, so a setImmediate spin is enough for it; a handler that
  // reaches a deployed environment over the network does not, and a spin of any
  // fixed length simply expires before the first response arrives. While a
  // request is outstanding this yields to the event loop for a few real
  // milliseconds instead, which is what lets the same harness be pointed at a
  // real origin. `setTimeout` here is the host's own — the client's shadowed,
  // virtual one exists only inside the script's function scope.
  async function settle(maxDelay = 250, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pending > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }
      await new Promise((resolve) => setImmediate(resolve));
      if (pending > 0) continue;
      if (runDueTimers(maxDelay)) continue;
      return;
    }
    throw new Error(`The page never went quiet within ${timeoutMs}ms (${pending} request(s) still in flight).`);
  }

  // What a person can actually see: hidden subtrees and closed dialogs contribute
  // nothing, which is the whole question DNC-007 asks.
  function visibleText(root = document.body) {
    if (root.nodeType === 3) return root.nodeValue;
    if (root.nodeType === 1) {
      if (root.hidden) return "";
      if (root.localName === "dialog" && !root.open) return "";
      if (root.localName === "script" || root.localName === "style") return "";
    }
    return (root.childNodes || []).map((child) => visibleText(child)).join(" ");
  }

  function isVisible(id) {
    let node = document.getElementById(id);
    if (!node) return false;
    while (node && node.nodeType === 1) {
      if (node.hidden) return false;
      if (node.localName === "dialog" && !node.open) return false;
      node = node.parentElement;
    }
    return true;
  }

  const run = new Function(
    "window", "document", "location", "history", "localStorage", "fetch",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "BroadcastChannel", "CSS", "getComputedStyle", "URL", "Image", "NodeFilter", "console",
    script,
  );

  return {
    document, window, location, requests, broadcasts, fire, settle, visibleText, isVisible,
    byId: (id) => document.getElementById(id),
    text: (id) => (document.getElementById(id) || { textContent: "" }).textContent,
    type(id, value) {
      const field = document.getElementById(id);
      if (!field) throw new Error(`No field called ${id}`);
      field.value = value;
      return field;
    },
    get cookie() { return cookie; },
    async start() {
      run(
        window, document, location, history, localStorage, harnessFetch,
        (fn, delay) => addTimer(fn, delay, false), (id) => timers.delete(id),
        (fn, delay) => addTimer(fn, delay, true), (id) => timers.delete(id),
        HarnessBroadcastChannel,
        { escape: (value) => String(value).replace(/[^\w-]/g, (c) => "\\" + c) },
        () => ({ fontFamily: "sans-serif", fontSize: "13px", fontWeight: "400", letterSpacing: "normal" }),
        HarnessURL, HarnessImage, { SHOW_TEXT: 4 }, console,
      );
      await settle();
      return this;
    },
  };
}
