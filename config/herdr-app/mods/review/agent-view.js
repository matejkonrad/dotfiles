// The Agent panel's frame: the tab bar, the agent and version bar, the blocks of a step or a thread, the input.
import { div, svg } from "gpui-kit";
import { Textarea, h_flex, v_flex } from "gpui-base";
import { RADIUS } from "./style.js";
import { CLEAR, HEADER, age, button, iconOf, keycap, mono, uiFont, zoom } from "./ui.js";
import { draftsOf, edit, read, store } from "./store.js";
import { refLabel, stepBlocks, stepRefs, unread } from "./walkthrough-model.mjs";
import { PROVIDERS, providerOf } from "./providers.mjs";

export const MIN_WIDTH = 300;
export const AGENT_RAIL = 36;

export class AgentView {
  width() {
    if (this.folded()) return AGENT_RAIL;
    const tab = this.owner.width / zoom();
    const want = this.dragWidth ?? store().agentWidth ?? 380;
    return Math.round(Math.max(MIN_WIDTH, Math.min(want, Math.max(MIN_WIDTH, tab - 520))));
  }

  dragMove(e, cx) {
    if (!this.drag) return false;
    this.dragWidth = Math.max(MIN_WIDTH, this.drag.w - (e.position.x - this.drag.x) / zoom());
    this.owner.redraw(cx);
    return true;
  }

  dragEnd() {
    if (!this.drag) return;
    this.drag = null;
    const w = Math.round(this.dragWidth ?? this.width());
    this.dragWidth = null;
    edit((st) => { st.agentWidth = w; });
  }

  /** The content as blocks, built once per record, tab, step and focus (not on every redraw). */
  blocks() {
    const r = this.record, th = this.tab === "walk" ? null : this.thread();
    const key = `${r?.at ?? "none"}|${this.tab}|${this.step}|${this.link}|${this.entry}|${this.running?.tab ?? ""}|${this.running?.question ?? ""}|${this.width()}|${JSON.stringify(this.lineSel)}|${this.hover}|${this.showAnyway}|${this.installed?.join()}|${this.version()?.id}|${th?.entries.length}`;
    if (this.blocksKey === key && this.blockList) return this.blockList;
    this.blocksKey = key;
    const out = [];
    if (this.tab === "walk") {
      const w = this.walk();
      if (!w) out.push({ kind: "empty", key: "empty" });
      else {
        out.push({ kind: "label", text: "Overview", key: "overview-label" });
        out.push({ kind: "summary", text: w.summary, key: `summary-${this.version().id}` });
        w.steps.forEach((step, i) => out.push({ kind: "step", i, step, key: `step-${this.version().id}-${i}` }));
      }
    } else if (th) {
      out.push({ kind: "anchor", th, key: `anchor-${th.id}` });
      th.entries.forEach((e, i) => out.push({ kind: "entry", e, i, key: `entry-${e.id}` }));
      if (this.running?.tab === th.id && this.running.question) out.push({ kind: "entry", e: { role: "question", body: this.running.question, at: this.running.startedAt }, i: -2, key: "pending" });
      if (!th.entries.length && !this.running) out.push({ kind: "hint", key: "hint" });
    }
    this.blockList = out;
    return out;
  }

  /**
   * A step of the narrative: number, title, its prose and code excerpts, always open (selecting never moves
   * anything). The selected step only gets the `selected` background.
   */
  stepEl(t, b) {
    const selected = b.i === this.step;
    const filesOf = [...new Set(stepRefs(b.step).map((r) => r.path))];
    const threads = this.threads().filter((th) => th.anchor.step === b.i && th.entries.length);
    const done = filesOf.length > 0 && filesOf.every((p) => this.owner.pathViewed?.(p) ?? (draftsOf(this.owner.dkey).viewed ?? []).includes(p));
    const pick = (cx) => { this.step = b.i; this.picked = true; this.link = -1; this.lineSel = null; this.focused = true; this.owner.focus = "agent"; this.owner.handle.focus(); this.redraw(cx, true); };
    const focusedHere = selected && this.focused && this.link === -1;
    // No box: the selected step is a `selected` band with a 2 px rule on the left; the focus frame is always reserved.
    return v_flex().id(`walk-step-${b.i}`).relative().w_full().p(12).gap(8).rounded(RADIUS.row).border_1().border_color(focusedHere ? t.input : CLEAR).bg(selected ? t.selected : CLEAR)
      .when(selected, (e) => e.child(div().absolute().top_0().bottom_0().left_0().w(2).bg(t.muted)))
      .child(h_flex().id(`walk-step-${b.i}-head`).w_full().min_h(24).gap(8).items_start().rounded(RADIUS.row).cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("Select this step (j / k)").on_click((_e, cx) => pick(cx))
        // The number stays neutral; the accent is only the selected step's digit.
        .child(div().w(20).h(20).flex_none().flex().items_center().justify_center().rounded(RADIUS.small).text_size(11).font_semibold()
          .bg(t.raised).text_color(selected ? t.accent : t.muted).child(done ? "✓" : String(b.i + 1)))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(div().w_full().text_size(13).font_semibold().text_color(t.foreground).child(b.step.title))
          // The thread count goes under the title, so a long title keeps the width.
          .when(threads.length > 0, (e) => e.child(h_flex().child(div().id(`walk-step-${b.i}-threads`).flex_none().h(20).px(4).flex().items_center().rounded(RADIUS.small).border_1().border_color(t.border)
            .cursor_pointer().hover((s) => s.bg(t.hover)).text_size(11).text_color(t.muted).tooltip("Open this step's threads (t)")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { this.select(threads[0].id, cx); this.redraw(cx, true); })
            .child(`${threads.length} thread${threads.length === 1 ? "" : "s"}`)))))
        .child(button(t, `walk-step-${b.i}-ask`, "Ask", "i", (cx) => { this.step = b.i; this.link = -1; this.ask({ step: b.i }, cx); }, { tip: "Ask about this step, in a new thread" })))
      .child(div().w_full().pl(this.width() > 340 ? 28 : 0).child(this.blocksEl(t, stepBlocks(b.step), `s${b.i}`, { focusedRef: selected && this.focused ? this.link : -2,
        askFor: (ref, at, cx) => { this.step = b.i; this.link = at; this.ask({ ...ref }, cx); } })));
  }

  entryEl(t, b) {
    const e = b.e;
    const focusedHere = b.i === this.entry && this.focused;
    const label = e.role === "question" ? `Question · ${age(e.at)}` : `Answer · ${providerOf(e.provider)?.name ?? "Agent"} · ${age(e.at)}`;
    return v_flex().id(`entry-${b.key}`).w_full().py(12).gap(8).border_t(b.i === 0 ? 0 : 1).border_color(t.border)
      .child(h_flex().h(20).gap(8).items_center()
        .child(div().text_size(11).text_color(t.dim).child(label))
        .child(div().flex_1())
        .when(e.role === "answer" && b.i >= 0, (x) => x.child(button(t, `entry-${b.key}-note`, "Note", "c", (cx) => { this.entry = b.i; this.noteFromAnswer(cx); }, { tip: "Turn this answer into a draft review note on the thread's lines" }))))
      .child(div().w_full().pl(8).border_l(2).border_color(focusedHere ? t.input : CLEAR)
        .child(e.role === "question" ? this.prose(t, e.body, { id: `q-${b.key}` }) : this.blocksEl(t, e.blocks ?? [], `a-${b.key}`)));
  }

  anchorEl(t, th) {
    const a = th.anchor;
    const stale = this.threadStale(th);
    const pr = this.owner.local ? "Local changes" : `PR ${this.owner.name}`;
    const label = a.path ? `${refLabel(a)} · ${a.side === "LEFT" ? "old" : "new"}` : a.step != null ? `${pr} · step ${a.step + 1}${this.steps()[a.step] ? `: ${this.steps()[a.step].title}` : ""}` : pr;
    return v_flex().w_full().gap(8).pb(8)
      .child(h_flex().gap(8).items_center()
        .child(h_flex().id(`anchor-${th.id}`).h(24).px(8).gap(8).items_center().rounded(RADIUS.small).border_1().border_color(t.border).bg(t.surface).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip(a.path ? `${a.path} · ↵ opens it in the diff` : a.step != null ? "↵ shows the step" : "This thread is about the whole PR")
          .on_click((_e, cx) => { if (a.path) this.navigate(a, cx); else if (a.step != null) { this.select("walk", cx); this.step = a.step; this.revealStep = true; } this.owner.redraw(cx); })
          .child(div().max_w(260).truncate().font_family(a.path ? mono() : uiFont()).text_size(11).text_color(t.foreground).child(label))
          .child(keycap(t, "↵"))))
      .when(stale, (e) => e.child(h_flex().h(24).px(8).gap(8).items_center().rounded(RADIUS.row).bg(t.surface).text_size(12).text_color(t.muted)
        .child(div().size(6).rounded_full().bg(t.ansi3)).child("These lines changed after a push. The answers are about the old code.")));
  }

  blockEl(t, b) {
    switch (b.kind) {
      case "empty": {
        const none = this.installed && !this.installed.length;
        const busy = this.running?.action === "generate";
        return v_flex().w_full().pt(24).px(8).gap(12).items_center()
          .child(div().text_size(13).text_color(t.muted).text_center().child(none ? "No agent CLI is installed." : busy ? "Writing the walkthrough…" : "Get a short tour of the changes that matter most."))
          .when(!busy && !none, (e) => e.child(button(t, "walk-generate", "Generate", "↵", (cx) => this.regenerate(cx), { primary: true, disabled: !this.provider() })))
          .child(div().text_size(11).text_color(t.dim).text_center().child(none ? "Install one of: Claude Code (claude), Codex (codex), OpenCode (opencode)."
            : busy ? "Esc cancels" : `${this.providerName()} · read-only · about 1 min`))
          // Loading: fixed-height skeleton rows where the narrative comes.
          .when(busy, (e) => e.child(v_flex().w_full().pt(12).gap(8).children([0.9, 0.7, 0.8, 0.5, 0.85].map((f, i) =>
            div().id(`skeleton-${i}`).h(12).w(Math.round((this.width() - 48) * f)).rounded(RADIUS.small).bg(t.surface).loop("opacity", { from: 0.4, to: 1, period: 1200 })))));
      }
      case "label":
        return div().w_full().h(20).text_size(11).text_color(t.dim).child(b.text);
      case "summary":
        return div().w_full().pb(12).child(this.prose(t, b.text, { id: "summary" }));
      case "step": return this.stepEl(t, b);
      case "anchor": return this.anchorEl(t, b.th);
      case "entry": return this.entryEl(t, b);
      case "hint":
        return div().w_full().py(12).text_size(12).text_color(t.dim).child("Ask about these lines below. Enter sends.");
      default:
        return div();
    }
  }

  /** One line under the tabs: an error, or a stale walkthrough. Always the same height when shown. */
  banner(t) {
    const line = (dot, text, extra = null) => h_flex().id("agent-banner").h(32).flex_none().px(12).gap(8).items_center().bg(t.surface).border_b(1).border_color(t.border).text_size(12)
      .child(div().size(6).flex_none().rounded_full().bg(dot))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(text))
      .when(Boolean(extra), (e) => e.child(extra));
    if (this.error) return line(t.ansi1, this.error, h_flex().gap(8)
      .when(/fail|Cancel|changed|took/.test(this.error), (e) => e.child(button(t, "retry", "Retry", "r", (cx) => this.regenerate(cx))))
      .child(button(t, "error-x", "Dismiss", "esc", (cx) => { this.error = null; this.redraw(cx); }))).tooltip(this.error);
    if (this.tab === "walk" && this.stale() && !this.showAnyway) return line(t.ansi3, "New commits since this walkthrough.", h_flex().gap(8)
      .child(button(t, "stale-regenerate", "Regenerate", "r", (cx) => this.regenerate(cx)))
      .child(button(t, "show-anyway", "Show anyway", "↵", (cx) => { this.showAnyway = true; })));
    return null;
  }

  /** The tab bar: Walkthrough, then the threads, each with its state dot. */
  tabBar(t) {
    const tabW = (id) => (id === "walk" ? 104 : 40 + Math.min(110, Math.ceil(String(this.thread(id)?.title ?? "").length * 6.4)) + 22);
    const tabEl = (id, i, maxW = 170) => {
      const th = id === "walk" ? null : this.thread(id);
      const on = this.tab === id;
      const dot = this.running?.tab === id ? t.accent : th && unread(th) ? t.foreground : null;
      // Symmetric padding; the state dot sits in the corner, so it takes no room.
      return h_flex().id(`agent-tab-${i}`).relative().h(28).max_w(maxW).px(8).gap(4).flex_none().items_center().rounded(RADIUS.small).cursor_pointer().text_size(12)
        .border_1().border_color(on && this.focused ? t.input : CLEAR).bg(on ? t.selected : CLEAR).hover((s) => s.bg(t.hover))
        .text_color(on ? t.foreground : t.muted).tooltip(th ? `${th.title} · ${this.tabs().indexOf(id) + 1} selects · x closes · F2 renames` : "Walkthrough · 1")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((ev, cx) => { if (th && ev.click_count >= 2) { this.select(id, cx); this.startRename(); } else this.select(id, cx); this.focused = true; this.owner.focus = "agent"; this.redraw(cx, true); })
        .when(Boolean(dot), (e) => e.child(div().absolute().top(3).right(3).size(6).rounded_full().bg(dot)))
        .when(Boolean(th), (e) => e.child(div().flex_none().text_color(t.dim).child(String(this.number(id)))))
        .child(this.renaming === id
          ? div().w(120).child(Textarea.new(this.rename).w_full().text_size(12).text_color(t.foreground))
          : div().flex_shrink(1).min_w(0).truncate().child(th ? th.title : "Walkthrough"))
        .when(Boolean(th), (e) => e.child(div().id(`agent-tab-x-${i}`).flex_none().size(16).flex().items_center().justify_center().rounded(RADIUS.small).hover((s) => s.bg(t.hover)).tooltip("Close (x)")
          .on_click((_e, cx) => { cx.stop_propagation(); this.closeThread(id, cx); this.redraw(cx, true); })
          .child(svg(iconOf("x")).size(10).text_color(t.dim))));
    };
    // The tabs that fit; the shown tab always does. The rest are in Threads ▾ (+N).
    const all = this.tabs();
    let room = this.width() - 16 - 28 - (this.threads().length ? 96 : 0);
    // A tab that does not fit whole still shows when 90 px are left: its title is cut, never its number or ×.
    const fit = [], widths = {};
    const take = (id) => { const w = Math.min(tabW(id), Math.max(90, room - 4)); fit.push(id); widths[id] = w; room -= w + 4; };
    for (const id of all) if (id === "walk" || room - 4 >= Math.min(tabW(id), 90)) take(id);
    if (!fit.includes(this.tab)) { while (fit.length > 1 && room < 94) room += widths[fit.pop()] + 4; take(this.tab); }
    const hidden = all.length - fit.length;
    return h_flex().id("agent-tabs").h(HEADER).flex_none().pl(8).pr(4).gap(4).items_center().border_b(1).border_color(t.border).bg(this.focused ? t.raised : t.chrome)
      .child(h_flex().id("agent-tab-strip").flex_1().min_w(0).gap(4).items_center().overflow_hidden().children(fit.map((id) => tabEl(id, all.indexOf(id), widths[id]))))
      .when(this.threads().length > 0, (e) => e.child(h_flex().id("agent-threads").flex_none().h(24).px(8).gap(4).items_center().rounded(RADIUS.small).cursor_pointer()
        .hover((s) => s.bg(t.hover)).text_size(12).text_color(t.muted).tooltip("Every thread of this review, closed ones too")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.threadsMenu = !this.threadsMenu; this.providerMenu = false; this.redraw(cx); })
        .child(hidden > 0 ? `Threads +${hidden}` : "Threads").child(svg(iconOf("chevron-down")).size(10).text_color(t.dim))))
      .child(div().id("agent-fold").flex_none().size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("Fold the Agent panel (])").on_click((_e, cx) => { this.fold(); this.owner.redraw(cx); })
        .child(svg(iconOf("panel-right")).size(14).text_color(t.muted)));
  }

  /** Under the tabs: the provider switch and model, and (walkthrough) the version flip and Regenerate. */
  subBar(t) {
    const vs = this.record?.versions ?? [];
    const at = vs.findIndex((v) => v.id === this.version()?.id);
    const arrow = (id, label, d, ok) => div().id(id).size(20).flex().items_center().justify_center().rounded(RADIUS.small).text_size(12)
      .text_color(ok ? t.foreground : t.dim).when(ok, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
      .tooltip(d < 0 ? "Previous version (u)" : "Next version (U)").on_click((_e, cx) => { if (ok) this.flip(d, cx); this.owner.redraw(cx); }).child(label);
    const model = this.model();
    return h_flex().h(32).flex_none().px(8).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
      .child(h_flex().id("agent-provider").h(24).px(8).gap(4).items_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("The agent that answers · click to switch").on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.providerMenu = !this.providerMenu; this.redraw(cx); })
        .child(div().text_color(t.foreground).child(this.providerName()))
        .child(svg(iconOf("chevron-down")).size(10).text_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.width() > 340 ? model ?? "default model" : ""))
      .when(this.tab === "walk" && vs.length > 0, (e) => e
        .child(h_flex().flex_none().gap(4).items_center().text_size(11).text_color(t.dim)
          .child(`v${at + 1}${vs.length > 1 ? ` of ${vs.length}` : ""}`)
          .child(arrow("version-prev", "‹", -1, at > 0)).child(arrow("version-next", "›", 1, at < vs.length - 1)))
        .child(button(t, "regenerate", "Regenerate", "r", (cx) => this.regenerate(cx), { disabled: Boolean(this.running), tip: "A new version; the old one stays (u goes back)" })));
  }

  threadsMenuEl(t) {
    // The popover is the absolute box; the scrolling list sits inside it (a scroll wrapper cannot float).
    return div().id("agent-threads-pop").absolute().top(HEADER).right(8).w(280).rounded(RADIUS.float).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(v_flex().id("agent-threads-menu").max_h(320).overflow_y_scrollbar().p(4).gap(4).children(this.threads().map((th) => h_flex().id(`threads-menu-${th.id}`).h(28).px(8).gap(8).items_center().rounded(RADIUS.row).cursor_pointer().hover((s) => s.bg(t.hover))
        .border_1().border_color(this.tab === th.id ? t.input : CLEAR)
        .on_click((_e, cx) => { this.reopen(th.id, cx); this.redraw(cx, true); })
        .child(div().w(20).flex_none().text_size(11).text_color(t.dim).child(String(this.number(th.id))))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(th.closed ? t.muted : t.foreground).child(th.title))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(th.closed ? "closed" : `${th.entries.filter((e) => e.role === "answer").length} ans.`)))));
  }

  providerMenuEl(t) {
    const list = PROVIDERS.filter((p) => this.installed?.includes(p.id));
    return v_flex().id("agent-provider-menu").absolute().top(HEADER + 32).left(8).w(220).p(4).gap(4).rounded(RADIUS.float).border_1().border_color(t.border).bg(t.popover).shadow_lg()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(!list.length, (e) => e.child(div().p(8).text_size(12).text_color(t.dim).child("No agent CLI found.")))
      .children(list.map((p) => h_flex().id(`provider-${p.id}`).h(28).px(8).gap(8).items_center().rounded(RADIUS.row).cursor_pointer().hover((s) => s.bg(t.hover))
        .border_1().border_color(this.provider() === p.id ? t.input : CLEAR)
        .on_click((_e, cx) => { this.setProvider(p.id); this.owner.redraw(cx); })
        .child(div().flex_1().text_size(12).text_color(t.foreground).child(p.name))
        .child(div().text_size(11).text_color(p.isolated ? t.dim : t.ansi3).child(p.isolated ? "read-only" : "not isolated"))));
  }

  /** The folded panel: a 36 px rail with the tabs' dots and the draft count. */
  rail(t) {
    const drafts = this.owner.notes().length;
    return v_flex().id("agent-rail").w(AGENT_RAIL).flex_none().h_full().py(8).gap(8).items_center().border_l(1).border_color(t.border).bg(t.chrome)
      .child(div().id("agent-unfold").size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("Agent panel (] or w)").on_click((_e, cx) => { this.fold(); this.owner.redraw(cx); })
        .child(svg(iconOf("panel-right")).size(14).text_color(t.muted)))
      .children(this.tabs().slice(0, 10).map((id, i) => {
        const th = id === "walk" ? null : this.thread(id);
        const dot = this.running?.tab === id ? t.accent : th && unread(th) ? t.foreground : t.dim;
        return div().id(`rail-${i}`).size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
          .tooltip(th ? th.title : "Walkthrough").on_click((_e, cx) => { this.fold(); this.select(id, cx); this.owner.redraw(cx); })
          .child(th ? div().size(6).rounded_full().bg(dot) : svg(iconOf("layers")).size(14).text_color(this.running?.tab === "walk" ? t.accent : t.muted));
      }))
      .child(div().flex_1())
      .child(div().id("rail-drafts").min_w(20).h(20).px(4).flex().items_center().justify_center().rounded(RADIUS.small).bg(t.surface)
        .text_size(11).text_color(drafts ? t.foreground : t.dim).tooltip(`${drafts} draft note${drafts === 1 ? "" : "s"} · S opens the review`).child(String(drafts)));
  }

  render(t, cx) {
    if (!this.loaded) this.loadRecord(cx);
    this.snapshot();
    if (!this.comparisonKey && !this.keying) { this.keying = true; cx.spawn(async (cx) => { try { await this.keyOf(cx); } finally { this.keying = false; } this.owner.redraw(cx); }); }
    this.follow(read("review.walkthrough"), cx);
    this.fetchLines(cx);
    if (!this.installed) this.detect(cx);
    if (this.folded()) return this.rail(t);
    this.remeasure = false;
    const width = this.width();
    const blocks = this.blocks();
    this.scroll.measure(blocks.map((b) => this.heights.get(b.key) ?? 60));
    if (this.revealStep) { const at = blocks.findIndex((b) => b.kind === "step" && b.i === this.step); if (at >= 0) this.scroll.reveal(at, { margin: 12 }); this.revealStep = false; }
    if (this.revealEntry) { const at = blocks.findIndex((b) => b.kind === "entry" && b.i === this.entry); if (at >= 0) this.scroll.reveal(at, { margin: 12 }); this.revealEntry = false; }
    if (this.revealBottom) { this.scroll.top = this.scroll.total(); this.scroll.clamp(); this.revealBottom = false; }
    const banner = this.banner(t);
    const running = this.running && this.running.tab === this.tab;
    const th = this.tab === "walk" ? null : this.thread();
    const seconds = this.running ? Math.round((Date.now() - this.running.startedAt) / 1000) : 0;
    return v_flex().id("review-agent").relative().w(width).flex_none().h_full().min_h(0).border_l(1)
      .border_color(t.border).bg(t.chrome).text_size(13)
      .font_family(uiFont())
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.focused = true; this.owner.focus = "agent"; this.providerMenu = false; this.threadsMenu = false; if (!this.typing && !this.renaming) this.owner.handle.focus(); this.redraw(cx); })
      .on_mouse_up("left", (_e, cx) => { if (this.lineSel?.dragging) { this.lineSel.dragging = false; this.redraw(cx); } })
      // The left border is a drag handle for the width.
      .child(div().id("agent-resize").absolute().left(-3).top_0().bottom_0().w(6).cursor_col_resize()
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.drag = { x: e.position.x, w: width }; this.redraw(cx); }))
      .child(this.tabBar(t))
      // The progress line always takes its 2 px: a running answer never moves the content.
      .child(div().h(2).flex_none().w_full().overflow_hidden().child(running
        ? div().h(2).w(Math.round(width * 0.3)).bg(t.accent).loop("left", { from: -Math.round(width * 0.3), to: width, period: 1400 })
        : div()))
      .child(this.subBar(t))
      .child(v_flex().flex_1().min_h(0).px(16).pt(12)
        .child(this.scroll.view(t, (i) => {
          const b = blocks[i];
          return div().id(`ab-${i}`).w_full().flex_none()
            .on_size_change((size, cx) => {
              const h = Math.round(size.height / zoom());
              // A burst of new heights (a tab switch measures every block) is one redraw: the first asks, the rest wait for it.
              if (this.heights.get(b.key) !== h) { this.heights.set(b.key, h); if (!this.remeasure) { this.remeasure = true; this.owner.redrawCol("agent", cx); } }
            })
            .child(this.blockEl(t, b));
        })))
      .child(v_flex().flex_none().px(12).pt(8).pb(12).gap(8).border_t(1).border_color(t.border)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(h_flex().h(16).gap(8).items_center().text_size(11).text_color(t.dim)
          .child(running ? `${this.running.doing ?? "Thinking"} · ${seconds}s` : th ? `${th.entries.filter((e) => e.role === "answer").length} answer${th.entries.filter((e) => e.role === "answer").length === 1 ? "" : "s"}` : this.steps().length ? `Step ${this.step + 1} of ${this.steps().length}` : "")
          .child(div().flex_1())
          .when(running, (e) => e.child(keycap(t, "esc", "cancel"))))
        .child(div().id("agent-input").w_full().px(8).py(4).rounded(RADIUS.field).border_1().border_color(this.typing ? t.input : t.border).bg(t.surface).cursor_text()
          .on_click((_e, cx) => { this.input.focus(); this.redraw(cx); })
          .child(Textarea.new(this.input).w_full().text_size(13).text_color(t.foreground))))
      // Banners float over the content's top: they never push it down.
      .when(Boolean(banner), (e) => e.child(div().absolute().top(HEADER + 2 + 32).left_0().right_0().child(banner)))
      .when(Boolean(this.providerMenu), (e) => e.child(this.providerMenuEl(t)))
      .when(Boolean(this.threadsMenu), (e) => e.child(this.threadsMenuEl(t)));
  }
}
