// The review tab: one PR's diff (or the local checkout's) with its review threads, your draft notes and the
// Agent panel. Props: {view: "review", pr: "owner/repo#12", space} or {view: "review", local: true, space, base?, scope?}.
// The class is split by topic over the files mixed in at the end; they share its fields.
import { View, div } from "gpui-kit";
import { TextareaState, VirtualListScrollHandle, h_flex, v_flex } from "gpui-base";
import { panes, props, run, spaces, theme } from "herdr";
import * as gh from "./gh.js";
import * as sc from "./scopes.mjs";
import { asError } from "./errors.mjs";
import { mixin } from "./util.mjs";
import { HEADER, REDRAWS, button, keycap, mono, uiFont, zoom } from "./ui.js";
import { choiceEl } from "./open-in.js";
import { Scroller } from "./scroller.js";
import { claimTab, inFrame, registerTab, reviewTab, store, tabName } from "./store.js";
import { FILES_RAIL, M, metrics } from "./tab-metrics.js";
import { AgentPanel } from "./agent.js";
import { TabLoading } from "./tab-load.js";
import { TabDiff } from "./tab-diff.js";
import { TabDrafts } from "./tab-drafts.js";
import { TabEditor } from "./tab-editor.js";
import { TabKeys } from "./tab-keys.js";
import { ScopeUi } from "./scope-ui.js";
import { DiffView } from "./diff-view.js";
import { FilesView } from "./files-view.js";
import { TabChrome } from "./tab-chrome.js";

// Each column (files, diff, Agent panel) is a retained nested view: a wheel tick in one column rebuilds only that
// column. Everything else redraws all of them (redraw). The views find their tab by id.
const TABS = new Map();
const COLS = ["files", "diff", "agent"];
// Past this much of a frame, rows never drawn before show without colors until the next frame.
const COLOR_BUDGET_MS = 25;
const COLOR_MIN_ROWS = 24;

export class Column extends View {
  init(props) { this.p = props ?? {}; }
  update(props) { this.p = props ?? {}; }
  render(cx) {
    const tab = TABS.get(this.p.tab);
    if (!tab) return div();
    try { return tab.column(this.p.col, cx); }
    catch (e) { const err = asError(e, `render ${this.p.col}`); tab.view.report?.(`render:${this.p.col}`, err, cx); throw err; }
  }
}

export class ReviewTab {
  constructor(view, cx) {
    this.view = view;
    this.p = props() ?? {};
    this.local = Boolean(this.p.local);
    this.ref = this.local ? null : gh.parseKey(this.p.pr);
    this.dkey = this.local ? `local:${this.p.space}` : this.p.pr;
    this.who = { local: this.local, pr: this.p.pr ?? null, space: this.p.space };
    this.name = tabName(this.who);
    this.myTab = reviewTab(this.p.space, this.who)?.id ?? claimTab(this.p.space);
    if (this.myTab) registerTab(this.myTab, this.who);
    this.handle = cx.focus_handle();
    this.scroll = new Scroller("review-rows", { pad: 10 });
    this.fileScroll = new Scroller("review-file-rows", { pad: 8 });
    this.folds = new Map(); // path → folded (overrides the default: deleted and generated files start folded)
    this.composer = TextareaState.new({ placeholder: "Note on these lines", rows: 3 });
    this.composer.on("submit", (_e, cx) => this.saveNote(cx));
    this.summary = TextareaState.new({ placeholder: "Summary (optional)", rows: 3 });
    this.summary.on("submit", (_e, cx) => { this.summaryTyping = false; this.handle.focus(); this.redraw(cx); });
    this.summary.on("focus", (_e, cx) => { this.summaryTyping = true; this.redraw(cx); });
    this.summary.on("blur", (_e, cx) => { this.summaryTyping = false; this.redraw(cx); });
    this.meta = null;
    // The scope (scopes.mjs): null until the first load picks the default; props.scope comes from the panel's chips.
    this.scope = this.p.scope ? sc.parseScopeKey(this.p.scope) : null;
    this.prevScope = null; // where the commits segment's × goes back to
    this.info = null; // {commits (newest first), ahead, base, mergeBase, sha, root | since, newSince, viewer}
    this.picker = null; // the commit picker: {at (-1: All commits), sel: {a, b} | null, from, filter}
    this.baseMenu = null; // {at, list | null}
    this.details = new Map(); // a PR commit's stats and files, by SHA (commits never change)
    this.files = [];
    this.rows = [];
    this.error = null;
    this.loading = false;
    this.cursor = 0;
    this.anchor = null;
    this.dragging = false;
    this.pending = null; // {after, range, edit}
    this.side = "right"; // the split view's cursor side
    this.modal = null; // {kind: "palette" | "drawer" | "keys" | "close", at, event, allSpaces}
    this.flash = null;
    this.closedDirs = new Set();
    this.openThreads = new Set(); // resolved threads unfolded, open ones folded (by id)
    this.version = 0;
    this.width = 0;
    this.agent = new AgentPanel(this);
    this.focus = "diff"; // which column has the keyboard: "files", "diff" or "agent"
    this.fileCursor = 0; // the file list's row while it has the keyboard
    this.hoverRow = null; // the diff row under the pointer (its gutter shows +)
    this.loadGen = 0;
    try { this.fileHandle = VirtualListScrollHandle.new(); } catch { this.fileHandle = null; }
    this.tabId = `tab${Math.random().toString(36).slice(2)}`;
    TABS.set(this.tabId, this);
    this.redrawFn = (cx) => this.redraw(cx);
    REDRAWS.add(this.redrawFn);
    // The column views are made in a task, after the first frame: a failure there leaves the tab drawing its
    // columns itself (slower scrolling, same look) instead of failing the whole tab, as it would in init.
    this.cols = null;
    if (cx.new) cx.spawn(async (cx) => {
      await cx.sleep(0);
      const made = {};
      try {
        for (const col of ["files", "diff", "agent"]) made[col] = cx.new(Column, { tab: this.tabId, col });
        this.cols = made;
      } catch (e) {
        for (const x of Object.values(made)) { try { x.release(); } catch { /* released */ } }
        console.error(`review: column views unavailable, drawing inline: ${e?.message ?? e}`);
      }
      try { cx.notify(); } catch { /* gone */ }
    });
    this.load(cx);
    cx.spawn(async (cx) => { await cx.sleep(50); this.takeKeys(cx); });
  }

  space() {
    return spaces().find((s) => s.id === this.p.space) ?? null;
  }

  /** A smart tab turns out to be a PR's review: it takes the PR's identity (drafts, record, registry). */
  adopt(pr) {
    this.local = false;
    this.ref = gh.parseKey(pr);
    this.dkey = pr;
    this.who = { local: false, pr, space: this.p.space };
    this.name = tabName(this.who);
    // The local diff stays on screen (dimmed) until the PR's is there; nothing else of it carries over.
    this.scope = null; this.info = null; this.head = null; this.headIndex = null; this.title = null;
    this.loadedScope = null; this.loadedKey = null;
    if (this.myTab) registerTab(this.myTab, this.who);
    this.agent.resetRecord();
  }

  /**
   * This copy's pane. A tab made by `review.here` is named "review" and may not have been focused yet when the
   * copy started, so neither the registry nor its name finds it: the focused, unclaimed review tab of this
   * space is then this one (only the shown tab's copy runs).
   */
  myPane() {
    if (!this.myTab || !panes().some((p) => p.tab === this.myTab && p.mod === "review")) {
      this.myTab = reviewTab(this.p.space, this.who)?.id ?? claimTab(this.p.space) ?? this.myTab;
      if (this.myTab) registerTab(this.myTab, this.who);
    }
    return panes().find((p) => p.tab === this.myTab && p.mod === "review")?.pane ?? null;
  }

  takeKeys(cx) {
    try { this.handle.focus(); } catch { /* not drawn yet */ }
    this.redraw(cx);
  }

  /** The scope's key; the default scope (Branch, All changes) when none is picked yet. */
  scopeKey() { return sc.scopeKey(this.scope) ?? (this.local ? "branch" : "all"); }

  /** The PR head commit (a scope's own diff may end elsewhere). */
  headSha() { return this.meta?.headSha ?? this.meta?.sha ?? null; }

  /** The agent's record of this scope: the default scope keeps the review's own record. */
  akey() { return sc.isDefault(this.scope, this.local) ? this.dkey : `${this.dkey}~${this.scopeKey()}`; }

  /** Where the last scope is saved: the checkout for a local review, the PR for a PR. */
  scopeRepo(info = this.info) { return this.local ? `local:${info?.root ?? this.p.space}` : this.dkey; }

  say(text) {
    this.flash = text;
  }

  /**
   * Redraws the tab's own chrome (header, footer, dialogs) and the columns named, by default all three. A
   * column is a retained view: one that did not change keeps its last frame, so a key that only moves the
   * cursor rebuilds the diff alone.
   */
  redraw(cx, cols = COLS) {
    try { cx.notify(); } catch { /* the copy that started it is gone */ }
    if (!this.cols) return;
    for (const col of cols) { try { cx.notify(this.cols[col]); } catch { /* released */ } }
  }

  /** Redraws one column (its own scroll, hover, timer); the tab and the other columns stay as they are. */
  redrawCol(col, cx) {
    if (!this.cols) { try { cx.notify(); } catch { /* gone */ } return true; }
    try { cx.notify(this.cols[col]); } catch { try { cx.notify(); } catch { /* gone */ } }
    return true;
  }

  /** The columns a cursor move changes: the diff, and the file list when the cursor left its file. */
  movedCols(fileBefore, extra = []) {
    return this.fileAt(this.cursor) === fileBefore ? ["diff", ...extra] : ["diff", "files", ...extra];
  }

  /** The app calls this when the tab goes: a running walkthrough generation stops. */
  async close() {
    TABS.delete(this.tabId);
    REDRAWS.delete(this.redrawFn);
    for (const e of Object.values(this.cols ?? {})) { try { e.release(); } catch { /* released */ } }
    await this.agent.close();
  }

  closeTab() {
    const tab = this.myTab ?? reviewTab(this.p.space, this.who)?.id;
    if (tab) run("tab.close", { id: tab, confirmed: true });
  }

  filesWidth() {
    if (store().filesFolded) return FILES_RAIL;
    return Math.round(Math.max(180, Math.min(this.filesDragWidth ?? store().filesWidth ?? 260, 480)));
  }

  /** The diff's own width, in mod px. */
  diffWidth() { return this.width / zoom() - this.filesWidth() - this.agent.width(); }

  /** Split needs 80 characters on each side; with less room the diff shows unified. */
  splitFits() { return (this.diffWidth() / 2 - M.CODE * 4.1 - 8) / (M.CODE * 0.6) >= 80 || !this.width; }

  splitChars() {
    if (this.splitCharsAt !== this.renders) { this.splitCharsAt = this.renders; this.splitCharsN = Math.max(10, Math.floor((this.diffWidth() / 2 - M.CODE * 4.1 - 8) / (M.CODE * 0.6))); }
    return this.splitCharsN;
  }

  /** One column's element: "files", "diff" or "agent" (a nested view's render, or inline in tests). */
  column(col, cx) { return inFrame(() => this.columnFrame(col, cx)); }

  columnFrame(col, cx) {
    metrics();
    const t = theme();
    if (col === "agent") return this.agent.render(t, cx);
    if (col === "files") return this.rows.length ? this.fileList(t) : div();
    const focusedNow = (this.handle.is_focused() && this.focus === "diff") || Boolean(this.pending);
    if (this.error && !this.rows.length) {
      return v_flex().flex_1().min_w(0).items_center().justify_center().gap(8).text_color(t.foreground)
        .child(h_flex().gap(8).items_center().px(24).child(div().size(6).flex_none().rounded_full().bg(t.ansi1)).child(div().min_w(0).child(`Couldn't load the diff: ${this.error}`)))
        .child(h_flex().gap(12).items_center().child(keycap(t, "R", "try again"))
          .when(!sc.isDefault(this.scope, this.local), (e) => e.child(button(t, "error-default", this.local ? "Show branch" : "Show all changes", this.local ? "2" : "1", (cx) => this.pickSegment(this.local ? 2 : 1, cx)))));
    }
    const empty = this.loading && !this.rows.length ? null : this.emptyEl(t);
    if (empty) return empty.when(this.loading, (e) => e.opacity(0.5));
    if (!this.rows.length) return v_flex().flex_1().min_w(0).items_center().justify_center().text_color(t.dim).child(this.loading ? "Loading the diff…" : "No changes");
    this.renderPhase = "build display";
    this.buildDisplay();
    if (this.reveal && this.dispOf) {
      const r = this.reveal;
      this.reveal = null;
      const at = Math.min(this.display.length - 1, (this.dispOf[r.row] ?? 0) + (r.after ? 1 : 0));
      if (r.top) { this.scroll.top = this.scroll.offsets[at] ?? 0; this.scroll.clamp(); } else this.scroll.reveal(at, r);
    }
    const display = this.display;
    const split = this.split();
    this.renderPhase = "diff rows";
    // A scope switch keeps the old diff, dimmed, until the new one is there: nothing jumps.
    const dim = this.loading && !this.quiet;
    // The budget starts here, not at the frame start: a slow display build must not leave every row plain.
    // At least COLOR_MIN_ROWS cold rows get colors per frame, so the follow-up frames always finish.
    this.colorBudget = { until: Date.now() + COLOR_BUDGET_MS, left: COLOR_MIN_ROWS, later: false };
    const rows = this.scroll.view(t, (i) => {
      const d = display[i];
      if (typeof d === "number") {
        if (!split) return this.rowEl(d, t, focusedNow, cx);
        const sr = this.srows[d];
        return sr.only !== undefined ? this.rowEl(sr.only, t, focusedNow, cx) : this.pairEl(d, t, focusedNow, cx);
      }
      if (d.composer) return this.composerEl(t);
      if (d.note) return this.noteEl(d.note, t);
      if (d.chip) return this.chipEl(d.chip, t);
      if (d.thread) return this.threadEl(d.thread, t);
      if (d.folded !== undefined) return this.foldedEl(d.folded, t);
      return div();
    });
    if (this.colorBudget.later) cx.spawn(async (cx) => { await cx.sleep(0); this.redrawCol("diff", cx); });
    this.colorBudget = null;
    return v_flex().id("review-diff").relative().flex_1().min_w(0).h_full().min_h(0).bg(t.background)
      .when(dim, (e) => e.opacity(0.5))
      .font_family(mono()).text_size(M.CODE)
      .child(rows)
      // A slow load shows a moving bar over the top edge: it floats, so nothing below moves.
      .when(dim && Boolean(this.slow), (e) => e.child(div().absolute().top_0().left_0().right_0().h(2).overflow_hidden()
        .child(div().h(2).w(160).bg(t.accent).loop("left", { from: -160, to: 1600, period: 1200 }))));
  }

  render(cx) { return inFrame(() => this.renderFrame(cx)); }

  renderFrame(cx) {
    this.renderPhase = "metrics";
    this.renders = (this.renders ?? 0) + 1;
    metrics();
    const t = theme();
    this.renderPhase = "columns";
    // The columns are nested views (retained); without them (tests) they are drawn here.
    const col = (name) => (this.cols ? this.cols[name] : this.column(name, cx));
    const body = h_flex().flex_1().min_w(0).min_h(0).items_stretch().overflow_hidden()
      .child(col("files"))
      .child(this.cols ? h_flex().flex_1().min_w(0).h_full().min_h(0).child(col("diff")) : col("diff"))
      .child(col("agent"));
    this.renderPhase = "top bar";
    const topBar = this.topBar(t);
    const banner = this.bannerEl(t);
    this.renderPhase = "footer";
    const footer = this.footer(t);
    this.renderPhase = "frame";
    return v_flex().id("review-tab").relative().size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .font_family(uiFont())
      .track_focus(this.handle)
      .on_mouse_down("left", (_e, cx) => {
        // The clicked control redraws what it changed; here only a focus leaving the Agent panel does.
        const a = this.agent, changed = a.focused || a.providerMenu || a.threadsMenu || this.focus === "agent";
        a.focused = false; a.providerMenu = false; a.threadsMenu = false;
        if (this.focus === "agent") this.focus = "diff";
        if (!this.pending && !this.modal) this.handle.focus();
        if (changed) this.redraw(cx, ["agent"]);
      })
      .on_mouse_up("left", (_e, cx) => this.up(cx))
      .on_mouse_move((e, cx) => {
        if (this.agent.dragMove(e, cx)) return;
        if (this.filesDrag) { this.filesDragWidth = this.filesDrag.w + (e.position.x - this.filesDrag.x) / zoom(); this.redraw(cx); }
      })
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; this.redraw(cx); } })
      .on_key_down((e, cx) => {
        this.dirty = null;
        if (this.key(e, cx)) { cx.stop_propagation(); this.redraw(cx, this.dirty ?? COLS); }
        this.dirty = null;
      })
      .child(topBar)
      .when(Boolean(banner), (e) => e.child(banner))
      .child(body)
      .child(footer)
      .when(Boolean(this.openChoice), (e) => e.child(div().absolute().top(HEADER + 6).right(12).child(choiceEl(t, this, (cx) => this.redraw(cx, [])))))
      .when(Boolean(this.modal), (e) => e.child(this.modalEl(t)));
  }
}

mixin(ReviewTab, TabLoading, TabDiff, TabDrafts, TabEditor, TabKeys, ScopeUi, DiffView, FilesView, TabChrome);
