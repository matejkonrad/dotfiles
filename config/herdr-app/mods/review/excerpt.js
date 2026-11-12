// Prose and code excerpts in the Agent panel: the referenced diff lines with context from the hunk, then the file.
import { div } from "gpui-kit";
import { TextView, h_flex, v_flex } from "gpui-base";
import { exec, readTextFile } from "herdr";
import { RADIUS } from "./style.js";
import { alpha, button, codeSize, mono, uiFont } from "./ui.js";
import { checkoutOf } from "./store.js";
import { excerptPlan, mergeCodeBlocks, rangeOfRefs, refLines, sideSource } from "./walkthrough-model.mjs";

// Prose and code excerpts share one column width, so a wide panel reads as one column.
export const EXCERPT_MAX = 560;

export class Excerpts {
  /**
   * Markdown prose: paragraphs, lists, bold, italic and `code` drawn natively (one text element per paragraph
   * group, not one element per word); fenced code in the mono font on `surface`. Parsed once per text.
   */
  prose(t, text, { color = t.foreground, id = "p" } = {}) {
    const parts = [];
    const src = String(text ?? "").split("\n");
    let prose = [];
    const flush = () => { if (prose.join("").trim()) parts.push({ md: prose.join("\n") }); prose = []; };
    for (let li = 0; li < src.length; li++) {
      if (!/^\s*```/.test(src[li])) { prose.push(src[li]); continue; }
      flush();
      const code = [];
      while (++li < src.length && !/^\s*```/.test(src[li])) code.push(src[li]);
      parts.push({ code });
    }
    flush();
    const ROWH = Math.round(codeSize() * 1.45);
    return v_flex().w_full().max_w(EXCERPT_MAX).gap(8).text_size(13).text_color(color).children(parts.map((p, k) => p.code
      ? v_flex().id(`${id}-f${k}`).w_full().px(8).py(4).rounded(RADIUS.field).bg(t.surface).font_family(mono()).text_size(codeSize())
        .children(p.code.map((c, ci) => div().id(`${id}-f${k}-${ci}`).h(ROWH).whitespace_nowrap().overflow_hidden().text_color(t.foreground).child(c.replace(/\t/g, "  ").replace(/ /g, "\u00a0") || " ")))
      : div().id(`${id}-m${k}`).w_full().child(TextView.markdown(`${id}-md${k}`, p.md))));
  }

  /**
   * The file's lines for context beyond a hunk, per side: from the cache, else asked for (render fetches it:
   * `git show <rev>:<path>`, or the working tree for a local diff) and null until it arrives.
   */
  linesOf(file) {
    return (side) => {
      const src = sideSource(side, file, this.owner.meta, this.owner.local);
      if (!src) return null;
      const key = `${src.rev}|${src.path}`;
      if (this.lineCache.has(key)) return this.lineCache.get(key);
      this.lineWants.add(key);
      return null;
    };
  }

  /** Reads the asked-for file versions (at most 4 at a time), then redraws. */
  fetchLines(cx) {
    if (!this.lineWants.size || this.fetchingLines) return;
    const keys = [...this.lineWants].slice(0, 4);
    for (const k of keys) { this.lineWants.delete(k); this.lineCache.set(k, null); }
    this.fetchingLines = true;
    cx.spawn(async (cx) => {
      try {
        // The checkout may be on another machine: every read runs there (`on`).
        let at = this.owner.local ? (this.owner.meta?.root ? { root: this.owner.meta.root, on: this.owner.info?.on ?? null } : null) : this.prRoot;
        if (!at && !this.owner.local) {
          const space = this.owner.space();
          const found = space ? await checkoutOf(space, { repo: this.owner.ref.repo }).catch(() => null) : null;
          at = this.prRoot = found ? { root: found.root, on: found.on } : null;
        }
        for (const key of keys) {
          const [rev, ...rest] = key.split("|");
          const path = rest.join("|");
          let text = null;
          if (at && rev === "worktree") text = await readTextFile(`${at.root}/${path}`, { on: at.on }).catch(() => null);
          else if (at) { const r = await exec("git", ["show", "--end-of-options", `${rev}:${path}`], { cwd: at.root, on: at.on }).catch(() => null); text = r?.code === 0 ? r.stdout : null; }
          // Only text files of a sane size; else no context beyond the hunk.
          this.lineCache.set(key, text != null && text.length < 2_000_000 ? text.split("\n") : false);
          this.linesRead = (this.linesRead ?? 0) + 1;
        }
        if (this.lineCache.size > 60) for (const k of [...this.lineCache.keys()].slice(0, this.lineCache.size - 60)) this.lineCache.delete(k);
      } finally { this.fetchingLines = false; }
      this.blocksKey = null;
      this.redraw(cx);
    });
  }

  /** An excerpt's plan (see excerptPlan) and the line number of each shown item. */
  planOf(refs, key) {
    // Kept per excerpt until the diff, the file lines read or "Show more" change: a render never plans again.
    const sig = `${JSON.stringify(refs)}|${this.expanded.has(key)}|${this.linesRead ?? 0}`;
    if (this.plans?.files !== this.owner.files) this.plans = { files: this.owner.files, map: new Map() };
    const hit = this.plans.map.get(key);
    if (hit?.sig === sig) return hit.view;
    const view = this.planFresh(refs, key);
    this.plans.map.set(key, { sig, view });
    return view;
  }

  planFresh(refs, key) {
    const o = this.owner;
    const file = o.files.find((x) => x.path === refs[0].path);
    if (!file) return null;
    const lines = this.linesOf(file);
    const plan = excerptPlan(refs, file, { lines: (side) => lines(side) || null, expanded: this.expanded.has(key) });
    if (!plan) return null;
    const side = plan.side;
    const nums = plan.items.map((x) => x.kind === "file" ? x.n : x.kind === "row"
      ? (side === "LEFT" ? file.rows[x.i].o ?? file.rows[x.i].n : file.rows[x.i].n ?? file.rows[x.i].o) : null);
    return { file, plan, nums };
  }

  /**
   * A code excerpt: the referenced diff lines at full contrast (tint, a 2 px `input` bar), with dim context around
   * them (the hunk, then the file); a header `name:start–end` with Ask (i) and Open (↵). Click a line to open it in
   * the diff; drag over lines to pick them for i. Long excerpts show their first lines and "Show N more lines".
   */
  excerpt(t, refs, key, { focused = false, onAsk = null } = {}) {
    if (!Array.isArray(refs)) refs = [refs];
    const o = this.owner;
    const ref = rangeOfRefs(refs);
    const view = this.planOf(refs, key);
    const ls = this.lineSel?.key === key ? this.lineSel : null;
    const [la, lb] = ls ? [Math.min(ls.a, ls.b), Math.max(ls.a, ls.b)] : [-1, -1];
    const ROWH = Math.round(codeSize() * 1.45);
    const shown = view ? view.nums.filter((n) => n != null) : [];
    // `name:start–end`: the range always shows; a long name loses its middle first.
    const base = ref.path.split("/").pop();
    // Room for the name: the header's width less the range, the Ask slot and Open (about 6.6 px a character).
    const range = shown.length ? `:${shown[0]}–${shown.at(-1)}`.length : 6;
    const room = Math.max(8, Math.floor((Math.min(this.width(), EXCERPT_MAX + 64) - 64 - (this.width() > 340 ? 28 : 0) - 150) / 6.6) - range);
    const name = base.length > room ? `${base.slice(0, Math.ceil(room / 2) - 1)}…${base.slice(base.length - Math.floor(room / 2))}` : base;
    const label = shown.length ? `${name}:${shown[0]}${shown.at(-1) !== shown[0] ? `–${shown.at(-1)}` : ""}` : `${name}:${refLines(ref)}`;
    const hovered = this.hover === key;
    const head = h_flex().id(`${key}-head`).h(32).py(4).px(8).gap(8).items_center().border_b(1).border_color(t.border).bg(t.raised).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(`${ref.path}:${refLines(ref)} (${ref.side === "LEFT" ? "old" : "new"} side) · ↵ opens it in the diff`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => this.navigate(ref, cx))
      .child(div().flex_none().font_family(mono()).text_size(11).text_color(t.foreground).child(label))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(ls ? `lines ${ls.nums[la] ?? ""}–${ls.nums[lb] ?? ""} picked` : base.length <= room && this.width() > 340 ? ref.path.split("/").slice(0, -1).join("/") : ""))
      // Ask and Open always show, in fixed slots.
      .child(h_flex().flex_none().gap(8).items_center()
        // Ask on an excerpt: a small fixed slot that shows on hover or focus (or picked lines); i does the same.
        .when(Boolean(onAsk), (e) => e.child(div().id(`${key}-ask`).flex_none().size(24).flex().items_center().justify_center().rounded(RADIUS.small)
          .opacity(hovered || focused || ls ? 1 : 0).cursor_pointer().hover((s) => s.bg(t.hover)).text_size(12).text_color(t.muted)
          .tooltip(ls ? "Ask about the picked lines (i)" : "Ask about these lines (i)")
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { onAsk(cx); this.redraw(cx); })
          .child("?")))
        .child(button(t, `${key}-open`, "Open", "↵", (cx) => this.navigate(ref, cx), { tip: "Open in the diff and select the lines" })));
    const numW = Math.round(codeSize() * 2.6), markW = Math.round(codeSize() * 1.1);
    const body = !view ? div().h(ROWH).px(8).text_size(12).text_color(t.dim).child("These lines are not in the current diff.")
      : v_flex().w_full().font_family(mono()).text_size(codeSize()).children(view.plan.items.map((x, k) => {
        if (x.kind === "gap") return div().id(`${key}-g${k}`).h(ROWH).w_full().pl(numW).flex().items_center().text_color(t.dim).child("⋯");
        const f = view.file;
        const row = x.kind === "row" ? o.rows[o.fileStart[o.files.indexOf(f)] + 1 + x.i] ?? f.rows[x.i] : { k: "ctx", text: x.text };
        // Context is dim and untinted; the referenced lines carry the change's tint.
        const hot = x.kind === "row" && x.hot;
        const tint = hot && row.k === "add" ? alpha(t.ansi2, "26") : hot && row.k === "del" ? alpha(t.ansi1, "26") : null;
        const emph = hot && row.k === "add" ? alpha(t.ansi2, "66") : hot && row.k === "del" ? alpha(t.ansi1, "66") : null;
        const n = view.nums[k];
        const picked = k >= la && k <= lb;
        const side = row.k === "del" ? "LEFT" : row.k === "add" ? "RIGHT" : ref.side;
        return h_flex().id(`${key}-l${k}`).relative().h(ROWH).w_full().items_center().overflow_hidden().cursor_pointer()
          .when(Boolean(tint), (e) => e.bg(tint))
          .when(picked, (e) => e.bg(t.selection))
          .hover((s) => s.bg(t.hover))
          .when(hot, (e) => e.child(div().absolute().left_0().top_0().bottom_0().w(2).bg(t.input)))
          .on_mouse_down("left", (ev, cx) => {
            cx.stop_propagation();
            this.focused = true; this.owner.focus = "agent"; this.owner.handle.focus();
            const keep = ev.modifiers?.shift && ls;
            this.lineSel = { key, ref, nums: view.nums, a: keep ? ls.a : k, b: k, dragging: true };
            this.redraw(cx);
          })
          .on_mouse_move((_e, cx) => { if (this.lineSel?.key === key && this.lineSel.dragging && this.lineSel.b !== k) { this.lineSel.b = k; this.owner.redrawCol("agent", cx); } })
          .on_mouse_up("left", (_e, cx) => {
            const s = this.lineSel;
            if (!s || s.key !== key) return;
            s.dragging = false;
            // A plain click opens that line; a drag keeps the picked lines for i.
            if (s.a === s.b) { this.lineSel = null; if (n != null) this.navigate({ path: ref.path, side, line: n }, cx); }
            this.redraw(cx);
          })
          .child(div().w(numW).flex_none().pr(4).text_right().text_color(t.dim).child(n == null ? "" : String(n)))
          .child(div().w(markW).flex_none().text_color(hot && row.k === "add" ? t.ansi2 : hot && row.k === "del" ? t.ansi1 : t.dim).child(row.k === "add" ? "+" : row.k === "del" ? "−" : " "))
          .child(hot && o.codeEl ? o.codeEl(row, t, tint, emph)
            : div().flex_1().min_w(0).whitespace_nowrap().overflow_hidden().text_color(t.dim).child(String(row.text ?? "").replace(/\t/g, "    ").replace(/ /g, "\u00a0") || " "));
      }))
      .when(view.plan.more > 0, (e) => e.child(h_flex().id(`${key}-more`).h(ROWH).w_full().pl(numW).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .font_family(uiFont()).text_size(12).text_color(t.muted)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.expanded.add(key); this.blocksKey = null; this.redraw(cx); })
        .child(`Show ${view.plan.more} more line${view.plan.more === 1 ? "" : "s"}`)));
    return v_flex().id(key).w_full().max_w(EXCERPT_MAX).rounded(RADIUS.field).overflow_hidden().border_1().border_color(focused ? t.input : t.border).bg(t.surface)
      .on_hover((h, cx) => { if (h && this.hover !== key) { this.hover = key; this.owner.redrawCol("agent", cx); } else if (!h && this.hover === key) { this.hover = null; this.owner.redrawCol("agent", cx); } })
      .child(head).child(body);
  }

  /** Blocks of a step or an answer: prose and excerpts in order (next-to-next excerpts of one file merge). */
  blocksEl(t, blocks, id, { focusedRef = -1, askFor = null } = {}) {
    let refIndex = -1;
    return v_flex().w_full().gap(8).children(mergeCodeBlocks(blocks).map((b, i) => {
      if (b.type !== "code") return this.prose(t, b.md ?? b.body ?? "", { id: `${id}-t${i}` });
      refIndex++;
      const at = refIndex;
      const range = rangeOfRefs(b.refs);
      return this.excerpt(t, b.refs, `${id}-e${at}`, { focused: at === focusedRef, onAsk: askFor ? (cx) => askFor(range, at, cx) : null });
    }));
  }
}
