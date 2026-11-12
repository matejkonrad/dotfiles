// The diff column's elements: code rows, split pairs, the gutter, drafts, thread chips, GitHub threads, the composer.
import { div, svg } from "gpui-kit";
import { Textarea, h_flex, v_flex } from "gpui-base";
import * as gh from "./gh.js";
import { RADIUS } from "./style.js";
import { age, alpha, iconOf, openUrl, uiFont } from "./ui.js";
import { unread } from "./walkthrough-model.mjs";
import { runsOf, wordDiff } from "./highlight.js";
import { isGenerated, isLine, lineCount, plain } from "./diff-model.mjs";
import { BODY_LINES, CHIP, M, NOTE_PAD } from "./tab-metrics.js";

export const bodyLines = (body) => {
  const lines = gh.plainText(body).split("\n");
  return lines.length > BODY_LINES ? [...lines.slice(0, BODY_LINES - 1), `… ${lines.length - BODY_LINES + 1} more lines`] : lines;
};

export class DiffView {
  sizeOf(d) {
    if (d.folded !== undefined) return M.ROW;
    if (d.composer) return M.COMPOSER;
    if (d.chip) return CHIP;
    if (d.note) return NOTE_PAD + M.LINE * d.note.body.split("\n").length;
    if (d.thread) {
      if (!this.threadOpen(d.thread)) return 40;
      return 40 + (d.thread.moreComments ? M.LINE : 0) + d.thread.comments.reduce((sum, c) => sum + 24 + M.LINE * bodyLines(c.body).length, 0);
    }
    return M.ROW;
  }

  /** The pointer over a diff line: its gutter shows + (a click writes a note there). */
  hoverEl(e, index, cx) {
    return e.on_hover((h, cx) => {
      if (h && this.hoverRow !== index) { this.hoverRow = index; this.redrawCol("diff", cx); }
      else if (!h && this.hoverRow === index) { this.hoverRow = null; this.redrawCol("diff", cx); }
    });
  }

  /** A line's code as colored runs; changed words (the word diff, computed when first shown) get a stronger tint. */
  codeEl(row, t, tint, emph) {
    // A jump shows dozens of rows never drawn: past the frame's color budget they show plain, and colors
    // follow on the next frame (`colorLater`), so a click never overruns the frame.
    const cold = (row.mate && !row.worded) || !row.runs || row.runsKey !== `${tint}|${t.foreground}`;
    const budget = this.colorBudget;
    if (cold && budget && budget.left <= 0 && Date.now() > budget.until) {
      budget.later = true;
      return div().flex_1().min_w(0).whitespace_nowrap().overflow_hidden().text_color(t.foreground).child(plain(row.text));
    }
    if (cold && budget) budget.left--;
    if (row.mate && !row.worded) {
      const [d, a] = row.k === "del" ? [row, row.mate] : [row.mate, row];
      wordDiff(d, a);
      d.worded = a.worded = true;
      d.runs = a.runs = null;
    }
    return h_flex().flex_1().min_w(0).whitespace_nowrap().overflow_hidden()
      .children(runsOf(row, t, tint).map(([part, c, strong]) => div().flex_none().text_color(c).when(strong && Boolean(emph), (e) => e.bg(emph)).child(plain(part))));
  }

  /** The cursor row: the `selected` background and a 3 px bar in `input` (dim when the diff has no keyboard). */
  cursorEl(e, t, focusedNow) {
    return e.child(div().absolute().inset_0().bg(t.selected))
      .child(div().absolute().top_0().bottom_0().left_0().w(3).bg(focusedNow ? t.input : t.dim));
  }

  /**
   * The gutter's marks: the selected step's lines (a 2 px bar), a thread (a dot: accent while unread), a draft
   * (a small pen), and + under the pointer. All drawn over the row: nothing takes room.
   */
  gutter(e, index, t, cx) {
    const m = this.agent.marks().get(index);
    const note = this.noteRows().has(index);
    const plus = this.hoverRow === index && !this.pending && !this.modal;
    if (!m && !note && !plus) return e;
    const mid = Math.max(0, Math.round((M.ROW - 16) / 2));
    return e.when(Boolean(m?.step), (e) => e.child(div().absolute().top_0().bottom_0().left(0).w(2).bg(t.muted)))
      .when(Boolean(m?.thread), (e) => e.child(div().id(`gdot-${index}`).absolute().left(6).top(Math.round((M.ROW - 6) / 2)).size(6).rounded_full()
        .bg(m.unread ? t.accent : t.dim)))
      .when(note, (e) => e.child(svg(iconOf("square-pen")).absolute().left(Math.round(M.CODE * 3) - 12).top(Math.round((M.ROW - 10) / 2)).size(10).text_color(t.muted)))
      .when(plus, (e) => e.child(div().id(`gplus-${index}`).absolute().left(Math.round(M.CODE * 6) - 4).top(mid).size(16).flex().items_center().justify_center()
        .rounded(RADIUS.small).bg(t.solid).text_color(t.solid_foreground).text_size(12).cursor_pointer().tooltip("Write a note here (a)")
        .on_mouse_down("left", (ev, cx) => { cx.stop_propagation(); this.cursor = index; this.anchor = null; this.focus = "diff"; this.annotate(); this.redraw(cx); })
        .child("+")));
  }

  /** Rows with a draft note (for the gutter), per drafts and diff. */
  noteRows() {
    const key = `${this.notesSig()}|${this.notesHere().map((n) => n.path).join()}`;
    if (this.noteRowsKey === key && this.noteRowsOf === this.rows) return this.noteRowsSet;
    this.noteRowsKey = key; this.noteRowsOf = this.rows;
    this.noteRowsSet = new Set(this.notesHere().map((n) => this.rowFor(n.path, n.side, n.line)));
    return this.noteRowsSet;
  }

  /** One split row: the old side left, the new side right; a filler where a side has no line. */
  pairEl(sindex, t, focusedNow, cx) {
    const { left, right } = this.srows[sindex];
    const sel = this.selection();
    const cell = (i, side) => {
      if (i === null) return div().flex_1().min_w(0).h_full().bg(t.raised);
      const row = this.rows[i];
      const changed = side === "left" ? row.k === "del" : row.k === "add";
      const tint = changed ? alpha(side === "left" ? t.ansi1 : t.ansi2, "26") : null;
      const emph = changed ? alpha(side === "left" ? t.ansi1 : t.ansi2, "66") : null;
      const cut = String(row.text ?? "").length > this.splitChars();
      const selected = sel && i >= sel[0] && i <= sel[1] && (left === right ? this.side === side : true);
      const cur = i === this.cursor && (left !== right || this.side === side);
      const n = side === "left" ? row.o : row.n;
      return this.hoverEl(h_flex().id(`c${side[0]}${i}`).relative().flex_1().min_w(0).h_full().overflow_hidden().items_center()
        .when(Boolean(tint), (e) => e.bg(tint))
        .when(Boolean(selected), (e) => e.bg(t.selection))
        .when(cur, (e) => this.cursorEl(e, t, focusedNow))
        .on_mouse_down("left", (e, cx) => { this.side = side; this.down(i, e, cx); })
        .on_mouse_move((_e, cx) => this.over(i, cx))
        .child(div().w(Math.round(M.CODE * 3)).flex_none().px(4).text_color(t.dim).text_right().child(n == null ? "" : String(n)))
        .child(div().w(Math.round(M.CODE * 1.1)).flex_none().text_color(changed ? (side === "left" ? t.ansi1 : t.ansi2) : t.dim).child(changed ? (side === "left" ? "−" : "+") : " "))
        .child(this.codeEl(row, t, tint, emph))
        // A line longer than the column: a mark at its edge says some of it is cut off.
        .when(cut, (e) => e.child(div().absolute().right_0().top_0().bottom_0().px(4).flex().items_center().bg(t.raised).text_color(t.muted).child("›")))
        .when(!(left === right && side === "left"), (e) => this.gutter(e, i, t, cx)), i, cx);
    };
    return h_flex().id(`s${sindex}`).w_full().h(M.ROW).flex_none().overflow_hidden()
      .child(cell(left, "left"))
      .child(div().w(1).h_full().flex_none().bg(t.border))
      .child(cell(right, "right"));
  }

  rowEl(index, t, focusedNow, cx) {
    const row = this.rows[index];
    if (row.k === "file") {
      const file = this.files[row.f];
      const seen = this.fileViewed(file);
      const cur = index === this.cursor;
      return h_flex().id(`r${index}`).relative().h(M.FILE_ROW).w_full().flex_none().px(12).gap(8).items_center().bg(t.raised).border_t(1).border_b(1).border_color(t.border)
        .when(cur, (e) => this.cursorEl(e, t, focusedNow))
        .font_family(uiFont()).text_size(13)
        .on_mouse_down("left", (e, cx) => this.down(index, e, cx))
        .child(div().id(`viewed-${index}`).size(16).flex_none().rounded(RADIUS.small).border_1().border_color(seen ? t.ansi2 : t.border).cursor_pointer().hover((s) => s.bg(t.hover))
          .flex().items_center().justify_center().text_size(11).text_color(t.ansi2).tooltip("Viewed (V)")
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.toggleViewed(row.f); this.redraw(cx); })
          .child(seen ? "✓" : ""))
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(seen ? t.muted : t.foreground)
          .child(file.previous && file.previous !== file.path ? `${file.previous} → ${file.path}` : file.path))
        .child(div().w(64).flex_none().text_right().text_size(11).text_color(t.dim).child(this.folded(row.f) ? "folded" : file.status))
        .child(div().w(48).flex_none().text_right().text_color(t.ansi2).child(`+${file.additions}`))
        .child(div().w(48).flex_none().text_right().text_color(t.ansi1).child(`−${file.deletions}`));
    }
    const sel = this.selection();
    const selected = sel && index >= sel[0] && index <= sel[1];
    const cur = index === this.cursor;
    const tint = row.k === "add" ? alpha(t.ansi2, "26") : row.k === "del" ? alpha(t.ansi1, "26") : row.k === "hunk" || row.k === "fold" || row.k === "meta" ? t.surface : null;
    const emph = row.k === "add" ? alpha(t.ansi2, "66") : row.k === "del" ? alpha(t.ansi1, "66") : null;
    const num = (n) => div().w(Math.round(M.CODE * 3)).flex_none().px(4).text_color(t.dim).text_right().child(n == null ? "" : String(n));
    const text = row.k === "fold" ? `⋯ ${row.count} unchanged line${row.count === 1 ? "" : "s"}` : row.text;
    const mark = row.k === "add" ? "+" : row.k === "del" ? "−" : " ";
    const el = h_flex().id(`r${index}`).relative().w_full().h(M.ROW).flex_none().overflow_hidden().items_center()
      .when(Boolean(tint), (e) => e.bg(tint))
      .when(Boolean(selected), (e) => e.bg(t.selection))
      .when(cur, (e) => this.cursorEl(e, t, focusedNow))
      .on_mouse_down("left", (e, cx) => this.down(index, e, cx))
      .on_mouse_move((_e, cx) => this.over(index, cx))
      .child(num(row.o))
      .child(num(row.n))
      .child(div().w(Math.round(M.CODE * 1.1)).flex_none().text_color(row.k === "add" ? t.ansi2 : row.k === "del" ? t.ansi1 : t.dim).child(mark))
      .child(isLine(row)
        ? this.codeEl(row, t, row.k === "ctx" ? null : tint, emph)
        : div().flex_1().min_w(0).whitespace_nowrap().overflow_hidden().text_color(row.k === "hunk" ? t.ansi6 : t.dim).child(plain(text)))
      .when(isLine(row), (e) => this.gutter(e, index, t, cx));
    return isLine(row) ? this.hoverEl(el, index, cx) : el;
  }

  /** A folded file's one row: what it is, its size, and how to open it. */
  foldedEl(f, t) {
    const file = this.files[f];
    const lines = lineCount(file);
    const what = file.status === "removed" ? "deleted" : isGenerated(file) ? "generated" : "folded";
    return h_flex().id(`folded-${f}`).w_full().h(M.ROW).flex_none().px(16).gap(8).items_center().bg(t.surface).cursor_pointer()
      .hover((s) => s.bg(t.hover)).text_color(t.muted).font_family(uiFont()).text_size(12)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.toggleFold(f); this.redraw(cx); })
      .child(svg(iconOf("chevron-right")).size(12).text_color(t.dim))
      .child(`${what} · ${lines} line${lines === 1 ? "" : "s"} · ⏎ to expand`);
  }

  /** A draft under its lines. Exactly NOTE_PAD + M.LINE per body line high. */
  noteEl(n, t) {
    const at = n.start_line && n.start_line !== n.line ? `${n.start_line}–${n.line}` : `${n.line}`;
    const stale = this.stale(n);
    return v_flex().id(`note-${n.id}`).w_full().flex_none().py(4).pl(100).pr(12).font_family(uiFont())
      .child(v_flex().rounded(RADIUS.field).border_1().border_color(stale ? t.ansi3 : t.border).bg(t.raised).pl(12).pr(4).py(4).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.editNote(n); this.redraw(cx); })
        .child(h_flex().h(22).items_center().gap(8)
          .child(div().text_size(11).text_color(t.dim).child(`Draft · ${n.path.split("/").pop()}:${at} (${n.side === "LEFT" ? "old" : "new"})`))
          .when(stale, (e) => e.child(div().px(4).rounded(RADIUS.small).border_1().border_color(t.ansi3).text_size(11).text_color(t.ansi3)
            .tooltip("Written before the last push: not sent. ⏎ re-anchors it, X drops all stale drafts").child("stale · pushed since")))
          .child(div().flex_1())
          .child(div().id(`note-x-${n.id}`).size(18).flex().items_center().justify_center().rounded(RADIUS.small).hover((s) => s.bg(t.hover)).tooltip("Delete the draft (d)")
            .on_click((_e, cx) => { cx.stop_propagation(); this.deleteNote(n); this.redraw(cx); })
            .child(svg(iconOf("x")).size(10).text_color(t.dim))))
        .children(n.body.split("\n").map((l) => div().h(M.LINE).text_size(M.TEXT).text_color(t.foreground).truncate().child(l || " "))));
  }

  /** An agent thread under its last line: one line, ↵ (or a click) opens its tab. Exactly CHIP high. */
  chipEl(th, t) {
    const answers = th.entries.filter((e) => e.role === "answer").length;
    const fresh = this.agent.running?.tab === th.id;
    return h_flex().id(`chip-${th.id}`).w_full().h(CHIP).flex_none().py(4).pl(100).pr(12).font_family(uiFont())
      .child(h_flex().id(`chip-in-${th.id}`).h(24).max_w(560).px(8).gap(8).items_center().rounded(RADIUS.small).border_1().border_color(t.border).bg(t.surface)
        .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Open the thread (↵ on its line)")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.agent.select(th.id, cx); this.agent.show(cx); this.redraw(cx); })
        .child(div().size(6).flex_none().rounded_full().bg(fresh ? t.accent : unread(th) ? t.foreground : t.dim))
        .child(div().flex_none().text_size(12).text_color(t.muted).child(`Thread ${this.agent.number(th.id)}`))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(th.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`${answers} answer${answers === 1 ? "" : "s"}`)));
  }

  threadEl(th, t) {
    const open = this.threadOpen(th);
    const first = th.comments[0];
    const head = h_flex().id(`th-head-${th.id}`).h(24).gap(8).items_center().cursor_pointer().text_size(12)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { this.toggleThread(th); this.version++; this.redraw(cx); })
      .child(svg(iconOf(open ? "chevron-down" : "chevron-right")).size(12).text_color(t.dim))
      .child(div().font_semibold().text_color(t.foreground).child(first ? gh.shortAuthor(first.author) : "thread"))
      .child(div().text_color(t.dim).child(first ? age(first.createdAt) : ""))
      .when(th.comments.length > 1, (e) => e.child(div().text_color(t.dim).child(`${th.comments.length} comments`)))
      .when(th.outdated, (e) => e.child(div().text_color(t.ansi3).child("outdated")))
      .when(th.resolved, (e) => e.child(div().text_color(t.ansi2).child("resolved")))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(!open && first ? gh.plainText(first.body).split("\n")[0] : ""))
      .child(div().id(`th-open-${th.id}`).size(20).flex().items_center().justify_center().rounded(RADIUS.small).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Open on GitHub")
        .on_click((_e, cx) => { cx.stop_propagation(); openUrl(first?.url); })
        .child("↗"));
    return v_flex().id(`th-${th.id}`).w_full().flex_none().py(4).pl(100).pr(12).font_family(uiFont())
      .child(v_flex().rounded(RADIUS.field).border_1().border_color(t.border).bg(t.surface).px(12).py(4)
        .child(head)
        .when(open, (e) => e.children(th.comments.map((c) => v_flex().pt(4)
          .child(h_flex().h(20).gap(8).text_size(11).text_color(t.dim)
            .child(div().text_color(t.muted).child(gh.shortAuthor(c.author))).child(div().child(age(c.createdAt))))
          .children(bodyLines(c.body).map((l) => div().h(M.LINE).text_size(M.TEXT).text_color(th.resolved ? t.muted : t.foreground).truncate().child(l || " ")))))
          .when(Boolean(th.moreComments), (e) => e.child(div().h(M.LINE).text_size(12).text_color(t.dim).child(`${th.moreComments} more comment${th.moreComments === 1 ? "" : "s"} on GitHub (↗)`)))));
  }

  composerEl(t) {
    const r = this.pending.range;
    const at = r.start_line && r.start_line !== r.line ? `${r.start_line}–${r.line}` : `${r.line}`;
    return v_flex().id("review-composer").w_full().h(M.COMPOSER).flex_none().py(4).pl(100).pr(12).font_family(uiFont())
      .child(v_flex().rounded(RADIUS.field).border_1().border_color(t.input).bg(t.surface).px(12).py(8).gap(4)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().h(16).text_size(11).text_color(t.dim).child(`${this.pending.edit ? "Edit draft" : "New draft"} · ${r.path.split("/").pop()}:${at} (${r.side === "LEFT" ? "old" : "new"}) · ↵ save · ⇧↵ new line · esc cancel`))
        .child(Textarea.new(this.composer).h(M.LINE * 3).text_size(M.TEXT).text_color(t.foreground)));
  }
}
