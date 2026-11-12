// "Open in…": the open-with picker on a PR's checkout, for the review tab and the panel. When no checkout is on
// the PR's head branch, a small inline choice instead: the clones found, a new worktree, or a clone.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, openOverlay } from "herdr";
import { RADIUS } from "./style.js";
import { CLEAR, iconOf, keycap } from "./ui.js";
import { addWorktree, cloneRepo, resolveCheckout, validBranch } from "./checkout.js";

const SHOWN = 4;

/** The open-with mod's picker: the folder, or one file in it (path relative to the folder). */
export function openFolder(at, file = null) {
  openOverlay({ mod: "open-with", kind: "popup", at: "top", offset: 40, width: 380,
    props: { ...(file ? { file: `${at.root}/${file}` } : {}), folder: at.root, machine: at.on ?? null } });
}

/** "~/Project/framer/FramerStudio" */
export const tildify = (path) => {
  const h = String(home() ?? "");
  return h && String(path).startsWith(`${h}/`) ? `~${String(path).slice(h.length)}` : String(path);
};

/** The choice's lines: each clone found (its branch as is), then a new worktree on the head, or a clone. */
export function choiceItems({ clones, repo, head }) {
  const items = clones.slice(0, SHOWN).map((c) => ({ kind: "folder", at: c,
    label: `Open ${tildify(c.root)}`, detail: c.branch ? `on ${c.branch}` : "detached" }));
  if (head && validBranch(head)) {
    if (clones.length) items.push({ kind: "worktree", clone: clones.find((c) => !c.root.includes("/.herdr/worktrees/")) ?? clones[0], label: `New worktree for ${head}`, detail: "~/.herdr/worktrees" });
    else items.push({ kind: "clone", label: `Clone ${repo} on ${head}`, detail: "~/.herdr/worktrees" });
  }
  return items;
}

/**
 * Finds the checkout and calls `then(at)` with it, or puts a choice on `owner.openChoice` (null when it is
 * answered or dismissed). `ask`: {space, repo, head, number}. `redraw(cx)` shows the choice and its progress.
 */
export async function withCheckout(owner, ask, then, redraw, cx) {
  const res = await resolveCheckout(ask);
  if (res.exact) return then(res.exact);
  const items = choiceItems({ clones: res.clones, repo: ask.repo, head: ask.head });
  owner.openChoice = { ...ask, items, at: 0, busy: null, error: items.length ? null : `No clone of ${ask.repo} on this computer`, then, redraw, token: {} };
  redraw(cx);
}

/** Runs line i of the choice: opens a clone as it is, or makes the worktree or clone first (with progress). */
export function pick(owner, i, cx) {
  const c = owner.openChoice, item = c?.items[i];
  if (!item || c.busy) return;
  c.at = i;
  if (item.kind === "folder") { owner.openChoice = null; c.then(item.at); return; }
  c.busy = item.kind === "worktree" ? `Making a worktree for ${c.head}…` : `Cloning ${c.repo}…`;
  c.error = null;
  const token = c.token;
  cx.spawn(async (cx) => {
    try {
      const at = item.kind === "worktree" ? await addWorktree({ clone: item.clone, repo: c.repo, head: c.head, number: c.number }) : await cloneRepo({ repo: c.repo, head: c.head });
      // Esc while it ran: the worktree stays, nothing opens.
      if (owner.openChoice?.token === token) { owner.openChoice = null; c.then(at); }
    } catch (e) {
      if (owner.openChoice?.token === token) { c.busy = null; c.error = String(e?.message ?? e).split("\n")[0].slice(0, 200); }
    }
    c.redraw(cx);
  });
}

/** Keys while the choice shows. True: used. Ctrl, Alt and ⌘ keys pass (pane moves stay). */
export function choiceKey(owner, e, cx) {
  const c = owner.openChoice, mods = e.modifiers ?? {};
  if (!c || mods.control || mods.alt || mods.platform) return false;
  const k = e.key;
  if (k === "escape") { owner.openChoice = null; return true; }
  if (c.busy) return true;
  if (/^[1-9]$/.test(k)) { pick(owner, Number(k) - 1, cx); return true; }
  if (k === "j" || k === "down") c.at = Math.min(c.items.length - 1, c.at + 1);
  else if (k === "k" || k === "up") c.at = Math.max(0, c.at - 1);
  else if (k === "enter") pick(owner, c.at, cx);
  return true;
}

/** The choice as a small card: what is missing, the lines with their number keys, progress or the error. */
export function choiceEl(t, owner, onChange, { width = 420 } = {}) {
  const c = owner.openChoice;
  // Narrow (the panel): the branch goes under the path, so the path keeps the room.
  const narrow = !width;
  const text = (item) => narrow
    ? v_flex().flex_1().min_w(0).child(div().truncate().text_color(t.foreground).child(item.label)).child(div().truncate().text_size(11).text_color(t.dim).child(item.detail))
    : h_flex().flex_1().min_w(0).gap(8).items_center().child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(item.label))
      .child(div().flex_none().max_w(160).truncate().text_color(t.dim).child(item.detail));
  const line = (item, i) => h_flex().id(`open-choice-${i}`).h(narrow ? 38 : 26).px(8).gap(8).items_center().rounded(RADIUS.row).text_size(12).tooltip(item.at?.root ?? item.label)
    .border_1().border_color(i === c.at ? t.input : CLEAR).when(i === c.at, (e) => e.bg(t.selected))
    .when(!c.busy, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { pick(owner, i, cx); onChange(cx); })
    .child(keycap(t, String(i + 1)))
    .child(text(item));
  return v_flex().id("open-choice").when(Boolean(width), (e) => e.w(width)).p(10).gap(4).rounded(RADIUS.field).border_1().border_color(t.input).bg(t.popover).text_color(t.foreground)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold()
        .tooltip(c.head ? `No checkout of ${c.repo} has ${c.head} checked out` : `No checkout of ${c.repo}`)
        .child(c.head ? `${c.repo.split("/").pop()}: nothing on ${c.head}` : `No checkout of ${c.repo}`))
      .child(div().id("open-choice-close").size(18).flex().flex_none().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { owner.openChoice = null; onChange(cx); })
        .child(svg(iconOf("x")).size(10).text_color(t.muted))))
    .children(c.items.map(line))
    .child(h_flex().h(18).gap(6).items_center().text_size(11)
      .when(Boolean(c.busy), (e) => e.child(svg(iconOf("spinner")).size(10).text_color(t.muted).spin(900)).child(div().text_color(t.muted).child(c.busy)))
      .when(!c.busy && Boolean(c.error), (e) => e.child(div().flex_1().min_w(0).truncate().text_color(t.ansi1).child(c.error)))
      .when(!c.busy && !c.error, (e) => e.child(div().text_color(t.dim).child("1–9 or ⏎ open · esc close · nothing switches branches"))));
}
