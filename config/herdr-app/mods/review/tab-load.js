// The review tab's loading: the local checkout's or a PR's diff per scope, newest load wins, and the scope switch.
import { run } from "herdr";
import * as gh from "./gh.js";
import { hasCommit, localState, prFiles, revDiff, scopeDiff } from "./diff.js";
import * as sc from "./scopes.mjs";
import { checkoutOf, editDrafts, localBase, putStatus, savedScope, saveScope } from "./store.js";
import { hashFiles, highlightAll } from "./highlight.js";

export class TabLoading {
  /**
   * Reads the scope's diff. A newer load wins: an older one that finishes later changes nothing, its error
   * included. `force` starts a new load even while one runs (a scope switch); `reuse` keeps the PR head, its
   * commits and reviews (one call for the scope's diff instead of five); `scopeOnly` keeps the local
   * checkout's state; `quiet` is a background check: the diff does not dim. The old diff stays until the new
   * one is there, and when the new one is the same, nothing on screen changes.
   */
  load(cx, { force = false, reuse = false, scopeOnly = false, quiet = false } = {}) {
    if (!force && this.loading && Date.now() - this.loadStarted < 90_000) return this.loadPromise;
    this.loading = true;
    this.quiet = quiet && this.rows.length > 0;
    this.slow = false;
    this.loadStarted = Date.now();
    const gen = ++this.loadGen;
    const current = () => gen === this.loadGen;
    // A progress bar only for a load that takes a while: a quick one would just flash.
    try { cx.timer.after(150, (cx) => { if (current() && this.loading && !this.quiet) { this.slow = true; this.redraw(cx, ["diff"]); } }); } catch { /* no timer in tests */ }
    if (this.local && this.p.smart && !this.smartDone) { this.smartDone = true; this.findBranchPr(cx); }
    this.loadPromise = new Promise((resolve) => { cx.spawn(async (cx) => {
      const pause = () => cx.sleep(0);
      try {
        if (this.local) await this.loadLocal(current, { scopeOnly, pause });
        else await this.loadPr(current, { reuse, pause });
        if (!current()) return;
        this.error = null;
        if (this.scopePicked) { this.scopePicked = false; saveScope(this.scopeRepo(), sc.scopeKey(this.scope), this.info?.sha ?? null); }
        this.renameTab();
        this.colorize(cx, gen);
      } catch (e) {
        if (!current()) return;
        const message = String(e?.message ?? e ?? `Native runtime interrupted while trying to ${this.loadPhase}`);
        this.scopePicked = false;
        if (this.rows.length && this.loadedScope) {
          // A failed switch keeps the diff that shows, and its scope; the reason goes in the footer.
          this.say(`Couldn't show ${sc.scopeName(this.scope, this.local)}: ${message}`);
          if (!sc.sameScope(this.scope, this.loadedScope)) { this.scope = this.loadedScope; this.agent.resetRecord(); this.renameTab(); }
          this.error = null;
        } else {
          // Nothing of this review to keep (a first load, or a smart tab that became a PR): the error shows.
          if (!this.loadedScope) { this.files = []; this.rows = []; this.display = null; }
          this.error = message;
        }
        this.view.report?.("load", e, cx);
      } finally {
        if (current()) { this.loading = false; this.quiet = false; this.slow = false; }
        if (current()) this.redraw(cx);
        resolve();
      }
    }); });
    return this.loadPromise;
  }

  /** The local checkout's diff. Everything is read first; the tab changes only if this load is still the newest. */
  async loadLocal(current, { scopeOnly, pause }) {
    this.loadPhase = "resolve checkout";
    const space = this.space();
    if (!space) throw new Error("This tab's space is gone");
    const where = this.checkout?.space === space.id && Date.now() - this.checkout.at < 2000 ? this.checkout.where : await checkoutOf(space);
    if (!where) throw new Error(`No git checkout in ${space.name}`);
    if (!current()) return;
    this.loadPhase = "read local state";
    // A scope switch keeps the checkout's state: only the scope's own diff is read.
    const info = scopeOnly && this.info?.root === where.root ? this.info : { ...await localState(where.root, where.on, this.p.base, localBase(where.root)), on: where.on };
    if (!current()) return;
    const scope = this.resolveScope(info);
    this.loadPhase = "read local comparison";
    const d = await scopeDiff(info.root, where.on, scope, info.mergeBase, pause);
    if (!current()) return;
    this.info = info;
    this.scope = scope;
    this.meta = { title: "Local changes", head: info.branch, sha: info.sha, base: info.base ?? "HEAD", from: d.from, scope: sc.scopeKey(scope), root: info.root, threads: [], checks: null };
    this.loadPhase = "index local rows";
    const key = `${sc.scopeKey(scope)}\0${d.from}\0${d.text}`;
    if (key !== this.loadedKey || !this.rows.length) { this.setFiles(d.files); this.loadedKey = key; this.version++; }
    this.loadedScope = scope;
  }

  /** A PR scope's diff, from GitHub (or a checkout when GitHub can't build it). */
  async loadPr(current, { reuse, pause }) {
    if (!this.ref) throw new Error(`Not a PR: ${this.p.pr}`);
    this.loadPhase = "read PR comparison";
    if (!reuse || !this.head) {
      const got = await this.fetchHead();
      if (!current()) return;
      this.applyHead(got);
    }
    const head = this.head;
    const scope = this.resolveScope(this.info);
    let meta = { ...head.meta, headSha: head.meta.sha }, files = head.files;
    if (!sc.isDefault(scope, false)) {
      this.loadPhase = "read PR scope";
      const from = scope.kind === "since" ? this.info.since.sha : scope.base ?? `${scope.from}^`;
      const to = scope.kind === "since" ? head.meta.sha : scope.to;
      meta = { ...meta, scope: sc.scopeKey(scope), sha: to, baseSha: from };
      // The header names the scope while its diff loads (and when it fails).
      this.scope = scope;
      if (!this.rows.length) this.meta = meta;
      try {
        files = prFiles(await gh.fetchScopeFiles(sc.prScopeApi(this.ref.repo, scope, { head: head.meta.sha, since: this.info.since?.sha })));
      } catch (e) {
        files = await this.localScopeFiles(from, to, scope, e, pause);
      }
      // Since review: only the PR's own files. A merge of the base in between would bring in everything else.
      if (scope.kind === "since") { const own = new Set(head.files.map((f) => f.path)); files = files.filter((f) => own.has(f.path)); }
      if (!current()) return;
    }
    this.scope = scope;
    this.meta = meta;
    // The same commits and scope: the rows stay (cursor, colors); only the threads and checks are new.
    const key = `${sc.scopeKey(scope)}\0${meta.sha}\0${meta.baseSha}`;
    if (key !== this.loadedKey || !this.rows.length) { this.setFiles(files); this.loadedKey = key; }
    this.version++;
    this.loadedScope = scope;
  }

  /**
   * ⌘R's tab opens as local changes at once; this asks, beside the local load, whether the checkout is on an
   * open PR's head branch. Then the tab becomes that PR's review, and the local diff shows until the PR's does.
   */
  findBranchPr(cx) {
    cx.spawn(async (cx) => {
      try {
        const space = this.space();
        const where = space ? await checkoutOf(space).catch(() => null) : null;
        if (where) this.checkout = { space: space.id, where, at: Date.now() };
        const pr = where ? await gh.branchPr(where.root, where.on, where.branch).catch(() => null) : null;
        if (!pr || !this.local) return;
        this.adopt(pr);
        this.load(cx, { force: true });
        this.redraw(cx);
      } catch (e) { this.view.report?.("find PR", e, cx); }
    });
  }

  /**
   * When GitHub can't build a scope's diff (too big or too slow), a local checkout of the repo that has both
   * commits builds it. Else the error says what to do.
   */
  async localScopeFiles(from, to, scope, error, pause) {
    const space = this.space();
    const at = space && await checkoutOf(space, { repo: this.ref.repo });
    const why = String(error?.message ?? error).replace(/^gh: /, "");
    if (!at) throw new Error(`GitHub can't show this diff (${why}). A checkout of ${this.ref.repo} in this space can.`);
    const base = from.endsWith("^") ? from.slice(0, -1) : from;
    for (const sha of [base, to]) if (!await hasCommit(at.root, at.on, sha)) throw new Error(`GitHub can't show this diff (${why}), and your checkout has no ${sha.slice(0, 7)}: git fetch, then R`);
    const own = scope.kind === "since" ? this.head.files.map((f) => f.path) : null;
    return revDiff(at.root, at.on, from, to, own, pause);
  }

  /** The PR head: its detail, files, commits and reviews, and where "Since review" starts. Changes nothing. */
  async fetchHead() {
    // The files and the head commit must agree: a push between the two reads means read again.
    let meta, files, consistent = false;
    const side = Promise.all([gh.fetchCommits(this.ref).catch(() => []), gh.fetchReviews(this.ref).catch(() => [])]);
    for (let i = 0; i < 3; i++) {
      [meta, files] = await Promise.all([gh.fetchDetail(this.ref), gh.fetchFiles(this.ref)]);
      const now = await gh.comparisonRefs(this.ref);
      if (now.sha === meta.sha && now.baseSha === meta.baseSha) { consistent = true; break; }
    }
    if (!consistent) throw new Error("The PR changed repeatedly while loading. Reload to try again.");
    const [raw, reviews] = await side;
    // Oldest first, as GitHub lists them; the picker shows them newest first.
    const commits = raw.map(sc.ghCommit).map((c) => ({ ...c, ...(this.details.get(c.sha) ?? {}) }));
    return { meta, files: prFiles(files), commits, reviews };
  }

  /** Applies fetchHead's result (only for the newest load). */
  applyHead({ meta, files, commits, reviews }) {
    const marks = this.viewedMarks();
    const since = sc.sinceBase({ reviews, viewer: meta.viewer, commits, viewed: (c) => sc.commitViewed(marks, c) });
    const newSince = since ? sc.commitsAfter(commits, since.sha) ?? commits.length : 0;
    this.head = { meta, files };
    this.headIndex = sc.lineIndex(files);
    this.info = { commits: [...commits].reverse(), since, newSince, viewer: meta.viewer, sha: meta.sha };
    putStatus({ [this.dkey]: { repo: this.ref.repo, title: meta.title, state: meta.state, checks: meta.checks, head: meta.head, base: meta.base, at: Date.now() } });
    // Drafts from before this tab knew the head commit belong to the one it shows now.
    if (this.notes().some((n) => !n.sha)) editDrafts(this.dkey, (d) => { for (const n of d.notes) n.sha ??= meta.sha; });
  }

  /**
   * The scope to load: the one picked (a commit range is checked against the commit list), else the saved one
   * or the smart default (scopes.defaultScope).
   */
  resolveScope(info = this.info) {
    const list = info?.commits ?? [];
    const fill = (s) => {
      if (!sc.isCommits(s)) return s;
      const rows = sc.rowsOfScope(list, s);
      return rows ? sc.commitsScope(list, rows[0], rows[1]) : null;
    };
    let s = this.scope ? fill(this.scope) : null;
    if (this.scope && !s) this.say("That commit is not on this branch any more: back to the default scope");
    if (s?.kind === "since" && !info?.since) s = null;
    if (!s) {
      s = sc.defaultScope({ local: this.local, ahead: info?.ahead ?? 0, newSince: info?.newSince ?? 0,
        saved: savedScope(this.scopeRepo(info)), sig: info?.sha ?? null, valid: (x) => Boolean(fill(x)) && (x.kind !== "since" || Boolean(info?.since)) });
      s = fill(s) ?? { kind: this.local ? "branch" : "all" };
    }
    return s;
  }

  /**
   * Switches the scope. The walkthrough and threads of each scope stay saved; the Agent panel shows this
   * scope's. The choice is saved per repo with the head commit it was made on, once its diff loaded.
   */
  setScope(scope, cx) {
    if (!scope) return;
    if (this.agent.running) return this.say("An agent is working on this scope: wait for it, or Esc to cancel it");
    this.picker = null; this.baseMenu = null;
    if (sc.sameScope(scope, this.scope)) return;
    if (!sc.isCommits(this.scope)) this.prevScope = this.scope;
    this.scope = scope;
    this.scopePicked = true;
    this.bannerClosed = false;
    this.agent.resetRecord();
    this.renameTab();
    this.load(cx, { force: true, reuse: !this.local, scopeOnly: this.local });
    this.redraw(cx);
  }

  /** 1 / 2: the first two segments; Since review needs a review (or a viewed commit). */
  pickSegment(n, cx) {
    if (n === 1) return this.setScope({ kind: this.local ? "uncommitted" : "all" }, cx);
    if (this.local) return this.setScope({ kind: "branch" }, cx);
    if (!this.info?.since) return this.say("Nothing reviewed yet: Since review starts at your first review");
    this.setScope({ kind: "since" }, cx);
  }

  /** The tab's title names the scope: "dotfiles · Branch", "FramerStudio#41167 · Since review". */
  renameTab() {
    const base = this.local ? (this.info?.root ?? "").split("/").pop() || "local" : this.name;
    const title = `${base} · ${sc.scopeName(this.scope, this.local)}`;
    if (title === this.title || !this.myTab) return;
    this.title = title;
    run("tab.rename", { id: this.myTab, name: title });
  }

  /**
   * Back on the tab: a background check. A PR reads only its head and base (one gh call) and loads when they
   * moved; a local diff is read again, and shows only if it changed. Nothing dims, the cursor stays.
   */
  refreshIfMoved(cx) {
    if (this.loading || this.pending || this.modal) return;
    if (Date.now() - (this.movedAt ?? 0) < 5000) return;
    this.movedAt = Date.now();
    if (this.local) { this.load(cx, { quiet: true }); return; }
    cx.spawn(async (cx) => {
      try {
        const now = await gh.comparisonRefs(this.ref);
        if (now.sha !== this.headSha() || now.baseSha !== this.head?.meta.baseSha) this.load(cx, { quiet: true });
      } catch { /* offline: keep what is shown */ }
    });
  }

  /** Syntax colors, after the plain diff shows: rows get `spans`, then the diff redraws. */
  colorize(cx, gen) {
    // Colors run nvim here, so a space on another machine stays plain.
    if (this.local && this.info?.on) return;
    const files = this.files, rows = this.rows, fileStart = this.fileStart;
    if (rows === this.colored) return;
    this.colored = rows;
    const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    cx.spawn(async (cx) => {
      const pause = () => cx.sleep(0);
      const stale = () => rows !== this.rows || gen !== this.loadGen;
      try {
        // The cache key: the head commit for a PR; the diff's content (hashed in slices) for local changes.
        const rev = this.local ? `l${await hashFiles(files, pause)}` : this.meta.sha;
        if (stale()) return;
        await highlightAll({ files, rows, fileStart, rev, tag, pause, stale });
      } catch (e) {
        console.error(`review: syntax colors: ${e}`);
      }
      if (rows === this.rows) this.redrawCol("diff", cx);
    });
  }

  reloadThreads(cx) {
    if (this.local || !this.ref) return;
    const gen = this.loadGen;
    cx.spawn(async (cx) => {
      try {
        const meta = await gh.fetchDetail(this.ref);
        if (gen !== this.loadGen || this.local) return;
        // A push since: files, lines and drafts' anchors all move together, so it is a full load.
        if (meta.sha !== this.headSha() || meta.baseSha !== this.head?.meta.baseSha) this.load(cx);
        else { this.meta = { ...this.meta, threads: meta.threads, more: meta.more }; if (this.head) this.head.meta = { ...this.head.meta, threads: meta.threads, more: meta.more }; this.version++; }
      } catch (e) { this.say(`Reload failed: ${e.message ?? e}`); }
      this.redraw(cx);
    });
  }
}
