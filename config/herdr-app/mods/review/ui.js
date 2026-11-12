// The look's shared pieces: fonts, colors, icons, keycaps and buttons. No review state.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, settings } from "herdr";
import { RADIUS } from "./style.js";

// GPUI takes no "transparent": a color with alpha 0.
export const CLEAR = "#00000000";
export const HEADER = 40;
export const iconOf = (name) => `mods/workspace-chrome/${name}.svg`;
export const mono = () => settings().font_family ?? "JetBrains Mono";
export const uiFont = () => settings().ui_font ?? "Geist";
export const codeSize = () => Number(settings().font_size) || 13;
// Pointer and size events report window px; element sizes are mod px, which the app scales by its zoom.
export const zoom = () => Number(settings().zoom) || 1;
/** A theme color with an alpha byte, when it is plain #rrggbb. */
export const alpha = (c, aa) => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(c)) ? `${String(c).slice(0, 7)}${aa}` : c);
/** "1 draft", "3 drafts". */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "now", "2m", "3h", "4d": how long ago `at` (ms, or an ISO time) was. */
export function age(at) {
  const ms = typeof at === "string" ? Date.parse(at) : at ?? 0;
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? "now" : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

/** Only web pages open: a URL from GitHub or a CI integration could name a local app or file, or an option. */
export const isWebUrl = (url) => typeof url === "string" && /^https:\/\/[^\s]+$/i.test(url);

/** Opens a web page in the browser; anything else is refused (false). */
export function openUrl(url) {
  if (!isWebUrl(url)) return false;
  exec("open", [url]).catch(() => {});
  return true;
}

/** A keycap: the key in a small bordered box, then what it does (dim). */
export function keycap(t, key, label = null) {
  return h_flex().flex_none().gap(4).items_center()
    .child(div().px(4).h(16).flex().items_center().rounded(RADIUS.small).border_1().border_color(t.border).bg(t.surface)
      .font_family(mono()).text_size(11).text_color(t.muted).child(key))
    .when(Boolean(label), (e) => e.child(div().text_size(12).text_color(t.dim).child(label)));
}

/**
 * Every open review tab's redraw (a tab registers itself): a button is drawn by a free function, so its click
 * redraws all of them. Without any (tests), the clicked view redraws.
 */
export const REDRAWS = new Set();
export function redrawAll(cx) {
  if (!REDRAWS.size) { try { cx.notify(); } catch { /* gone */ } return; }
  for (const redraw of REDRAWS) redraw(cx);
}

/**
 * A control: pointer, hover background, a frame that is always there (transparent, `input` when focused), so
 * nothing moves when it is hovered, focused or selected. `primary`: filled, only when it can run.
 */
export function button(t, id, label, key, action, { primary = false, disabled = false, focused = false, tip = null } = {}) {
  const on = primary && !disabled;
  // Never shrinks: a row truncates its title or path, never a button.
  return h_flex().id(id).flex_none().flex_shrink_0().whitespace_nowrap().h(24).px(8).gap(6).items_center().rounded(RADIUS.small).text_size(12)
    .border_1().border_color(focused ? t.input : on ? t.solid : CLEAR)
    .bg(on ? t.solid : CLEAR).text_color(on ? t.solid_foreground : disabled ? t.dim : t.muted)
    .when(!disabled, (e) => e.cursor_pointer().hover((s) => on ? s.opacity(0.9) : s.bg(t.hover).text_color(t.foreground)))
    .when(Boolean(tip), (e) => e.tooltip(tip))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { if (!disabled) action(cx); redrawAll(cx); })
    .child(div().flex_none().child(label))
    .when(Boolean(key), (e) => e.child(div().flex_none().px(4).h(16).flex().items_center().rounded(RADIUS.small).border_1()
      .border_color(on ? alpha(t.solid_foreground, "55") : t.border)
      .font_family(mono()).text_size(11).text_color(on ? t.solid_foreground : t.dim).child(key)));
}
