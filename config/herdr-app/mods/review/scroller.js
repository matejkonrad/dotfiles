// A scrolling list drawn by the mod itself: only the rows on screen are built, like a virtual list, but they
// are ordinary elements, so rows can have their own buttons, hover and drag handlers (inside the app's virtual
// lists they can't). The wheel and the thumb move it; code keeps a row in view.

import { RADIUS } from "./style.js";
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { zoom } from "./ui.js";

const BAR = 6;

export class Scroller {
  // pad: room kept free on the right for the scrollbar, so the thumb never covers the rows.
  constructor(id, { pad = 0 } = {}) {
    this.id = id;
    this.pad = pad;
    this.top = 0;
    this.height = 0;
    this.raw = 0; // the viewport's height in window px
    this.sizes = [];
    this.offsets = [0];
    this.dragging = null;
  }

  // Item heights.
  measure(list) {
    // Keep what is on screen in place: the first visible item keeps its distance to the top when the heights
    // above it change (measured blocks, inserted rows).
    const first = this.sizes?.length ? this.indexAt(0) : -1;
    const delta = first >= 0 ? this.top - this.offsets[first] : 0;
    const offsets = new Float64Array(list.length + 1);
    for (let i = 0; i < list.length; i++) offsets[i + 1] = offsets[i] + list[i];
    this.sizes = list;
    this.offsets = offsets;
    if (first >= 0 && first < list.length) this.top = offsets[first] + delta;
    this.clamp();
  }

  total() {
    return this.offsets[this.offsets.length - 1];
  }

  clamp() {
    this.top = Math.max(0, Math.min(this.top, this.total() - this.height));
  }

  // The item under a y in the viewport (or -1).
  indexAt(y) {
    const at = this.top + y;
    let lo = 0;
    let hi = (this.sizes?.length ?? 0) - 1;
    if (hi < 0 || at < 0 || at >= this.total()) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Scroll just enough to show item `i` (with `margin` px around it), or
  // put it in the middle: on the next draw, once the rows are measured.
  reveal(i, { center = false, margin = 0 } = {}) {
    this.pending = { i, center, margin };
  }

  apply({ i, center, margin }) {
    if (i < 0 || i >= (this.sizes?.length ?? 0)) return;
    const a = this.offsets[i];
    const b = this.offsets[i + 1];
    if (center) this.top = a - (this.height - (b - a)) / 2;
    else if (a - margin < this.top) this.top = a - margin;
    else if (b + margin > this.top + this.height) this.top = b + margin - this.height;
    this.clamp();
  }

  // The element: `render(i)` builds item i. Wheel, size and the thumb are
  // handled here; `cx.notify()` redraws.
  view(t, render) {
    // The viewport in mod px, again on every draw: a zoom change doesn't resize the element.
    if (this.raw) {
      this.height = this.raw / zoom();
      this.clamp();
    }
    if (this.pending && this.height) {
      const p = this.pending;
      this.pending = null;
      this.apply(p);
    }
    const n = this.sizes?.length ?? 0;
    let start = Math.max(0, this.indexAt(0));
    let end = start;
    while (end < n && this.offsets[end] < this.top + this.height + 1) end++;
    // First layout has no viewport yet. Keep its bootstrap frame small; the measured redraw fills it.
    if (!this.height) end = Math.min(n, 12);
    const items = [];
    for (let i = start; i < end; i++) items.push(render(i));
    const total = this.total();
    const over = total > this.height + 1 && this.height > 0;
    const thumb = over ? Math.max(24, (this.height * this.height) / total) : 0;
    const thumbTop = over ? ((this.height - thumb) * this.top) / (total - this.height) : 0;
    return div()
      .id(this.id)
      .relative()
      .flex_1()
      .min_h(0)
      .w_full()
      .overflow_hidden()
      .on_size_change((size, cx) => {
        if (size.height === this.raw) return;
        this.raw = size.height;
        this.height = size.height / zoom();
        this.clamp();
        cx.notify();
      })
      .on_scroll_wheel((e, cx) => {
        const before = this.top;
        this.top -= e.delta.y / zoom();
        this.clamp();
        if (this.top !== before) cx.notify();
      })
      .on_mouse_move((e, cx) => {
        if (!this.dragging) return;
        const d = this.dragging;
        this.top = d.top + (((e.position.y - d.y) / zoom()) * (total - this.height)) / Math.max(1, this.height - thumb);
        this.clamp();
        cx.notify();
      })
      .on_mouse_up("left", () => { this.dragging = null; })
      .child(v_flex().absolute().left(0).right(this.pad).top(this.offsets[start] - this.top).children(items))
      .when(over, (e) =>
        e.child(
          div()
            .id(`${this.id}-thumb`)
            .absolute()
            .right(1)
            .w(BAR)
            .top(thumbTop)
            .h(thumb)
            .rounded(RADIUS.small)
            .bg(t.border)
            .hover((s) => s.bg(t.input ?? t.muted))
            .on_mouse_down("left", (ev, cx) => {
              this.dragging = { y: ev.position.y, top: this.top };
              cx.stop_propagation();
            }),
        ),
      );
  }
}
