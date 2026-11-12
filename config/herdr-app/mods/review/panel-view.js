// The review panel's view: two tabs (Space, Inbox), rows of exactly two lines that say what must happen next,
// details only on the expanded row. Nothing jumps: fixed row heights and slots, old rows stay during a refresh.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { spaces, theme } from "herdr";
import * as gh from "./gh.js";
import { CLEAR, age, iconOf, mono, openUrl, plural } from "./ui.js";
import { choiceEl } from "./open-in.js";
import { RADIUS } from "./style.js";
import { reviewButton } from "./launcher.js";
import { ago, edit, spaceState, statusOf, store, whereOf } from "./store.js";
import { prStatus, trackedFacts } from "./pr-status.mjs";

export const PANEL_RAIL = 44;
export const LOCAL = "local";
export const SECTIONS = [["turn", "Your turn"], ["waiting", "Waiting"], ["drafts", "Drafts"]];
const ROW = 44;
const SECTION = 24;
const THREADS_SHOWN = 3;
const CHECKS_SHOWN = 3;
// The PR glyphs ship with the mod.
const prIcon = (name) => `mods/review/${name}.svg`;
const KEYS = {
  space: [["j / k", "move"], ["⏎", "review"], ["space", "more"], ["o", "GitHub"], ["O", "open in… an editor"], ["f", "fix (shows the prompt first)"], ["a", "auto-fix"],
    ["r", "re-run failed checks"], ["s", "mark seen"], ["x", "untrack"], ["i", "track a PR"], ["R", "refresh"], ["tab", "Inbox"], ["esc", "back"]],
  inbox: [["j / k", "move"], ["⏎", "review"], ["space", "more"], ["o", "GitHub"], ["O", "open in… an editor"], ["t", "track in this space"], ["s", "mark seen"],
    ["[ / ]", "fold / unfold the section"], ["i", "track a PR"], ["R", "refresh"], ["tab", "Space"], ["esc", "back"]],
};

/** A status tone as a theme color. */
const toneOf = (t, tone) => ({ fail: t.ansi1, warn: t.ansi3, ok: t.ansi2, fg: t.foreground, muted: t.muted, dim: t.dim })[tone] ?? t.dim;

export class PanelView {
  /** The PR's state, never its CI: draft dim, open muted, merged purple, closed dim. */
  glyph(t, { state, draft }) {
    const [name, color] = draft ? ["pr-draft", t.dim] : state === "MERGED" ? ["pr-merged", t.ansi5] : state === "CLOSED" ? ["pr-closed", t.dim]
      : ["pr-open", state === "OPEN" ? t.muted : t.dim];
    return svg(prIcon(name)).size(12).text_color(color);
  }

  /**
   * One row, exactly ROW high. Line 1: glyph, title, badges, unread dot, age (↗ under the pointer). Line 2: the
   * short name, the status phrase and its signals. A click opens the review; ⌥-click or the chevron expands it.
   */
  rowEl(t, r) {
    const hovered = this.hoverKey === r.key, selected = this.sel === r.key, open = this.expanded === r.key;
    const st = r.status;
    const glyphBox = div().id(`glyph-${r.key}`).size(16).flex_none().flex().items_center().justify_center()
      .when(hovered && r.expandable !== false, (e) => e.cursor_pointer().tooltip(open ? "Less (space)" : "More (space)")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.expanded = open ? null : r.key; this.sel = r.key; cx.notify(); }))
      .child(hovered && r.expandable !== false ? svg(iconOf(open ? "chevron-down" : "chevron-right")).size(12).text_color(t.muted) : r.glyph);
    const ageSlot = div().id(`age-${r.key}`).min_w(28).h(16).flex_none().flex().items_center().justify_end().text_size(11).text_color(t.dim)
      .when(hovered && Boolean(r.url), (e) => e.cursor_pointer().tooltip("Open on GitHub (o)")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); openUrl(r.url); }))
      .child(hovered && r.url ? "↗" : r.age ?? "");
    // Open in…: its slot is always there, so nothing moves when the pointer brings the icon.
    const openSlot = div().id(`open-${r.key}`).size(16).flex_none().flex().items_center().justify_center().rounded(RADIUS.small)
      .when(hovered && Boolean(r.openIn), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Open in… an editor (O)")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); r.openIn(cx); cx.notify(); })
        .child(svg(iconOf("folder")).size(11).text_color(t.muted)));
    const line2 = h_flex().h(16).pl(22).gap(4).items_center().text_size(12).overflow_hidden()
      .when(Boolean(r.short), (e) => e.child(div().flex_none().text_color(t.dim).child(r.short)).child(div().flex_none().text_color(t.dim).child("·")))
      .when(Boolean(st?.spin), (e) => e.child(svg(iconOf("spinner")).size(10).flex_none().text_color(t.muted).spin(900)))
      // The phrase keeps its room; signals are cut first.
      .child(div().flex_none().max_w(220).truncate().text_color(toneOf(t, st?.tone)).child(st?.phrase ?? "…"))
      .child(h_flex().flex_1().min_w(0).gap(4).overflow_hidden()
        .children((st?.signals ?? []).flatMap((s) => [div().flex_none().text_color(t.dim).child("·"), div().flex_none().text_color(toneOf(t, s.tone)).child(s.text)])));
    return v_flex().id(`row-${r.key}`).h(ROW).flex_none().px(12).py(5).gap(0).cursor_pointer()
      .bg(selected ? t.selected : CLEAR).hover((s) => s.bg(t.hover))
      .when(Boolean(r.tip), (e) => e.tooltip(r.tip))
      .on_hover((h, cx) => {
        if (h && this.hoverKey !== r.key) { this.hoverKey = r.key; cx.notify(); }
        else if (!h && this.hoverKey === r.key) { this.hoverKey = null; cx.notify(); }
      })
      .on_click((e, cx) => {
        if (e.modifiers?.alt) { this.expanded = open ? null : r.key; this.sel = r.key; }
        else r.onOpen(cx);
        cx.notify();
      })
      .child(h_flex().h(18).gap(6).items_center()
        .child(glyphBox)
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(r.titleColor ?? t.foreground).child(r.title))
        .when(Boolean(r.badge), (e) => e.child(r.badge))
        .child(div().w(8).h(8).flex_none().flex().items_center().justify_center()
          .when(Boolean(r.unread), (e) => e.child(div().size(6).rounded_full().bg(t.accent))))
        .child(openSlot)
        .child(ageSlot))
      .child(line2);
  }

  /** A small button of an expanded row. */
  button(id, label, keyHint, onClick, t, { active = false, tooltip = null } = {}) {
    return div().id(id).h(22).px(8).gap(5).flex().flex_none().items_center().rounded(RADIUS.small).text_size(12).border_1().cursor_pointer()
      .border_color(active ? t.input : CLEAR).text_color(active ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).when(Boolean(tooltip), (e) => e.tooltip(tooltip))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); cx.notify(); })
      .child(label).when(Boolean(keyHint), (e) => e.child(div().text_size(11).text_color(t.dim).child(keyHint)));
  }

  // ---- Space ----

  /** "uncommitted +12 −3": a chip that opens the local review on that scope. */
  scopeChip(id, label, stat, t, open, tip = null) {
    return h_flex().id(id).h(20).px(6).gap(4).items_center().rounded(RADIUS.small).border_1().border_color(t.border).bg(t.background).cursor_pointer()
      .hover((s) => s.bg(t.hover)).tooltip(tip ?? `Review the ${label} changes`)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); open(); cx.notify(); })
      .child(div().text_color(t.muted).child(label))
      .child(div().text_color(stat?.added ? t.ansi2 : t.dim).child(`+${stat?.added ?? 0}`))
      .child(div().text_color(stat?.deleted ? t.ansi1 : t.dim).child(`−${stat?.deleted ?? 0}`));
  }

  /** Local changes: line 1 the dirty count, line 2 the branch and ahead/behind; expanded, its two scope chips. */
  localRows(space, t) {
    const sum = this.local[space.id]?.sum;
    const branch = sum?.branch ?? whereOf(space).branch ?? "No branch";
    const right = sum ? (sum.dirty ? plural(sum.dirty, "file") : "clean") : "";
    const row = this.rowEl(t, {
      key: LOCAL, title: "Local changes", glyph: svg(iconOf("git-branch")).size(12).text_color(t.muted), age: right, url: null,
      status: { phrase: sum?.upstream ? `${branch} ↑${sum.ahead} ↓${sum.behind}` : sum ? `${branch} · no upstream` : branch, tone: "muted", signals: [] },
      tip: "Review the local changes (⏎)", onOpen: () => this.openRow(space, LOCAL), openIn: (cx) => this.openIn(space, LOCAL, cx),
    });
    if (this.expanded !== LOCAL || !sum) return [row];
    return [row, h_flex().id("local-more").flex_none().pl(34).pr(12).pb(8).gap(8).text_size(12)
      .child(this.button("local-openin", "Open in…", "O", (cx) => this.openIn(space, LOCAL, cx), t, { tooltip: "The checkout in an editor" }))
      .child(this.scopeChip("chip-uncommitted", "uncommitted", sum.uncommitted, t, () => this.openReview(space, { local: true, scope: "uncommitted" })))
      .child(this.scopeChip("chip-branch", sum.merged ? "merged" : "branch", sum.branchStat, t, () => this.openReview(space, { local: true, scope: "branch" }),
        sum.merged ? `This branch is already merged into ${sum.base ?? "the base"}`
          : sum.aheadOfBase ? `${plural(sum.aheadOfBase, "commit")} ahead of ${sum.base ?? "the base"}` : `No commits ahead of ${sum.base ?? "the base"}`))];
  }

  /** A tracked PR's facts and status, with the "outside" signal while auto-fix is on. */
  trackedStatus(space, key) {
    const pr = this.status[key];
    if (!pr) return null;
    const auto = (spaceState(space.id).auto ?? []).includes(key);
    const facts = trackedFacts(pr);
    // Checks a review tab read after this panel's poll win: the same numbers everywhere.
    const fromTab = statusOf(key);
    if (fromTab && fromTab.at > (this.polledAt ?? 0)) { facts.failing = fromTab.checks.failed; facts.pending = fromTab.checks.pending > 0; }
    if (auto) facts.outside = pr.comments.filter((c) => c.isNew && !c.trusted && !gh.isVerdict(c)).length;
    return { pr, auto, status: prStatus(facts) };
  }

  spaceRows(space, t) {
    const out = [...this.localRows(space, t)];
    const list = this.linked(space);
    for (const ref of list) {
      const key = gh.keyOf(ref);
      const got = this.trackedStatus(space, key);
      const pr = got?.pr;
      const done = pr && (pr.state === "MERGED" || pr.state === "CLOSED" || pr.isDraft);
      const ck = pr?.checks;
      const tip = pr ? [pr.title, key, pr.headRef ? `${pr.headRef} → ${pr.baseRef}` : "", ck ? `✓ ${ck.passed} ◐ ${ck.pending} ✗ ${ck.failed.length} · +${pr.additions} −${pr.deletions}` : "",
        pr.newComments ? `${pr.newComments} new since you looked` : "", ref.branch ? "This branch's PR" : `Tracked in ${space.name}`].filter(Boolean).join("\n") : key;
      out.push(this.rowEl(t, {
        key, title: pr?.title || key, titleColor: done ? t.muted : t.foreground, glyph: this.glyph(t, { state: pr?.state, draft: pr?.isDraft }),
        badge: got?.auto ? div().id(`auto-${key}`).flex_none().text_size(12).text_color(t.dim).tooltip("Auto-fix is on").child("↯") : null,
        unread: Boolean(pr?.newComments), age: pr?.updatedAt ? age(pr.updatedAt) : "", url: pr?.url ?? null, short: gh.shortName(ref),
        status: pr?.error && pr.title ? { phrase: `✗ Could not read: ${pr.error}`, tone: "muted", signals: [] } : got?.status ?? null, tip,
        onOpen: () => this.openRow(space, key), openIn: (cx) => this.openIn(space, key, cx),
      }));
      if (this.expanded === key && pr) out.push(this.prDetails(space, ref, pr, got.auto, t));
    }
    if (!list.length) {
      const branch = whereOf(space).branch;
      const known = this.branch[space.id];
      const text = !known ? "Looking for this branch's PR…" : branch && !["main", "master", "develop", "trunk"].includes(branch)
        ? `No PR for ${branch} yet.` : "No tracked PRs.";
      out.push(h_flex().id("space-empty").h(SECTION + 8).flex_none().px(12).gap(8).items_center().text_size(12).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(text))
        .when(Boolean(known), (e) => e.child(this.button("track-one", "Track one", "+", () => this.openInput(), t))));
    }
    return out;
  }

  /** The expanded Space row: failing checks and open threads (3 each), size and branches, then its buttons. */
  prDetails(space, ref, pr, auto, t) {
    const key = gh.keyOf(ref);
    const open = pr.state === "OPEN";
    const threads = pr.comments.filter((c) => c.isResolved === false);
    const line = (id, kids, url) => h_flex().id(id).h(20).flex_none().gap(6).items_center().text_size(12).rounded(RADIUS.row)
      .when(Boolean(url), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { cx.stop_propagation(); openUrl(url); }))
      .children(kids);
    return v_flex().id(`more-${key}`).flex_none().pl(34).pr(12).pb(8).gap(2)
      .children(pr.checks.failed.slice(0, CHECKS_SHOWN).map((c, i) => line(`check-${key}-${i}`, [div().text_color(t.ansi1).child("✗"),
        div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.name), div().text_color(t.dim).child(c.url ? "↗" : "")], c.url)))
      .when(pr.checks.failed.length > CHECKS_SHOWN, (e) => e.child(div().text_size(11).text_color(t.dim).child(`${pr.checks.failed.length - CHECKS_SHOWN} more failing`)))
      .children(threads.slice(0, THREADS_SHOWN).map((c, i) => v_flex().id(`thread-${key}-${i}`).flex_none().py(2).rounded(RADIUS.row).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); openUrl(c.url); })
        .child(h_flex().gap(6).text_size(11).text_color(t.dim)
          .child(div().child(gh.shortAuthor(c.author))).child(div().flex_1().min_w(0).truncate().child(c.location ?? ""))
          .when(c.isNew, (e) => e.child(div().size(6).rounded_full().bg(t.accent))))
        .child(div().text_size(12).truncate().text_color(t.foreground).child(gh.summarize(c.body).text || "(no text)"))))
      .when(threads.length > THREADS_SHOWN, (e) => e.child(div().text_size(11).text_color(t.dim).child(`${threads.length - THREADS_SHOWN} more on GitHub`)))
      .child(div().h(20).flex().items_center().text_size(11).text_color(t.dim).truncate().child(`+${pr.additions} −${pr.deletions} · ${pr.headRef} → ${pr.baseRef}`))
      .child(h_flex().pt(2).gap(6).flex_wrap()
        .child(this.button(`review-${key}`, "Review", "⏎", () => this.openReview(space, { key }), t))
        .child(this.button(`openin-${key}`, "Open in…", "O", (cx) => this.openIn(space, key, cx), t, { tooltip: "Its checkout in an editor" }))
        .when(open, (e) => e.child(this.button(`fix-${key}`, "Fix", "f", () => this.fixNow(space, pr), t, { tooltip: "Shows the fix prompt for the failing checks and open comments; Send sends it" })))
        .when(open, (e) => e.child(this.button(`auto-${key}`, auto ? "Auto-fix on" : "Auto-fix", "a", (cx) => this.toggleAuto(space, key, cx), t, { active: auto, tooltip: "Send each new CI failure and trusted review comment to this space's agent" })))
        .when(open && pr.checks.failed.length > 0, (e) => e.child(this.button(`rerun-${key}`, "Re-run", "r", (cx) => this.rerun(pr, cx), t)))
        .when(pr.newComments > 0, (e) => e.child(this.button(`seen-${key}`, "Seen", "s", () => this.markSeen(key), t)))
        .child(this.button(`untrack-${key}`, ref.branch ? "Hide" : "Untrack", "x", () => this.remove(space, ref), t)));
  }

  // ---- Inbox ----

  inboxRows(space, t) {
    const l = this.lists;
    const out = [];
    if (l.error) out.push(this.errorLine(t, `GitHub: ${l.error}.${l.at ? ` Showing data from ${ago(l.at)}.` : ""}`, (cx) => this.loadLists(cx)));
    if (!l.at) {
      if (!l.error) out.push(...[0.8, 0.6, 0.7].map((f, i) => this.skeleton(t, i, f)));
      return out;
    }
    const { groups } = this.inbox();
    const total = groups.turn.length + groups.waiting.length + groups.drafts.length;
    if (!total) {
      out.push(v_flex().id("inbox-empty").flex_none().px(12).py(12).gap(4)
        .child(div().text_size(13).text_color(t.foreground).child("Nothing needs you."))
        .child(div().text_size(12).text_color(t.dim).child("No open PRs by you or for your review.")));
      return out;
    }
    const folded = this.foldedSections();
    for (const [id, label] of SECTIONS) {
      const list = groups[id];
      if (!list.length && id !== "turn") continue;
      out.push(h_flex().id(`section-${id}`).h(SECTION).flex_none().px(12).gap(6).items_center().text_size(11).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.muted))
        .on_click((_e, cx) => { edit((s) => { s.inboxFolded = { ...this.foldedSections(), [id]: !folded[id] }; }); cx.notify(); })
        .child(svg(iconOf(folded[id] ? "chevron-right" : "chevron-down")).size(10).text_color(t.dim))
        .child(div().child(`${label.toUpperCase()}${list.length ? ` · ${list.length}` : ""}`)));
      if (folded[id]) continue;
      if (!list.length) out.push(div().id("turn-empty").h(SECTION).flex_none().px(12).flex().items_center().text_size(12).text_color(t.dim).child("Nothing needs you."));
      for (const r of list) {
        out.push(this.inboxRowEl(space, r, t));
        if (this.expanded === r.key) out.push(this.inboxDetails(space, r, t));
      }
    }
    return out;
  }

  inboxRowEl(space, r, t) {
    const row = r.row;
    const tracked = space ? this.linked(space).some((x) => gh.keyOf(x) === r.key) : false;
    const reviewers = (row.reviews ?? []).map((x) => `${x.author} ${x.state.toLowerCase().replace("_", " ")}`).join(", ");
    const tip = [row.title, r.key, row.headRef ? `${row.headRef} → ${row.baseRef}` : "", reviewers, r.unread ? "New since you looked" : "",
      tracked ? `Tracked in ${space.name}` : ""].filter(Boolean).join("\n");
    const quiet = Date.now() - Date.parse(row.updatedAt) > 30 * 86_400_000;
    return this.rowEl(t, {
      key: r.key, title: row.title, titleColor: row.isDraft || quiet ? t.muted : t.foreground, glyph: this.glyph(t, { state: "OPEN", draft: row.isDraft }),
      unread: r.unread, age: age(row.updatedAt), url: row.url, short: gh.shortName(row), status: r.status, tip,
      onOpen: (cx) => this.openRow(space, r.key, cx), openIn: space ? (cx) => this.openIn(space, r.key, cx) : null,
    });
  }

  /** The expanded Inbox row: who reviewed, then Review, Track and GitHub. */
  inboxDetails(space, r, t) {
    const row = r.row;
    const tracked = space ? this.linked(space).some((x) => gh.keyOf(x) === r.key) : true;
    const reviewers = (row.reviews ?? []).map((x) => `${x.author} ${x.state.toLowerCase().replace("_", " ")}`).join(", ");
    return v_flex().id(`more-${r.key}`).flex_none().pl(34).pr(12).pb(8).gap(4)
      .child(div().text_size(11).text_color(t.dim).truncate().child(reviewers || "No reviews yet"))
      .child(h_flex().gap(6).flex_wrap()
        .child(this.button(`lr-review-${r.key}`, "Review", "⏎", (cx) => this.openRow(space, r.key, cx), t))
        .when(!tracked, (e) => e.child(this.button(`lr-track-${r.key}`, "Track", "t", (cx) => this.addRefs(space, r.key, cx, { announce: true }), t)))
        .when(Boolean(space), (e) => e.child(this.button(`lr-openin-${r.key}`, "Open in…", "O", (cx) => this.openIn(space, r.key, cx), t, { tooltip: "Its checkout in an editor" })))
        .child(this.button(`lr-open-${r.key}`, "GitHub", "o", () => openUrl(row.url), t)));
  }

  /** A loading row, exactly ROW high, still. */
  skeleton(t, i, f) {
    return v_flex().id(`skeleton-${i}`).h(ROW).flex_none().px(12).py(9).gap(8)
      .child(div().h(10).w(Math.round(240 * f)).rounded(RADIUS.small).bg(t.border))
      .child(div().ml(22).h(8).w(Math.round(140 * f)).rounded(RADIUS.small).bg(t.border));
  }

  errorLine(t, text, retry) {
    return h_flex().id("panel-error").h(SECTION).flex_none().px(12).gap(6).items_center().text_size(12).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip("Try again").on_click((_e, cx) => { retry(cx); cx.notify(); })
      .child(div().flex_none().text_color(t.ansi1).child("✗")).child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(text));
  }

  // ---- frame ----

  chooserEl(t) {
    const c = this.choose;
    return v_flex().id("chooser").mx(10).mt(8).p(10).gap(4).rounded(RADIUS.field).border_1().border_color(t.input).bg(t.popover).flex_none()
      .child(div().text_size(13).font_semibold().child(`Open ${c.key} in which space?`))
      .child(div().text_size(11).text_color(t.dim).child(c.fits.size ? "Spaces with its repo or tracking it come first." : "No space has its repo checked out or tracks it."))
      .children(c.list.map((id, i) => {
        const space = spaces().find((s) => s.id === id);
        if (!space) return div();
        return h_flex().id(`choose-${id}`).h(26).px(8).gap(8).items_center().rounded(RADIUS.row).cursor_pointer().text_size(13)
          .border_1().border_color(i === c.at ? t.input : CLEAR).when(i === c.at, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.choose = null; this.openReview(space, { key: c.key }); cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().child(space.name))
          .when(c.fits.has(id), (e) => e.child(div().text_size(11).text_color(t.ansi2).child("fits")));
      }))
      .child(div().text_size(11).text_color(t.dim).child("j/k · ⏎ open · esc cancel"));
  }

  /** The fix prompt as it will go out, word for word, with Send and Cancel. */
  confirmEl(t) {
    const c = this.confirm;
    return v_flex().id("fix-confirm").mx(10).mt(8).p(10).gap(8).rounded(RADIUS.field).border_1().border_color(t.input).bg(t.popover).flex_none()
      .child(div().text_size(13).font_semibold().child(`Send this to the agent in ${spaces().find((s) => s.id === c.space)?.name ?? "the space"}?`))
      .when(c.outside > 0, (e) => e.child(div().text_size(11).text_color(t.ansi3)
        .child(`${c.outside} comment${c.outside === 1 ? " is" : "s are"} from outside the repo. Read ${c.outside === 1 ? "it" : "them"} before sending.`)))
      .child(div().id("fix-confirm-text").max_h(240).overflow_y_scrollbar().p(8).rounded(RADIUS.small).bg(t.surface)
        .font_family(mono()).text_size(11).text_color(t.foreground)
        .children(c.text.split("\n").map((line) => div().child(line || " "))))
      .child(h_flex().gap(6).justify_end()
        .child(this.button("fix-cancel", "Cancel", "esc", () => { this.confirm = null; }, t))
        .child(this.button("fix-send", "Send", "⏎", (cx) => this.sendConfirmed(cx), t, { active: true })));
  }

  root(id, t, space) {
    const focused = this.handle.is_focused();
    return v_flex().id(id).size_full().min_h(0).rounded(RADIUS.field).overflow_hidden().bg(t.background).border_1()
      .border_color(focused ? t.input : t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_hover((h, cx) => {
        this.pointerIn = h;
        // The order froze while the pointer was here; it sorts again when it leaves.
        if (!h) { this.hoverKey = null; cx.notify(); }
      })
      .on_mouse_down("left", (_e, cx) => { if (!this.typing) this.handle.focus(); cx.notify(); })
      .on_key_down((e, cx) => {
        if (this.typing) {
          if (e.key === "escape") { this.adding = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
          return;
        }
        if (this.onKey(e, space, cx)) { cx.stop_propagation(); cx.notify(); }
      })
      .on_size_change((size) => { this.width = size.width; });
  }

  /** The folded panel: each tracked PR's glyph and number; the number is bright when it is your turn. */
  rail(space, list, t) {
    return this.root("review-rail", t, space).items_center().py(8).gap(10)
      .child(div().id("expand").size(26).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Show pull requests (⌘⌥⇧G)")
        .on_click((_e, cx) => { this.toggle(); cx.notify(); })
        .child(svg(iconOf("chevron-left")).size(14).text_color(t.muted)))
      .children(list.map((ref) => {
        const key = gh.keyOf(ref), got = this.trackedStatus(space, key), pr = got?.pr;
        return v_flex().id(`rail-${key}`).items_center().gap(2).cursor_pointer().rounded(RADIUS.small).px(2).py(4).hover((s) => s.bg(t.hover))
          .tooltip(`${key}${pr?.title ? `: ${pr.title}` : ""}${got ? `\n${got.status.phrase}` : ""}`)
          .on_click((_e, cx) => { this.sel = key; this.expanded = key; this.toggle(); cx.notify(); })
          .child(div().relative().size(14).flex().items_center().justify_center().child(this.glyph(t, { state: pr?.state, draft: pr?.isDraft }))
            .when(Boolean(pr?.newComments), (e) => e.child(div().absolute().top(-2).right(-2).size(6).rounded_full().bg(t.accent))))
          .child(div().text_size(12).text_color(got?.status.group === "turn" ? t.foreground : t.dim).child(String(ref.number)))
          .child(div().w(12).h(2).rounded(RADIUS.small).bg(pr?.checks?.failed?.length ? t.ansi1 : CLEAR));
      }))
      .child(div().flex_1())
      .child(reviewButton(t, "rail-review", this.back, { compact: true }));
  }

  tabsRow(t) {
    const tab = this.tab();
    const turn = this.lists.at ? this.inbox().groups.turn.length : 0;
    const tabEl = (id, label, count) => h_flex().id(`tab-${id}`).h(24).px(10).gap(5).items_center().rounded(RADIUS.small).cursor_pointer().text_size(12)
      .bg(tab === id ? t.selected : CLEAR).text_color(tab === id ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { this.setTab(id, cx); this.handle.focus(); cx.notify(); })
      .child(label)
      // The count keeps its room when it is 0, so the tab never changes width.
      .when(count !== null, (e) => e.child(div().min_w(16).text_size(11).text_color(t.foreground).child(count ? String(count) : "")));
    return h_flex().h(28).flex_none().px(10).pt(4).gap(4).items_center()
      .child(tabEl("space", "Space", null))
      .child(tabEl("inbox", "Inbox", turn))
      .child(div().flex_1())
      .child(div().id("track").size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip("Track a PR in this space (i)").on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { this.openInput(); cx.notify(); })
        .child(svg(iconOf("plus")).size(12).text_color(t.muted)));
  }

  keysEl(t) {
    return v_flex().id("panel-keys").mx(10).mb(4).p(10).gap(2).rounded(RADIUS.float).border_1().border_color(t.border).bg(t.popover).flex_none()
      .children(KEYS[this.tab()].map(([k, what]) => h_flex().h(18).gap(8).text_size(12)
        .child(div().w(56).flex_none().font_family(mono()).text_size(11).text_color(t.muted).child(k))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(what))));
  }

  render(cx) {
    const t = theme(), space = this.activeSpace();
    // A new space, or a branch switched in this one: look again now, not at the next tick.
    if (space && !this.polling && this.branch[space.id]?.sig !== whereOf(space).sig) {
      this.poll(cx);
      this.loadLocal(space, cx);
    }
    if (space && !this.local[space.id]) this.loadLocal(space, cx);
    const tab = this.tab();
    if (!this.lists.at && !this.lists.loading && !this.lists.error) this.loadLists(cx);
    const list = this.linked(space);
    const keys = this.rows(space);
    if (!keys.includes(this.sel)) this.sel = keys[0] ?? null;
    if (store().collapsed) return this.rail(space, list, t);
    const focused = this.handle.is_focused();
    const busy = this.polling || this.lists.loading;
    const body = v_flex().id(`list-${tab}`).flex_1().min_h(0).overflow_y_scrollbar().border_t(1).border_color(t.border)
      .when(Boolean(this.note), (e) => e.child(this.errorLine(t, this.note, (cx) => { this.note = null; this.poll(cx); })))
      .when(tab === "space" && Boolean(space), (e) => e.children(this.spaceRows(space, t)))
      .when(tab === "inbox", (e) => e.children(this.inboxRows(space, t)));
    return this.root("review-panel", t, space)
      .child(h_flex().h(36).flex_none().pl(12).pr(6).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().id("panel-title").font_semibold().text_size(13).tooltip("⌘⌥G to use the keyboard here").child("Pull requests"))
        .child(div().flex_1())
        .when(Boolean(store().dryRun), (e) => e.child(div().text_size(12).text_color(t.ansi3).child("dry run")))
        .child(div().id("refresh").size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover))
          .tooltip(`Refresh (R)${this.polledAt ? ` · updated ${ago(this.polledAt)}` : ""}`)
          .on_click((_e, cx) => { this.refresh(space, cx); cx.notify(); })
          .child(busy ? svg(iconOf("spinner")).size(12).text_color(t.muted).spin(900) : div().text_size(13).text_color(t.muted).child("↻")))
        .child(div().id("collapse").size(24).flex().items_center().justify_center().rounded(RADIUS.small).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Fold to a rail (⌘⌥⇧G)")
          .on_click((_e, cx) => { this.toggle(); cx.notify(); })
          .child(svg(iconOf("chevron-right")).size(14).text_color(t.muted))))
      .child(this.tabsRow(t))
      .when(this.adding || this.typing, (e) => e.child(h_flex().h(36).flex_none().px(10).py(3)
        .child(div().id("add-pr").flex_1().min_w(0).h(30).px(10).flex().items_center().rounded(RADIUS.field).border_1().border_color(this.typing ? t.input : t.border).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))))
      .when(Boolean(this.choose), (e) => e.child(this.chooserEl(t)))
      .when(Boolean(this.openChoice), (e) => e.child(div().mx(10).mt(8).flex_none().child(choiceEl(t, this, (cx) => cx.notify(), { width: null }))))
      .when(Boolean(this.confirm), (e) => e.child(this.confirmEl(t)))
      .child(div().h(4).flex_none())
      .child(body)
      .when(Boolean(this.keysOpen), (e) => e.child(this.keysEl(t)))
      .child(h_flex().flex_none().h(28).pl(12).pr(6).gap(8).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(focused ? "j/k · ⏎ review · space more · ? keys" : ""))
        .child(reviewButton(t, "panel-review", this.back)));
  }
}
