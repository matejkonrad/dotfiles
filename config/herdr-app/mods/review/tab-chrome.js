// The tab around the columns: the header, the footer, the review drawer, the ⌘K palette and the dialogs.
import { div, svg } from "gpui-kit";
import { Textarea, h_flex, v_flex } from "gpui-base";
import { run } from "herdr";
import { RADIUS } from "./style.js";
import { CLEAR, HEADER, alpha, button, iconOf, keycap, mono, uiFont, zoom } from "./ui.js";
import { statusOf, store } from "./store.js";
import { EVENTS } from "./tab-drafts.js";

// The keys, by topic: the key sheet (?) shows them all, the footer the first ones marked `chip`.
export const KEYS = [
  ["Move", [["j / k", "line"], ["J / K", "file"], ["n / N", "next / previous hunk (in step order when a step is selected)"], ["g / G", "top / end"], ["Tab", "focus: files → diff → agent"]]],
  ["Review", [["v", "select lines"], ["a", "review note on the selection"], ["i", "ask: a new thread on the selection"], ["⏎", "edit the draft · open the thread · fold"], ["d / X", "delete the draft · drop stale drafts"], ["S", "review drawer: submit or send"], ["m", "PR review / agent review"]]],
  ["Agent panel", [["w", "show or focus"], ["[ / ]", "previous / next tab (here: fold files / agent)"], ["1 – 9", "select a tab"], ["x / ⌃W", "close the thread (Threads ▾ reopens)"], ["F2", "rename the thread"], ["c", "the answer becomes a draft note"], ["r", "regenerate (a new version)"], ["u / U", "previous / next version"], ["Esc", "cancel the agent · back to the diff"]]],
  ["Scope", [["1", "Uncommitted (local) · All changes (PR)"], ["2", "Branch (local) · Since review (PR)"], ["3", "commits: one or a range"], ["B", "local: the base branch"]]],
  ["View", [["s", "unified / split"], ["o", "file order: reading order / folders"], ["V", "mark the file viewed"], ["R", "reload"]]],
  ["Open", [["e", "Neovim at the line, new tab"], ["O / ⌃⌥↵", "open in… an editor: the file at the cursor"], ["⌘K", "every action by name"], ["?", "this sheet"], ["q", "close the review"]]],
];

export class TabChrome {
  topBar(t) {
    const m = this.meta ?? {};
    const type = this.type();
    const n = this.fresh().length, all = this.notes().length;
    const st = this.local ? null : statusOf(this.dkey);
    const ck = st?.checks ?? (m.checks ? { passed: m.checks.passed, pending: m.checks.pending, failed: m.checks.failed.length } : null);
    const seg = (id, label, on, click, tip) => div().id(`seg-${id}`).h(24).px(8).flex().items_center().rounded(RADIUS.row).text_size(12)
      .bg(on ? t.selected : CLEAR)
      .text_color(on ? t.foreground : t.muted).tooltip(tip).when(!on, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { if (!on) click(cx); this.redraw(cx); })
      .child(label);
    const group = (...kids) => h_flex().flex_none().rounded(RADIUS.field).overflow_hidden().border_1().border_color(t.border).children(kids);
    const pr = type === "pr";
    const cramped = store().split && !this.splitFits();
    return h_flex().h(HEADER).flex_none().px(12).gap(12).items_center().border_b(1).border_color(t.border).bg(t.chrome).text_size(13)
      .when(this.local, (e) => e
        .child(div().font_semibold().flex_none().child("Local changes"))
        .child(this.scopeControl(t))
        // A note about the scope (no commits ahead, already merged) goes first: the branch is in the tooltip.
        .child(div().id("scope-line").flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).when(Boolean(m.head), (e) => e.tooltip(m.head))
          .child(!m.head ? "" : /^(No commits ahead|Already merged)/.test(this.scopeLine()) ? this.scopeLine() : `${m.head} · ${this.scopeLine()}`)))
      .when(!this.local, (e) => e
        .child(div().font_semibold().flex_none().child(this.name))
        .child(this.scopeControl(t))
        // The header is full: the branches move to the title's tooltip, so the title keeps its room.
        .child(div().id("pr-title").flex_1().min_w(40).truncate().text_color(t.foreground).when(Boolean(m.head), (e) => e.tooltip(`${m.head} → ${m.base}`)).child(m.title ?? ""))
        .child(h_flex().w(96).flex_none().gap(4).justify_end().text_size(12)
          .when(Boolean(ck?.failed), (e) => e.child(div().text_color(t.ansi1).child(`✗${ck.failed}`)))
          .when(Boolean(ck?.pending), (e) => e.child(div().text_color(t.ansi3).child(`◐${ck.pending}`)))
          .when(Boolean(ck?.passed), (e) => e.child(div().text_color(t.ansi2).child(`✓${ck.passed}`))))
        .child(group(
          seg("pr", "PR review", pr, () => this.setType("pr"), "Notes become one GitHub review (m)"),
          seg("agent", "Agent review", !pr, () => this.setType("agent"), "Notes go into an agent's input box (m)"))))
      .child(group(
        seg("unified", "Unified", !this.split(), () => { if (store().split) this.toggleSplit(); }, cramped ? "Split needs 80 columns on each side: there is not enough room now (s)" : "Unified diff (s)"),
        seg("split", cramped ? "Split ·" : "Split", this.split(), () => this.toggleSplit(), cramped ? "Split needs more width: fold a column ([ or ])" : "Split diff (s)")))
      .child(div().id("draft-count").w(96).flex_none().text_right().truncate().text_size(12).text_color(n ? t.foreground : t.dim)
        .when(all > n, (e) => e.tooltip(this.draftCounts(this.notes(), pr)))
        .child(`${n} draft${n === 1 ? "" : "s"}${all > n ? ` · ${all - n} held` : ""}`))
      // A narrow tab drops the keycap first (it stays in the tooltip and the key sheet).
      .child(button(t, "act-open", "Open in…", this.width / zoom() >= 1500 ? "O" : null, (cx) => this.openWith(this.fileAt(this.cursor), cx), { tip: "The file at the cursor in an editor (O, ⌃⌥↵)" }))
      .child(button(t, "act-review", pr ? "Review" : "Send", "S", () => this.openDrawer(), { primary: n > 0 || pr, tip: pr ? "The review drawer: drafts, verdict, summary" : "The review drawer: send the drafts to an agent" }))
      .child(div().id("reload").flex_none().size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Reload (R)")
        .on_click((_e, cx) => { this.load(cx); run("review.refresh"); this.redraw(cx); })
        .child(this.loading ? svg(iconOf("spinner")).size(12).text_color(t.muted).spin(900) : div().text_color(t.muted).child("↻")));
  }

  /** One footer for the tab: the keys of the column that has the keyboard, or a short message instead of them. */
  footer(t) {
    const a = this.agent;
    const chips = this.modal ? []
      : this.pending ? [keycap(t, "↵", "save"), keycap(t, "⇧↵", "new line"), keycap(t, "esc", "cancel")]
      : this.focus === "agent" && !a.folded()
        ? a.typing ? [keycap(t, "↵", "send"), keycap(t, "⇧↵", "new line"), keycap(t, "esc", "leave")]
          : a.tab === "walk" ? [keycap(t, "j k", "steps"), keycap(t, "h l", "excerpts"), keycap(t, "↵", a.version() ? "open" : "generate"), keycap(t, "i", "ask"), keycap(t, "v", "pick lines"), keycap(t, "u", "older version"), keycap(t, "[ ]", "tabs")]
          : [keycap(t, "j k", "answers"), keycap(t, "c", "make a note"), keycap(t, "i", "follow-up"), keycap(t, "↵", "open the lines"), keycap(t, "x", "close"), keycap(t, "[ ]", "tabs")]
        : this.focus === "files" ? [keycap(t, "j k", "files"), keycap(t, "↵", "open"), keycap(t, "o", "order"), keycap(t, "Tab", "next column")]
        : [keycap(t, "j k", "line"), keycap(t, "n N", "hunk"), keycap(t, "v", "select"), keycap(t, "a", "note"), keycap(t, "i", "ask"), keycap(t, "S", "review"), keycap(t, "Tab", "next column")];
    return h_flex().flex_none().h(32).px(12).gap(12).items_center().border_t(1).border_color(t.border).bg(t.chrome).text_size(12)
      .child(Boolean(this.flash)
        ? h_flex().id("flash").flex_1().min_w(0).gap(8).items_center().cursor_pointer().on_click((_e, cx) => { this.flash = null; this.redraw(cx); })
          .child(div().size(6).flex_none().rounded_full().bg(t.ansi3)).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(this.flash))
        : h_flex().flex_1().min_w(0).gap(12).items_center().overflow_hidden().children(chips))
      .when(!this.modal && !this.pending, (e) => e.child(h_flex().id("all-keys").flex_none().gap(8).items_center().cursor_pointer().rounded(RADIUS.small).px(4).hover((s) => s.bg(t.hover))
        .tooltip("Every key").on_click((_e, cx) => { this.modal = { kind: "keys" }; this.redraw(cx); })
        .child(keycap(t, "?", "keys")).child(keycap(t, "⌘K", "actions"))));
  }

  /** S: every draft by file, then the verdict (PR review) or the agent (agent review), the summary and one primary action. */
  drawerEl(t) {
    const m = this.modal;
    const pr = this.type() === "pr";
    const notes = this.notes();
    const byFile = new Map();
    for (const n of notes) (byFile.get(n.path) ?? byFile.set(n.path, []).get(n.path)).push(n);
    const n = this.fresh().length;
    const option = (id, label, on, click) => h_flex().id(id).h(28).px(8).gap(8).items_center().rounded(RADIUS.small).cursor_pointer().border_1()
      .border_color(on ? t.input : t.border).bg(on ? t.selected : CLEAR).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { click(cx); this.redraw(cx); })
      .child(div().text_size(12).text_color(t.foreground).child(label));
    const list = pr ? [] : this.agentList();
    const others = pr ? 0 : this.otherAgents();
    const can = pr ? n > 0 || m.event === "APPROVE" || Boolean(String(this.summary.value() ?? "").trim()) : n > 0 && list.length > 0;
    return div().id("review-drawer-dim").absolute().inset_0().bg(alpha(t.canvas, "80"))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.modal = null; this.handle.focus(); this.redraw(cx); })
      .child(v_flex().id("review-drawer").absolute().top_0().bottom_0().right_0().w(440).border_l(1).border_color(t.border).bg(t.popover).shadow_lg()
        .rounded_l(RADIUS.float).font_family(uiFont())
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(h_flex().h(HEADER).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border)
          .child(div().flex_1().text_size(13).font_semibold().text_color(t.foreground).child(pr ? `Review ${this.local ? "local changes" : this.name}${store().dryRun ? " (dry run)" : ""}` : "Send the notes to an agent"))
          .child(button(t, "drawer-mode", pr ? "Agent review" : "PR review", "m", () => this.setType(pr ? "agent" : "pr"), { tip: "Switch the review type" }))
          .child(div().id("drawer-close").size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Close (esc)")
            .on_click((_e, cx) => { this.modal = null; this.handle.focus(); this.redraw(cx); }).child(svg(iconOf("x")).size(12).text_color(t.muted))))
        .child(v_flex().id("drawer-drafts").flex_1().min_h(0).overflow_y_scrollbar().px(16).py(12).gap(12)
          .child(div().text_size(11).text_color(t.dim).child(this.draftCounts(notes, pr)))
          .when(!notes.length, (e) => e.child(div().text_size(12).text_color(t.muted).child(pr ? "No drafts. You can still approve, or comment with a summary." : "No drafts yet. Press a on a line to write one.")))
          .children([...byFile].map(([path, list], fi) => v_flex().gap(4)
            .child(div().text_size(12).font_semibold().text_color(t.foreground).truncate().child(path))
            .children(list.map((note) => h_flex().id(`drawer-note-${note.id}`).w_full().px(8).py(4).gap(8).items_start().rounded(RADIUS.row).cursor_pointer().hover((s) => s.bg(t.hover))
              .tooltip("Open the draft in the diff")
              .on_click((_e, cx) => { this.modal = null; this.editNote(note); this.redraw(cx); })
              .child(div().w(56).flex_none().font_family(mono()).text_size(11).text_color(this.stale(note) ? t.ansi3 : t.dim)
                .child(note.start_line && note.start_line !== note.line ? `${note.start_line}–${note.line}` : String(note.line)))
              .child(div().flex_1().min_w(0).text_size(13).text_color(t.foreground).child(note.body.split("\n")[0]))
              .when(pr && !this.postable(note), (e) => e.child(div().flex_none().text_size(11).text_color(t.dim)
                .tooltip("Its line is not in the PR's diff: GitHub can't take it. It stays saved.").child("not postable in this scope"))))))))
        .child(v_flex().flex_none().px(16).py(12).gap(8).border_t(1).border_color(t.border)
          .when(pr, (e) => e.child(h_flex().gap(8).children(EVENTS.map(([id, label], i) => option(`ev-${id}`, `${i + 1} ${label}`, m.event === id, () => { m.event = id; }))))
            .child(div().id("summary-box").h(76).px(8).py(4).rounded(RADIUS.field).border_1().border_color(this.summaryTyping ? t.input : t.border).bg(t.surface).cursor_text()
              .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.summary.focus(); })
              .child(Textarea.new(this.summary).h(64).text_size(13).text_color(t.foreground))))
          .when(!pr, (e) => e.child(v_flex().id("agent-list").max_h(180).overflow_y_scrollbar().gap(4)
            .when(!list.length, (e) => e.child(div().text_size(12).text_color(t.dim).child(others
              ? "No agents in this workspace. Press a to show the other workspaces."
              : "No agents are running. Start one, then press S again.")))
            .children(list.flatMap((ag, i) => [
              ...(ag.space !== this.p.space && list[i - 1]?.space === this.p.space || (i === 0 && ag.space !== this.p.space)
                ? [div().pt(4).px(8).text_size(11).text_color(t.dim).child("Other workspaces")] : []),
              h_flex().id(`agent-${ag.address}`).h(28).px(8).gap(8).items_center().rounded(RADIUS.row).cursor_pointer()
              .border_1().border_color(i === m.at ? t.input : CLEAR).when(i === m.at, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => { m.at = i; this.redraw(cx); })
              .child(div().size(6).flex_none().rounded_full().bg(t[ag.status] ?? t.unknown))
              .child(div().text_size(12).font_semibold().child(ag.program?.name ?? ag.app ?? "agent"))
              .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
                .child(ag.space === this.p.space ? ag.tab_name ?? "" : `${ag.space_name} / ${ag.tab_name}`))]))
            .when(others > 0, (e) => e.child(h_flex().id("agent-all").h(24).px(8).gap(8).items_center().rounded(RADIUS.row).cursor_pointer().hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => { m.allSpaces = !m.allSpaces; m.at = Math.min(m.at, Math.max(0, this.agentList().length - 1)); this.redraw(cx); })
              .child(div().flex_1().text_size(11).text_color(t.muted).child(m.allSpaces ? "Only this workspace" : `Show all workspaces (${others} more)`))
              .child(keycap(t, "a"))))))
          .when(Boolean(this.flash), (e) => e.child(div().text_size(12).text_color(t.ansi1).child(this.flash)))
          .child(h_flex().gap(8).items_center()
            .child(div().flex_1().text_size(11).text_color(t.dim).child(pr ? "1 2 3 verdict · i summary · ↵ submit" : "j k agent · a all workspaces · ↵ paste (no Enter is pressed)"))
            .child(button(t, "drawer-go", pr ? "Submit" : "Send", "↵", (cx) => { if (pr) this.submit(cx); else this.pasteTo(list[m.at], cx); }, { primary: true, disabled: !can })))));
  }

  paletteEl(t) {
    const list = this.paletteList();
    const m = this.modal;
    return div().id("review-palette-dim").absolute().inset_0().bg(alpha(t.canvas, "80"))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.modal = null; this.handle.focus(); this.redraw(cx); })
      .child(v_flex().id("review-palette").absolute().top(64).left_0().right_0().mx_auto().w(520).max_h(420).rounded(RADIUS.float).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .font_family(uiFont()).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().h(HEADER).flex_none().px(12).flex().items_center().border_b(1).border_color(t.border)
          .child(Textarea.new(this.palette).w_full().text_size(13).text_color(t.foreground)))
        .child(v_flex().id("palette-list").max_h(372).overflow_y_scrollbar().p(4).gap(4)
          .when(!list.length, (e) => e.child(div().p(8).text_size(12).text_color(t.dim).child("No action matches.")))
          .children(list.map((a, i) => h_flex().id(`palette-${i}`).h(28).px(8).gap(8).items_center().rounded(RADIUS.row).cursor_pointer()
            .bg(i === m.at ? t.selected : CLEAR).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { this.modal = null; this.handle.focus(); a.run(cx); this.redraw(cx); })
            .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(a.name))
            .when(Boolean(a.key), (e) => e.child(keycap(t, a.key)))))));
  }

  /** A dialog drawn over the tab: the key sheet, or "close with drafts?". */
  modalEl(t) {
    const m = this.modal;
    if (m.kind === "drawer") return this.drawerEl(t);
    if (m.kind === "palette") return this.paletteEl(t);
    let title, body, hint;
    if (m.kind === "keys") {
      title = "Keys";
      body = v_flex().gap(12).children(KEYS.map(([topic, list]) => v_flex().gap(4)
        .child(div().text_size(11).text_color(t.dim).child(topic))
        .children(list.map(([keys, what]) => h_flex().gap(12).items_center().text_size(13)
          .child(div().w(120).flex_none().child(keycap(t, keys)))
          .child(div().flex_1().min_w(0).text_color(t.foreground).child(what))))));
      hint = "? or esc closes";
    } else {
      title = "Close this review?";
      body = div().text_size(12).text_color(t.muted).child(`${this.notes().length} draft notes are not sent. They stay saved and come back when you open this review again.`);
      hint = "y/⏎ close · n/esc stay";
    }
    return div().id("review-modal-dim").absolute().inset_0().flex().items_center().justify_center().bg(alpha(t.canvas, "b3"))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(v_flex().id("review-modal").w(m.kind === "keys" ? 600 : 460).max_h(640).overflow_y_scrollbar().p(16).gap(12).rounded(RADIUS.float).border_1().border_color(t.border).bg(t.popover).shadow_lg()
        .font_family(uiFont())
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(title))
        .child(body)
        .when(Boolean(this.flash), (e) => e.child(div().text_size(11).text_color(t.ansi1).child(this.flash)))
        .child(div().text_size(11).text_color(t.dim).child(hint)));
  }
}
