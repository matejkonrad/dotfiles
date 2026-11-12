// The fake host's state. Tests change `host` (reset() between tests); the fake modules read it on every call.
// shared() hands out a fresh copy on each read and counts reads, as the real host deserializes each time.

export const theme = new Proxy({}, { get: (_t, k) => `#${String(k).length.toString(16).padStart(6, "0")}` });

function defaults() {
  return {
    store: new Map(), reads: 0, writes: 0, readsByKey: {},
    spaces: [], panes: [], agents: [], terminals: [], focused: null, props: {}, layout: null, keys: [],
    settings: { zoom: 1, font_size: 13 }, appHome: "/home", home: "/home",
    runs: [], notices: [], overlays: [],
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    hc: async () => ({ code: 0, stdout: "", stderr: "" }),
    files: new Map(), // readTextFile / writeTextFile
    fs: { written: [], removed: [], dirs: [], list: [] },
    commands: [],
  };
}
export const host = defaults();
export function reset() { for (const k of Object.keys(host)) delete host[k]; Object.assign(host, defaults()); drawn.clear(); }

/** A fake element: every builder call chains; id, handlers and children are recorded, so a test can click what render drew. */
export const drawn = new Map();
export function el(...args) {
  const self = { kids: [], handlers: {}, args };
  const proxy = new Proxy(self, { get(target, name) {
    if (name in target) return target[name];
    if (name === "then") return undefined;
    if (name === "id") return (id) => { target.elId = id; drawn.set(id, proxy); return proxy; };
    if (name === "on_click") return (fn) => { target.handlers.click = fn; return proxy; };
    if (name === "on_item_click") return (fn) => { target.handlers.item = fn; return proxy; };
    if (name === "on_mouse_down") return (_b, fn) => { target.handlers.down = fn; return proxy; };
    if (name === "on_mouse_up") return (_b, fn) => { target.handlers.up = fn; return proxy; };
    if (name === "on_mouse_move") return (fn) => { target.handlers.move = fn; return proxy; };
    if (name === "on_hover") return (fn) => { target.handlers.hover = fn; return proxy; };
    if (name === "on_key_down") return (fn) => { target.handlers.key = fn; return proxy; };
    if (name === "on_size_change") return (fn) => { target.handlers.size = fn; return proxy; };
    if (name === "when") return (cond, fn) => (cond ? fn(proxy) : proxy);
    if (name === "child") return (c) => { target.kids.push(c); return proxy; };
    if (name === "children") return (list) => { target.kids.push(...list); return proxy; };
    return () => proxy;
  } });
  return proxy;
}

export const textarea = () => ({ text: "", handlers: {}, on(name, fn) { this.handlers[name] = fn; }, value() { return this.text; },
  set_value(v) { this.text = v; }, set_auto_grow() {}, set_placeholder() {}, focus() { this.handlers.focus?.({}, cx); }, blur() { this.handlers.blur?.({}, cx); } });

/** A frame's cx: notify counts redraws; spawn runs nothing unless a test collects the tasks. */
export const cx = { notifies: 0, notified: [], notify(target) { this.notifies++; if (target) this.notified.push(target); }, stop_propagation() {}, spawn(fn) { if (this.tasks) this.tasks.push(fn(this)); },
  sleep: async () => {}, timer: { after(_ms, fn) { fn(cx); }, every() {} }, focus_handle: () => ({ focus() {}, is_focused: () => true }) };

/** Renders with a fresh record of what was drawn. */
export function render(fn) { drawn.clear(); return fn(); }

/** Clicks a drawn element by id (its click, else its mouse-down handler). */
export function click(id, event = {}) {
  const e = drawn.get(id);
  if (!e) throw new Error(`not drawn: ${id}`);
  (e.handlers.click ?? e.handlers.down)({ modifiers: {}, click_count: 1, position: { x: 0, y: 0 }, ...event }, cx);
}
