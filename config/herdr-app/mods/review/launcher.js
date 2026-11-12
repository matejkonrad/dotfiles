// The "Review ⌘R" button. The panel draws it in its footer (and its folded rail). A layout can also show it alone
// in a block (props.view === "launcher"); that copy then also handles `review.here`.
// It reads "Back ⌘R" while a review tab has the focus. A click runs the same synchronous path as the key.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { keys, theme, window } from "herdr";
import { reviewFocused, runHere } from "./here.js";
import { RADIUS } from "./style.js";
import { iconOf } from "./ui.js";

/** A bound key as the platform writes it: "cmd-r" → "⌘R". */
export function keyLabel(action) {
  const mac = window()?.platform !== "windows" && window()?.platform !== "linux";
  const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+" };
  const b = (keys() ?? []).find((k) => k.section === "global" && k.action === action);
  return b ? b.keys.split("-").map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("") : null;
}

/** The button: 12 px `muted` text and a keycap, a `hover` background with radius 3, no frame. */
export function reviewButton(t, id, back, { compact = false } = {}) {
  const key = keyLabel("review.here");
  const tip = back ? `Back to the tab before the review${key ? ` (${key})` : ""}` : `Review this space: its PR, or its local changes${key ? ` (${key})` : ""}`;
  const click = (_e, cx) => { cx.stop_propagation(); runHere(); cx.notify(); };
  if (compact) {
    return div().id(id).size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(tip).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(click)
      .child(svg(iconOf(back ? "chevron-left" : "git-compare")).size(14).text_color(t.muted));
  }
  return h_flex().id(id).flex_none().h(20).px(6).gap(6).items_center().rounded(RADIUS.small).text_size(12).text_color(t.muted)
    .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(click)
    .child(div().child(back ? "Back" : "Review"))
    .when(Boolean(key), (e) => e.child(div().px(4).h(16).flex().items_center().rounded(RADIUS.small).border_1().border_color(t.border).bg(t.surface)
      .text_size(11).text_color(t.dim).child(key)));
}

/** Follows the focused tab for the button's label: a cheap check, a redraw only on a change. */
export function watchFocus(owner, cx, ms = 300) {
  owner.back = false;
  cx.timer.every(ms, (cx) => {
    let back = false;
    try { back = reviewFocused(); } catch { /* keep */ }
    if (back !== owner.back) { owner.back = back; cx.notify(); }
  });
}

export class Launcher {
  constructor(_view, cx) { watchFocus(this, cx); }
  command(command) { if (command === "here") runHere(); }
  render() { return reviewButton(theme(), "review-launcher", this.back); }
}
