// The file list: reading order (by walkthrough step) or folders, drawn by GPUI's own virtual list.
import { div, svg } from "gpui-kit";
import { Scrollbar, h_flex, v_flex, v_virtual_list } from "gpui-base";
import { RADIUS } from "./style.js";
import { HEADER, button, iconOf } from "./ui.js";
import { store } from "./store.js";
import { stepRefs } from "./walkthrough-model.mjs";
import { FILES_RAIL } from "./tab-metrics.js";

export class FilesView {
  /**
   * The file list's rows. Reading order: a group per walkthrough step (its files in the order the step shows
   * them), then the other files. Folders: the tree.
   */
  fileRows() {
    const steps = this.agent.usable() ? this.agent.steps() : [];
    const reading = store().fileOrder !== "folders" && steps.length > 0;
    const key = `${reading}|${this.version}|${this.agent.version()?.id}|${[...this.closedDirs].join()}`;
    if (this.fileRowsKey === key) return this.fileRowsList;
    this.fileRowsKey = key;
    let out;
    if (reading) {
      out = [];
      const seen = new Set();
      steps.forEach((step, si) => {
        const paths = [...new Set(stepRefs(step).map((r) => r.path))].filter((p) => !seen.has(p));
        if (!paths.length) return;
        out.push({ group: true, label: `${si + 1}. ${step.title}`, step: si });
        for (const p of paths) { seen.add(p); const i = this.fileIndex?.get(p) ?? -1; if (i >= 0) out.push({ dir: false, label: p.split("/").pop(), index: i, depth: 0, path: p, step: si, dirLabel: p.split("/").slice(0, -1).join("/") }); }
      });
      const rest = this.files.map((f, i) => ({ f, i })).filter(({ f }) => !seen.has(f.path));
      if (rest.length) {
        out.push({ group: true, label: "Other files" });
        for (const { f, i } of rest) out.push({ dir: false, label: f.path.split("/").pop(), index: i, depth: 0, path: f.path, dirLabel: f.path.split("/").slice(0, -1).join("/") });
      }
    } else {
      const hidden = (path) => [...this.closedDirs].some((d) => path.startsWith(`${d}/`));
      out = this.tree.filter((n) => !hidden(n.path));
    }
    this.fileRowsList = out;
    return out;
  }

  /** A file-list row's stable key: what a click reports, whatever the order or the scroll. */
  fileRowKey(n) {
    if (n.group) return `g:${n.step ?? "rest"}`;
    return n.dir ? `d:${n.path}` : `f:${n.step ?? ""}:${n.path}`;
  }

  /** A click on a file-list row, by its key: a file opens, a folder folds, a step header selects the step. */
  clickFileRow(key, cx) {
    const list = this.fileRows();
    const at = list.findIndex((n) => this.fileRowKey(n) === key);
    const n = list[at];
    if (!n) return;
    this.fileCursor = at;
    if (n.group) {
      // A step header: select the step, and open its first excerpt in the diff.
      if (n.step == null) return;
      const a = this.agent;
      a.step = n.step; a.picked = true; a.link = -1; a.revealStep = true; a.marksKey = null;
      const ref = stepRefs(a.steps()[n.step] ?? {})[0];
      if (ref) a.navigate(ref, cx);
      return;
    }
    if (n.dir) { if (this.closedDirs.has(n.path)) this.closedDirs.delete(n.path); else this.closedDirs.add(n.path); this.fileRowsKey = null; return; }
    this.goFile(n.index);
    this.focus = "diff";
    this.agent.focused = false;
    this.handle.focus();
  }

  /**
   * The file list: GPUI's own virtual list, so it scrolls natively and a click reports the row's stable key
   * (on_item_click), never an index that moved. Rows carry no handlers of their own.
   */
  fileList(t) {
    const viewedN = this.viewedCount();
    if (store().filesFolded) {
      return v_flex().id("review-files-rail").w(FILES_RAIL).flex_none().h_full().py(8).gap(8).items_center().border_r(1).border_color(t.border).bg(t.chrome)
        .child(div().id("files-unfold").size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
          .tooltip("Files ([)").on_click((_e, cx) => { this.foldFiles(); this.redraw(cx); })
          .child(svg(iconOf("panel-left")).size(14).text_color(t.muted)))
        .child(div().text_size(11).text_color(t.dim).child(`${viewedN}/${this.files.length}`));
    }
    const width = this.filesWidth();
    const cur = this.fileAt(this.cursor);
    const counts = {};
    for (const n of this.notesHere()) counts[n.path] = (counts[n.path] ?? 0) + 1;
    const threads = {};
    for (const th of this.threadsHere()) if (!th.resolved) threads[th.path] = (threads[th.path] ?? 0) + 1;
    const shown = this.fileRows();
    const keyed = this.focus === "files";
    const reading = shown.some((n) => n.group);
    // The list follows the file under the cursor, and the keyboard's row.
    const follow = keyed ? this.fileCursor : shown.findIndex((n) => !n.dir && !n.group && n.index === cur);
    if (this.fileHandle && follow >= 0 && this.followed !== `${follow}|${this.fileRowsKey}`) {
      this.followed = `${follow}|${this.fileRowsKey}`;
      try { this.fileHandle.scroll_to_item(follow); } catch { /* not drawn yet */ }
    }
    const row = (n, i) => {
      if (n.group) {
        const on = n.step != null && n.step === this.agent.step;
        return h_flex().h(32).w_full().px(12).pt(8).gap(8).items_center().rounded(RADIUS.row).text_size(11)
          .text_color(on ? t.foreground : t.dim).when(n.step != null, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
          .child(div().flex_1().min_w(0).truncate().child(n.label));
      }
      const atCursor = keyed && i === this.fileCursor;
      if (n.dir) {
        const closed = this.closedDirs.has(n.path);
        return h_flex().relative().h(28).w_full().pl(8 + n.depth * 12).pr(8).gap(4).items_center().cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover))
          .when(atCursor, (e) => e.bg(t.selected).child(div().absolute().top_0().bottom_0().left_0().w(3).bg(t.input)))
          .child(svg(iconOf(closed ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).truncate().child(`${n.label}/`));
      }
      const f = this.files[n.index];
      const seen = this.fileViewed(f);
      const here = n.index === cur;
      return h_flex().relative().h(28).w_full().pl(reading ? 12 : 24 + n.depth * 12).pr(8).gap(4).items_center().cursor_pointer()
        .when(here || atCursor, (e) => e.bg(t.selected))
        .when(atCursor || (here && !keyed), (e) => e.child(div().absolute().top_0().bottom_0().left_0().w(3).bg(atCursor ? t.input : t.dim)))
        .hover((s) => s.bg(t.hover))
        // The name keeps its room; the folder hint (reading order) takes what is left.
        .child(div().flex_shrink(0).max_w(Math.max(80, width - 190)).truncate().text_color(seen ? t.dim : f.status === "removed" ? t.ansi1 : f.status === "added" ? t.ansi2 : t.foreground).child(n.label))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(reading ? n.dirLabel ?? "" : ""))
        // Fixed slots: GitHub threads, drafts, the counts and the viewed check never move each other.
        .child(div().w(20).flex_none().text_right().text_size(11).text_color(t.muted).child(threads[f.path] ? `◆${threads[f.path]}` : ""))
        .child(div().w(20).flex_none().text_right().text_size(11).text_color(t.foreground).child(counts[f.path] ? `✎${counts[f.path]}` : ""))
        .child(div().w(36).flex_none().text_right().text_size(11).text_color(t.ansi2).child(`+${f.additions}`))
        .child(div().w(36).flex_none().text_right().text_size(11).text_color(t.ansi1).child(`−${f.deletions}`))
        .child(div().w(12).flex_none().text_size(11).text_color(t.ansi2).child(seen ? "✓" : ""));
    };
    const ordered = this.agent.steps().length > 0;
    const listId = `review-file-list-${reading ? "reading" : "folders"}`;
    const list = v_virtual_list(listId, shown.length, shown.map((n) => (n.group ? 32 : 28)), (i) => this.fileRowKey(shown[i]),
      (range) => shown.slice(range.start, range.end).map((n, k) => row(n, range.start + k)))
      .on_item_click((key, cx) => { this.clickFileRow(key, cx); this.redraw(cx); });
    return v_flex().id("review-files").relative().w(width).flex_none().h_full().min_h(0).border_r(1).border_color(t.border).bg(t.chrome)
      .child(h_flex().h(HEADER).flex_none().pl(12).pr(4).items_center().gap(8).text_size(12).text_color(t.dim).border_b(1).border_color(t.border).bg(keyed ? t.raised : t.chrome)
        .child(div().flex_1().min_w(0).truncate().child(`${viewedN} of ${this.files.length} viewed`))
        .when(ordered, (e) => e.child(button(t, "file-order", store().fileOrder === "folders" ? "Folders" : "Reading order", "o", () => this.toggleOrder(), { tip: "File order: reading order (by walkthrough step) or folders" })))
        .child(div().id("files-fold").size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
          .tooltip("Fold the file list ([)").on_click((_e, cx) => { this.foldFiles(); this.redraw(cx); })
          .child(svg(iconOf("panel-left")).size(14).text_color(t.muted))))
      .child(v_flex().relative().flex_1().min_h(0).py(4).text_size(13)
        .child(this.fileHandle ? list.track_scroll(this.fileHandle) : list)
        .child(Scrollbar.vertical(listId).absolute().inset_0()))
      .child(div().id("files-resize").absolute().right(-3).top_0().bottom_0().w(6).cursor_col_resize()
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.filesDrag = { x: e.position.x, w: width }; this.redraw(cx); }));
  }
}
