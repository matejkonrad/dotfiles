// The scope control in the header: the segments, the commit picker, the base menu, and the scope's banner and empty states.
import { div, svg } from "gpui-kit";
import { Popover, h_flex, v_flex } from "gpui-base";
import * as gh from "./gh.js";
import { baseChoices } from "./diff.js";
import * as sc from "./scopes.mjs";
import { RADIUS } from "./style.js";
import { CLEAR, age, button, iconOf, keycap, mono, uiFont } from "./ui.js";
import { setLocalBase } from "./store.js";

export class ScopeUi {
  /** ⌘K: every scope by name, and the branch's commits. */
  scopeActions(act) {
    const list = this.info?.commits ?? [];
    const out = this.local
      ? [act("Scope: Uncommitted", "1", (cx) => this.pickSegment(1, cx)), act(`Scope: Branch vs ${this.info?.base ?? "the base"}`, "2", (cx) => this.pickSegment(2, cx)),
        act("Scope: Commits…", "3", (cx) => this.openPicker(cx)), act("Base branch…", "B", (cx) => this.openBaseMenu(cx))]
      : [act("Scope: All changes", "1", (cx) => this.pickSegment(1, cx)), act("Scope: Since review", "2", (cx) => this.pickSegment(2, cx)),
        act("Scope: Commits…", "3", (cx) => this.openPicker(cx))];
    list.slice(0, 30).forEach((c, i) => out.push(act(`Scope: commit ${c.short} ${c.subject}`, "", (cx) => this.setScope(sc.commitsScope(list, i), cx))));
    return out;
  }

  /** 3: the commit picker, on the shown scope's commits. A PR's commits get their stats and files (once). */
  openPicker(cx) {
    const list = this.info?.commits ?? [];
    if (!list.length) return this.say(this.local ? `This branch has no commits ahead of ${(this.info?.base ?? "its base").replace(/^origin\//, "")}` : "No commits yet");
    this.baseMenu = null;
    const rows = sc.rowsOfScope(list, this.scope);
    this.picker = { at: rows ? rows[0] : -1, sel: rows ? { a: rows[0], b: rows[1] } : null, from: rows ? rows[0] : null, filter: "" };
    if (!this.local) this.fetchDetails(cx);
  }

  /** GitHub's commit list has no stats or files: the newest 40 commits get them, 6 calls at a time. */
  fetchDetails(cx) {
    const want = (this.info?.commits ?? []).slice(0, 40).filter((c) => c.files === null && !this.details.has(c.sha));
    if (!want.length || this.detailsBusy) return;
    this.detailsBusy = true;
    cx.spawn(async (cx) => {
      try {
        for (let i = 0; i < want.length; i += 6) {
          await Promise.all(want.slice(i, i + 6).map(async (c) => {
            try {
              const g = sc.ghCommit(await gh.fetchCommit(this.ref.repo, c.sha));
              const d = { additions: g.additions, deletions: g.deletions, files: g.files };
              this.details.set(c.sha, d);
              Object.assign(c, d);
            } catch { /* keep the row without stats */ }
          }));
          this.redraw(cx);
        }
      } finally { this.detailsBusy = false; }
    });
  }

  /** The picker's rows: -1 (All commits), then the commits (newest first) that match the filter. */
  pickerRows() {
    const q = (this.picker?.filter ?? "").toLowerCase();
    const list = this.info?.commits ?? [];
    const out = [-1];
    list.forEach((c, i) => { if (!q || c.sha.startsWith(q) || c.subject.toLowerCase().includes(q)) out.push(i); });
    return out;
  }

  /** ↵: the range, else the row under the cursor; All commits goes back to the whole branch. */
  applyPicker(cx) {
    const p = this.picker, list = this.info?.commits ?? [];
    if (!p) return;
    if (p.sel) return this.setScope(sc.commitsScope(list, p.sel.a, p.sel.b), cx);
    this.setScope(p.at < 0 ? { kind: this.local ? "branch" : "all" } : sc.commitsScope(list, p.at), cx);
  }

  /** A click picks one commit; Shift+click extends the range (↵ or Apply shows it). */
  clickCommit(i, e, cx) {
    const p = this.picker, list = this.info?.commits ?? [];
    if (!p) return;
    if (i < 0) return this.setScope({ kind: this.local ? "branch" : "all" }, cx);
    if (e?.modifiers?.shift) {
      const from = p.from ?? (p.at >= 0 ? p.at : i);
      p.from = from; p.at = i; p.sel = { a: Math.min(from, i), b: Math.max(from, i) };
      return;
    }
    this.setScope(sc.commitsScope(list, i), cx);
  }

  pickerKey(e, cx) {
    const mods = e.modifiers ?? {}, k = e.key, p = this.picker;
    if (mods.platform || mods.control) return false;
    const rows = this.pickerRows();
    if (k === "escape") { this.picker = null; return true; }
    if (k === "up" || k === "down") {
      const pos = Math.max(0, rows.indexOf(p.at));
      const next = rows[Math.max(0, Math.min(rows.length - 1, pos + (k === "down" ? 1 : -1)))];
      if (mods.shift && next >= 0) {
        if (p.from == null) p.from = p.at >= 0 ? p.at : next;
        p.sel = { a: Math.min(p.from, next), b: Math.max(p.from, next) };
      } else if (!mods.shift) p.from = next >= 0 ? next : null;
      p.at = next;
      return true;
    }
    if (k === "space") { if (p.at >= 0) { p.sel = sc.toggleRow(p.sel, p.at); p.from = p.at; } return true; }
    if (k === "enter") { this.applyPicker(cx); return true; }
    if (k === "backspace") { p.filter = p.filter.slice(0, -1); p.at = this.pickerRows()[1] ?? -1; return true; }
    const ch = e.key_char ?? (k.length === 1 ? (mods.shift ? k.toUpperCase() : k) : null);
    if (ch && ch.length === 1 && ch >= " ") { p.filter += ch; p.at = this.pickerRows()[1] ?? -1; }
    return true;
  }

  /** B: the base of the local Branch scope: the default bases, the PR's base, recent branches. Saved per checkout. */
  openBaseMenu(cx) {
    if (!this.local) return this.say("B picks the base branch of a local review");
    if (!this.info?.root) return;
    this.picker = null;
    this.baseMenu = { at: 0, list: null };
    cx.spawn(async (cx) => {
      const list = await baseChoices(this.info.root, this.info.on, this.p.base).catch(() => []);
      if (!this.baseMenu) return;
      this.baseMenu.list = list;
      this.baseMenu.at = Math.max(0, list.findIndex((b) => b.ref === this.info?.base));
      this.redraw(cx);
    });
  }

  chooseBase(ref, cx) {
    this.baseMenu = null;
    if (!ref || !this.info?.root) return;
    setLocalBase(this.info.root, ref);
    if (this.scopeKey() !== "branch") this.setScope({ kind: "branch" }, cx);
    else this.load(cx, { force: true });
  }

  baseKey(e, cx) {
    const m = this.baseMenu, list = m.list ?? [];
    if (e.key === "escape") { this.baseMenu = null; return true; }
    if (e.key === "up" || e.key === "k") m.at = Math.max(0, m.at - 1);
    else if (e.key === "down" || e.key === "j") m.at = Math.min(list.length - 1, m.at + 1);
    else if (e.key === "enter") this.chooseBase(list[m.at]?.ref, cx);
    return true;
  }

  /** One segment of the scope control: a fixed width (nothing moves when a label changes), the label truncates. */
  segment(t, id, w, on, { disabled = false, tip = null, click = null } = {}, kids) {
    return h_flex().id(`scope-${id}`).w(w).flex_none().h(24).px(8).gap(4).items_center().rounded(RADIUS.row).text_size(12).overflow_hidden()
      .bg(on ? t.selected : CLEAR)
      .text_color(disabled ? t.dim : on ? t.foreground : t.muted)
      .when(!on && !disabled && Boolean(click), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
      .when(Boolean(tip), (e) => e.tooltip(tip))
      .when(Boolean(click), (e) => e.on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((ev, cx) => { if (!disabled) click(ev, cx); this.redraw(cx); }))
      .children(kids);
  }

  /** The scope control: Uncommitted · Branch vs main ▾ · Commits ▾ (local), All changes · Since review · Commits ▾ (PR). */
  scopeControl(t) {
    const k = this.scopeKey();
    const commits = sc.isCommits(this.scope);
    const segs = [];
    if (this.local) {
      segs.push(this.segment(t, "uncommitted", 104, k === "uncommitted", { tip: "The working tree and untracked files vs HEAD (1)", click: (_e, cx) => this.pickSegment(1, cx) }, ["Uncommitted"]));
      const base = this.info?.base ?? "base";
      const baseTrigger = h_flex().id("scope-base").min_w(0).h(20).px(4).gap(4).items_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
        .text_color(k === "branch" ? t.muted : t.dim).tooltip("The base branch (B)")
        .child(div().min_w(0).truncate().child(`vs ${base}`)).child(div().flex_none().child("▾"));
      const baseMenu = Popover.new("scope-base-menu").anchor("top_left").open(Boolean(this.baseMenu)).track_focus(this.handle)
        .on_open_change((open, cx) => { if (open && !this.baseMenu) this.openBaseMenu(cx); if (!open) this.baseMenu = null; this.redraw(cx); })
        .trigger(baseTrigger).content(this.baseMenu ? this.baseMenuEl(t) : div());
      segs.push(this.segment(t, "branch", 184, k === "branch", { tip: "Everything since the merge-base with the base branch, the working tree included (2)" }, [
        div().id("scope-branch-label").flex_none().cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { this.pickSegment(2, cx); this.redraw(cx); }).child("Branch"),
        div().min_w(0).flex_1().child(baseMenu)]));
    } else {
      segs.push(this.segment(t, "all", 104, k === "all", { tip: "The PR's diff (1)", click: (_e, cx) => this.pickSegment(1, cx) }, ["All changes"]));
      const since = this.info?.since;
      segs.push(this.segment(t, "since", 112, k === "since", { disabled: !since,
        tip: since ? `Changes since ${since.from === "review" ? "your last review" : "the last commit you viewed"} (${since.sha.slice(0, 7)}) (2)` : "Nothing reviewed yet",
        click: (_e, cx) => this.pickSegment(2, cx) }, ["Since review"]));
    }
    const label = commits ? sc.commitsLabel(this.scope) : "Commits";
    const trigger = h_flex().id("scope-commits-open").flex_1().min_w(0).h(20).gap(4).items_center().cursor_pointer()
      .child(div().min_w(0).truncate().when(commits && this.scope.from === this.scope.to, (e) => e.font_family(mono())).child(label))
      .when(!commits, (e) => e.child(div().flex_none().child("▾")));
    const picker = Popover.new("scope-commits-menu").anchor("top_left").open(Boolean(this.picker)).track_focus(this.handle)
      .on_open_change((open, cx) => { if (open && !this.picker) this.openPicker(cx); if (!open) this.picker = null; this.redraw(cx); })
      .trigger(trigger).content(this.picker ? this.pickerEl(t) : div());
    segs.push(this.segment(t, "commits", 132, commits, { tip: commits ? `${label} (3: pick again)` : "One commit or a range (3)" }, [
      div().flex_1().min_w(0).child(picker),
      ...(commits ? [div().id("scope-commits-clear").flex_none().size(16).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("Back to the scope before").on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.setScope(this.prevScope ?? { kind: this.local ? "branch" : "all" }, cx); this.redraw(cx); })
        .child(svg(iconOf("x")).size(10).text_color(t.dim))] : [])]));
    return h_flex().id("scope-control").flex_none().rounded(RADIUS.field).overflow_hidden().border_1().border_color(t.border).children(segs);
  }

  /** The commit picker: All commits, then one row per commit, newest first, like GitHub's commit menu. */
  pickerEl(t) {
    const p = this.picker, list = this.info?.commits ?? [];
    const marks = this.viewedMarks();
    const rows = this.pickerRows();
    const font = mono();
    const inSel = (i) => p.sel && i >= p.sel.a && i <= p.sel.b;
    const row = (i) => {
      const at = i === p.at;
      const base = h_flex().id(`commit-row-${i}`).relative().h(28).flex_none().px(8).gap(8).items_center().rounded(RADIUS.row).cursor_pointer()
        .bg(inSel(i) ? t.selected : CLEAR).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((e, cx) => { this.clickCommit(i, e, cx); this.redraw(cx); })
        .when(at, (e) => e.child(div().absolute().top(4).bottom(4).left_0().w(3).rounded(RADIUS.row).bg(t.input)));
      if (i < 0) {
        const all = sc.isDefault(this.scope, this.local);
        return base.child(div().w(8).flex_none())
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child("All commits"))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(this.local ? `the whole branch · ${list.length}` : `the whole PR · ${list.length}`))
          .child(div().w(12).flex_none().text_size(11).text_color(t.muted).child(all ? "✓" : ""));
      }
      const c = list[i];
      const seen = sc.commitViewed(marks, c);
      return base
        .child(div().id(`commit-seen-${i}`).w(8).flex_none().flex().items_center().justify_center()
          .when(seen, (e) => e.tooltip("You viewed every file of this commit").child(div().size(6).rounded_full().bg(t.muted))))
        .child(div().w(56).flex_none().truncate().font_family(font).text_size(11).text_color(t.dim).child(c.short))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(c.subject))
        .when(Boolean(c.merged), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`in ${String(this.info?.base ?? "base").replace(/^origin\//, "")}`)))
        .child(div().w(88).flex_none().truncate().text_size(11).text_color(t.dim).child(c.author))
        .child(div().w(28).flex_none().text_right().text_size(11).text_color(t.dim).child(c.at ? age(c.at) : ""))
        .child(div().w(40).flex_none().text_right().text_size(11).text_color(c.additions ? t.ansi2 : t.dim).child(c.additions == null ? "" : `+${c.additions}`))
        .child(div().w(40).flex_none().text_right().text_size(11).text_color(c.deletions ? t.ansi1 : t.dim).child(c.deletions == null ? "" : `−${c.deletions}`));
    };
    const n = p.sel ? p.sel.b - p.sel.a + 1 : 0;
    return v_flex().id("commits-picker").w(600).mt(4).rounded(RADIUS.float).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .font_family(uiFont()).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(svg(iconOf("search")).size(12).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_color(p.filter ? t.foreground : t.dim).child(p.filter ? p.filter : "Type to filter by subject or SHA"))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`${list.length} commit${list.length === 1 ? "" : "s"}`)))
      .child(v_flex().id("commits-list").max_h(336).overflow_y_scrollbar().p(4).gap(0)
        .children(rows.map(row))
        .when(rows.length === 1 && Boolean(p.filter), (e) => e.child(div().p(8).text_size(12).text_color(t.dim).child("No commit matches."))))
      .child(h_flex().h(36).flex_none().px(12).gap(12).items_center().border_t(1).border_color(t.border)
        .child(keycap(t, "↑↓", "move")).child(keycap(t, "⇧↑↓", "range")).child(keycap(t, "Space", "add")).child(keycap(t, "esc", "close"))
        .child(div().flex_1())
        .child(button(t, "commits-apply", n > 1 ? `Show ${n} commits` : "Show", "↵", (cx) => this.applyPicker(cx), { primary: n > 1 })));
  }

  baseMenuEl(t) {
    const m = this.baseMenu;
    const list = m.list;
    return v_flex().id("base-menu").w(280).mt(4).p(4).rounded(RADIUS.float).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .font_family(uiFont()).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(div().h(24).px(8).flex().items_center().text_size(11).text_color(t.dim).child("Compare the branch with"))
      .when(!list, (e) => e.child(div().h(28).px(8).flex().items_center().text_size(12).text_color(t.dim).child("Reading the branches…")))
      .children((list ?? []).map((b, i) => h_flex().id(`base-${i}`).relative().h(28).px(8).gap(8).items_center().rounded(RADIUS.row).cursor_pointer()
        .bg(i === m.at ? t.selected : CLEAR).hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.chooseBase(b.ref, cx); this.redraw(cx); })
        .when(i === m.at, (e) => e.child(div().absolute().top(4).bottom(4).left_0().w(3).rounded(RADIUS.row).bg(t.input)))
        .child(div().w(12).flex_none().text_size(11).text_color(t.muted).child(b.ref === this.info?.base ? "✓" : ""))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(b.ref))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(b.note))))
      .child(h_flex().h(28).px(8).gap(12).items_center().child(keycap(t, "↑↓", "move")).child(keycap(t, "↵", "pick")).child(keycap(t, "esc", "close")));
  }

  /** "2 new commits since your review": under the header, while Since review shows them. */
  bannerEl(t) {
    const i = this.info;
    if (this.local || this.bannerClosed || this.scopeKey() !== "since" || !i?.newSince) return null;
    const n = i.newSince;
    return h_flex().id("since-banner").h(32).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).bg(t.raised).text_size(12)
      .child(div().size(6).flex_none().rounded_full().bg(t.foreground))
      .child(div().text_color(t.foreground).child(`${n} new commit${n === 1 ? "" : "s"} since your ${i.since?.from === "viewed" ? "last viewed commit" : "review"}`))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`from ${i.since.sha.slice(0, 7)} to ${this.headSha()?.slice(0, 7) ?? ""}`))
      .child(button(t, "since-all", "All changes", "1", (cx) => this.pickSegment(1, cx)))
      .child(div().id("since-close").size(20).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Hide")
        .on_click((_e, cx) => { this.bannerClosed = true; this.redraw(cx); }).child(svg(iconOf("x")).size(10).text_color(t.dim)));
  }

  /** The diff's empty state for the scope, with the scope to try instead. Null: the plain "No changes". */
  emptyEl(t) {
    // A scope with rows always shows them; an empty state is only for nothing to show.
    if (this.rows.length) return null;
    const k = this.scopeKey(), i = this.info ?? {};
    const say = (text, sub, label, key, go) => v_flex().flex_1().min_w(0).items_center().justify_center().gap(12).font_family(uiFont())
      .child(div().text_size(13).text_color(t.foreground).child(text))
      .when(Boolean(sub), (e) => e.child(div().text_size(12).text_color(t.dim).child(sub)))
      .when(Boolean(label), (e) => e.child(button(t, "empty-go", label, key, go)));
    const base = (i.base ?? "the base").replace(/^origin\//, "");
    if (k === "uncommitted") return say("No uncommitted changes", "The working tree matches the last commit.", "Show branch", "2", (cx) => this.pickSegment(2, cx));
    // Only with nothing to show: a branch with no commits ahead still shows its uncommitted changes (scopeNote says so).
    if (k === "branch" && this.local && this.info && !i.ahead) return say(i.merged ? `This branch is already merged into ${base}` : `This branch has no commits ahead of ${base}`,
      i.merged ? "Its commits are under Commits (3)." : null, i.merged ? "Pick commits" : "Show uncommitted", i.merged ? "3" : "1", (cx) => (i.merged ? this.openPicker(cx) : this.pickSegment(1, cx)));
    if (k === "since") return say("No changes since your review", null, "Show all changes", "1", (cx) => this.pickSegment(1, cx));
    if (sc.isCommits(this.scope)) return say("This commit changes no lines", null, "Pick commits", "3", (cx) => this.openPicker(cx));
    return null;
  }

  /** What the scope compares, in words, for the header. */
  scopeLine() {
    const k = this.scopeKey(), base = this.info?.base ?? this.meta?.base ?? "the base";
    if (k === "uncommitted") return "working tree vs HEAD";
    // In the header's own line, so nothing moves: a branch with no commits ahead shows only uncommitted changes.
    if (k === "branch" && this.info && !this.info.ahead && this.rows.length) {
      const short = String(base).replace(/^origin\//, "");
      return this.info.merged ? `Already merged into ${short}. Showing uncommitted changes.` : `No commits ahead of ${short}. Showing uncommitted changes.`;
    }
    if (k === "branch") return `working tree vs the merge-base with ${base}`;
    if (sc.isCommits(this.scope)) {
      const c = (this.info?.commits ?? []).find((x) => x.sha === this.scope.to);
      return this.scope.from === this.scope.to ? `${this.scope.to.slice(0, 7)} ${c?.subject ?? ""}` : `${this.scope.from.slice(0, 7)}^ to ${this.scope.to.slice(0, 7)}`;
    }
    return "";
  }
}
