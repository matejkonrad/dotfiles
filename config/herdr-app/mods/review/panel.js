// The review panel: the PRs of the shown space (Space) and the PRs that need you on GitHub (Inbox), in a panel
// on the right that folds to a rail. A space tracks its branch's PR by itself, plus PRs added by hand or by an
// agent (review.track). Each row says one thing: what must happen next (pr-status.mjs). One `gh api graphql`
// call per poll reads every tracked PR; one more reads the Inbox. Auto-fix sends new CI failures and trusted
// review comments to the space's agent. The view is in panel-view.js.
import { InputState } from "gpui-base";
import { spaces, agents, hc, run, layout, notify, shared, setShared } from "herdr";
import { openUrl } from "./ui.js";
import { mixin } from "./util.mjs";
import * as gh from "./gh.js";
import { localSummary } from "./diff.js";
import { BRANCH_PRS, markPanelFocus, runHere } from "./here.js";
import { choiceKey, openFolder, withCheckout } from "./open-in.js";
import { watchFocus } from "./launcher.js";
import { editDrafts, store, spaceState, edit, editSpace, migrate, whereOf, checkoutOf, resolveSpace, reviewTab, tabName, putStatus, statusOf, localBase } from "./store.js";
import { prStatus, inboxFacts, groupRows, mergeInbox } from "./pr-status.mjs";
import { PanelView, PANEL_RAIL, SECTIONS, LOCAL } from "./panel-view.js";

const TICK_MS = 10_000;
// How often to ask GitHub: fast while CI runs, slow when nothing is open.
const POLL_RUNNING_MS = 30_000;
const POLL_OPEN_MS = 90_000;
const POLL_IDLE_MS = 300_000;
// The Inbox: every 3 minutes while it shows, every 10 while the Space tab shows (for its count).
const LISTS_MS = 180_000;
const LISTS_SPACE_MS = 600_000;
// The Local changes row runs a few git commands: every 30 s at most, never while folded or still running.
const LOCAL_MS = 30_000;
const REPO_RETRY_MS = 5 * 60_000;
const WIDTH = 360;
const DEFAULT_BRANCHES = new Set(["main", "master", "develop", "trunk"]);
// `review.tab:<name>`: the old tab names still work.
const TABS = { space: "space", tracked: "space", inbox: "inbox", mine: "inbox", requests: "inbox" };

function findBlock(node) {
  if (!node || typeof node !== "object") return null;
  if (node.content?.mod === "review") return node;
  for (const child of [...(node.children ?? []), ...(node.floating ?? [])]) {
    const found = findBlock(child);
    if (found) return found;
  }
  return null;
}

/** The agent auto-fix talks to: a Claude Code one if the space has one, a free one before a busy one. */
function agentFor(space) {
  const all = agents().filter((a) => a.space === space.id);
  const claude = all.filter((a) => /claude/i.test(a.app ?? "") || a.program?.key === "claude");
  const pool = claude.length ? claude : all;
  const free = pool.find((a) => a.status === "idle" || a.status === "done");
  return { agent: free ?? pool[0] ?? null, free: Boolean(free) };
}

/** A command's argument: `track:{"pr":"o/r#1"}` gives the object, `track:o/r#1` gives {pr: "o/r#1"}. */
function argsOf(rest) {
  const text = rest.trim();
  if (!text) return {};
  if (text.startsWith("{")) {
    try { return JSON.parse(text); } catch { return { error: `Not JSON: ${text}` }; }
  }
  return { pr: text };
}

export class Panel {
  constructor(view, cx) {
    this.view = view;
    migrate();
    this.status = {};
    this.branch = {};
    this.repos = {};
    this.local = {};
    this.lists = { mine: [], requests: [], team: [], viewer: null, at: 0, error: null, loading: false };
    this.expanded = null; // the one expanded row's key
    this.sel = null; // the selected row's key: it stays with the PR when rows move
    this.note = null;
    this.typing = false;
    this.adding = false; // the "track a PR" input shows
    this.lastPoll = 0;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Track a PR: URL, owner/repo#12 or #12" });
    this.input.on("submit", (_e, cx) => { this.add(cx); this.adding = false; this.handle.focus(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    // The Review button reads "Back" while a review tab has the focus.
    watchFocus(this, cx);
    cx.timer.every(TICK_MS, (cx) => {
      if (Date.now() - this.lastPoll >= this.interval()) this.poll(cx);
      // The Inbox count stays current while the Space tab shows, at a slower pace.
      if (Date.now() - this.lists.at >= (this.tab() === "inbox" ? LISTS_MS : LISTS_SPACE_MS)) this.loadLists(cx);
      const space = this.activeSpace();
      if (space && Date.now() - (this.local[space.id]?.at ?? 0) >= LOCAL_MS) this.loadLocal(space, cx);
      // Ages move on; the folded rail shows none.
      if (!store().collapsed) cx.notify();
    });
    this.poll(cx);
  }

  activeSpace() { return spaces().find((s) => s.active) ?? null; }

  /** "space" or "inbox". Older stores say tracked, mine or requests. */
  tab() {
    const t = store().tab;
    return t === "inbox" || t === "mine" || t === "requests" ? "inbox" : "space";
  }

  // ---- commands (herdr-app do review.<name>) ----
  command(command, cx) {
    const at = command.indexOf(":");
    const name = at < 0 ? command : command.slice(0, at);
    const args = at < 0 ? {} : argsOf(command.slice(at + 1));
    if (args.error) return notify({ title: "review", body: args.error, level: "error" });
    // `review.here` (⌘R): the launcher handles it too; the shared lock lets one act (here.js).
    if (name === "here") { runHere(); return; }
    if (name === "toggle") this.toggle();
    else if (name === "focus") this.focus(cx);
    else if (name === "refresh") {
      this.poll(cx);
      this.loadLists(cx);
      const space = this.activeSpace();
      if (space) this.loadLocal(space, cx, true);
    }
    // `review.tab:mine` and `review.tab:requests` (older scripts) open the Inbox.
    else if (name === "tab" && TABS[args.pr]) this.setTab(TABS[args.pr], cx);
    else if (name === "dryrun") edit((s) => { s.dryRun = args.pr !== "off"; });
    // `review.forget:{"pr":"o/r#1","type":"agent"}`: that review's drafts go (for scripts and tests); type sets its review type.
    else if (name === "forget" && args.pr) editDrafts(args.pr, (d) => { d.notes = []; delete d.inflight; d.type = args.type ?? null; });
    else if (name === "cleanup") edit((s) => { delete s.probe; });
    else if (name === "track" || name === "add") {
      const space = resolveSpace(args);
      if (!space) return notify({ title: "review.track", body: `No space for ${JSON.stringify(args)}`, level: "error" });
      if (!args.pr) return notify({ title: "review.track", body: "Give a PR: {\"pr\": \"owner/repo#12\"}", level: "error" });
      this.addRefs(space, String(args.pr), cx, { announce: true });
    } else if (name === "untrack") {
      const space = resolveSpace(args);
      const key = space && this.keyFor(space, String(args.pr ?? ""));
      if (!key) return notify({ title: "review.untrack", body: `Not tracked: ${args.pr ?? "?"}`, level: "error" });
      const ref = this.linked(space).find((r) => gh.keyOf(r) === key) ?? { ...gh.parseKey(key), branch: false };
      this.remove(space, ref);
    } else if (name === "open") {
      if (args.local) {
        const space = resolveSpace(args);
        if (!space) return notify({ title: "review.open", body: "No such space", level: "error" });
        return this.openReview(space, { local: true, scope: args.scope ?? null });
      }
      const given = args.space ? resolveSpace({ space: args.space }) : null;
      if (args.space && !given) return notify({ title: "review.open", body: `No space ${args.space}`, level: "error" });
      const key = this.keyFor(given ?? this.activeSpace() ?? spaces()[0], String(args.pr ?? ""));
      if (!key) return notify({ title: "review.open", body: `Not a PR: ${args.pr ?? "(none)"}`, level: "error" });
      if (given) this.openReview(given, { key });
      else this.openSmart(key, cx);
    }
  }

  /** "owner/repo#12", a URL, or "#12" in the space's repo, as a key. */
  keyFor(space, text) {
    const repo = this.branch[space.id]?.ref?.repo ?? this.repos[`${whereOf(space).on ?? ""}|${whereOf(space).cwd}`]?.repo ?? null;
    const [ref] = gh.parseRefs(` ${text} `, repo);
    return ref ? gh.keyOf(ref) : null;
  }

  // ---- data ----
  /** The PRs linked to a space: its branch's (unless hidden), then the ones added by hand. */
  linked(space) {
    if (!space) return [];
    const st = spaceState(space.id), list = [];
    const own = this.branch[space.id]?.ref;
    if (own && !(st.hidden ?? []).includes(gh.keyOf(own))) list.push({ ...own, branch: true });
    for (const ref of st.refs ?? []) if (!list.some((one) => gh.keyOf(one) === gh.keyOf(ref))) list.push({ ...ref, branch: false });
    return list;
  }

  interval() {
    const open = Object.values(this.status).filter((pr) => pr.state === "OPEN");
    if (open.some((pr) => pr.checks.pending > 0)) return POLL_RUNNING_MS;
    return open.length ? POLL_OPEN_MS : POLL_IDLE_MS;
  }

  /** One poll at a time: a call during a poll runs one more after it. */
  poll(cx) {
    if (this.polling) { this.again = true; return; }
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        do {
          this.again = false;
          await this.pollOnce();
          cx.notify();
        } while (this.again);
      } catch (e) {
        this.note = `Refresh failed: ${e}`;
      } finally {
        this.polling = false;
        this.lastPoll = Date.now();
        cx.notify();
      }
    });
  }

  loadLists(cx) {
    if (this.lists.loading) return;
    this.lists = { ...this.lists, loading: true };
    cx.spawn(async (cx) => {
      try {
        const got = await gh.fetchLists();
        this.lists = { ...got, at: Date.now(), error: null, loading: false };
      } catch (e) {
        // The old rows stay; the error line says how old they are.
        this.lists = { ...this.lists, error: String(e.message ?? e), loading: false };
      }
      this.inboxCache = null;
      cx.notify();
    });
  }

  loadLocal(space, cx, force = false) {
    const was = this.local[space.id] ?? {};
    // One run at a time per space; a folded panel shows no counts, so it runs none (unless asked).
    if (was.busy || (store().collapsed && !force)) return;
    this.local[space.id] = { ...was, at: Date.now(), busy: true };
    cx.spawn(async (cx) => {
      let sum = was.sum ?? null;
      try {
        // The first terminal pane (focused first) that is in a git checkout, not just the first pane.
        const at = await checkoutOf(space).catch(() => null);
        sum = at ? await localSummary(at.root, at.on, localBase(at.root)).catch(() => null) : null;
      } finally {
        this.local[space.id] = { at: Date.now(), sum, busy: false };
        cx.notify();
      }
    });
  }

  async repoFor(where) {
    const id = `${where.on ?? ""}|${where.cwd}`, known = this.repos[id];
    if (known && (known.repo || Date.now() - known.at < REPO_RETRY_MS)) return known.repo;
    const repo = where.cwd ? await gh.repoOf(where.cwd, where.on) : null;
    this.repos[id] = { repo, at: Date.now() };
    return repo;
  }

  async pollOnce() {
    const all = spaces();
    const places = await Promise.all(all.map(async (s) => {
      const where = whereOf(s);
      const lookup = where.branch && !DEFAULT_BRANCHES.has(where.branch);
      return { space: s, where, repo: lookup ? await this.repoFor(where) : null };
    }));
    const lookups = places.filter((p) => p.repo).map((p) => ({ id: p.space.id, repo: p.repo, branch: p.where.branch }));
    const refs = [];
    for (const s of all) for (const ref of spaceState(s.id).refs ?? [])
      if (!refs.some((one) => gh.keyOf(one) === gh.keyOf(ref))) refs.push(ref);

    const res = await gh.fetchBatch(refs, lookups);
    // Every space gets an entry, even on failure, so the panel never asks again in a loop.
    for (const p of places) {
      // A branch with no PR (or no PR lookup: a default branch, no GitHub remote) clears the old card.
      const node = res.error ? undefined : res.branches[p.space.id] ?? null;
      const ref = node === undefined ? this.branch[p.space.id]?.ref ?? null : node ? { repo: p.repo, number: node.number } : null;
      this.branch[p.space.id] = { sig: p.where.sig, ref, node };
    }
    // ⌘R's hint: the open PR of each space's checkout, with the place it was found for (here.js prHint).
    const hints = Object.fromEntries(places.map((p) => { const node = this.branch[p.space.id].node;
      return [p.space.id, { sig: p.where.sig, pr: node?.state === "OPEN" && p.repo ? `${p.repo}#${node.number}` : null }]; }));
    if (!res.error && JSON.stringify(hints) !== JSON.stringify(shared(BRANCH_PRS) ?? {})) setShared(BRANCH_PRS, hints);
    if (res.error) {
      this.note = `GitHub: ${res.error}`;
      for (const key of Object.keys(this.status)) this.status[key] = { ...this.status[key], error: res.error };
      return;
    }
    this.note = null;

    const seen = store().seen ?? {}, next = {}, spaceOf = {};
    for (const s of all) for (const ref of this.linked(s)) {
      const key = gh.keyOf(ref);
      spaceOf[key] ??= s.id;
      if (next[key]) continue;
      const node = ref.branch ? this.branch[s.id].node ?? res.prs[key] : res.prs[key];
      next[key] = gh.toStatus({ repo: ref.repo, number: ref.number }, node, seen[key], res.viewer, this.status[key]);
    }
    for (const [key, pr] of Object.entries(next)) this.announce(this.status[key], pr, spaceOf[key]);
    this.status = next;
    this.polledAt = Date.now();
    putStatus(Object.fromEntries(Object.entries(next).filter(([, pr]) => !pr.error).map(([key, pr]) => [key,
      { title: pr.title, state: pr.state, checks: pr.checks, head: pr.headRef, base: pr.baseRef, at: this.polledAt }])));
    await this.autoFix(all);
    this.prune(all);
  }

  /** A toast when a PR's CI starts failing, it gets new comments, or it merges. */
  announce(before, pr, spaceId) {
    if (!before || before.error || pr.error) return;
    const name = gh.shortName(pr), action = { name: "space.select", args: { id: spaceId } };
    if (pr.checks.failed.length && !before.checks.failed.length)
      notify({ title: `${name}: CI failing`, body: pr.checks.failed.map((c) => c.name).join(", "), level: "error", action });
    const fresh = pr.newComments - before.newComments;
    if (fresh > 0) notify({ title: `${name}: ${fresh} new review comment${fresh === 1 ? "" : "s"}`, body: pr.title, level: "info", action });
    if (pr.state === "MERGED" && before.state !== "MERGED") notify({ title: `${name} merged`, body: pr.title, level: "success", action });
  }

  /** Each new CI failure or review comment starts one fix turn per space, not one per PR or per poll. */
  async autoFix(all) {
    const updates = {};
    for (const space of all) {
      const st = spaceState(space.id), texts = [], handled = {};
      for (const key of st.auto ?? []) {
        const pr = this.status[key];
        if (!pr || pr.error || pr.state !== "OPEN") continue;
        const done = st.handled?.[key] ?? { failed: "", newest: "" };
        const failed = pr.checks.failed.map((c) => c.name).sort().join(",");
        // Only the repo's own people and review bots go out unread; Fix (f) shows the rest before sending.
        const newest = gh.fixComments(pr).reduce((max, c) => (c.createdAt > max ? c.createdAt : max), "");
        if (failed && failed !== done.failed) texts.push(gh.ciFixPrompt(pr));
        if (newest > done.newest) texts.push(gh.reviewFixPrompt(pr));
        handled[key] = { failed, newest: newest > done.newest ? newest : done.newest };
      }
      const text = texts.filter(Boolean).join("\n\n");
      // A busy agent gets it on a later poll: nothing is marked handled until it's sent.
      if (text && !(await this.send(space, text, { onlyFree: true }))) continue;
      const changed = Object.entries(handled).filter(([key, h]) => JSON.stringify(st.handled?.[key]) !== JSON.stringify(h));
      if (changed.length) updates[space.id] = Object.fromEntries(changed);
    }
    if (Object.keys(updates).length) edit((s) => {
      for (const [id, keys] of Object.entries(updates)) Object.assign(((s.spaces[id] ??= {}).handled ??= {}), keys);
    });
  }

  /** Drops what closed local spaces and unlinked PRs left behind. Remote spaces stay: their machine may be offline. */
  prune(all) {
    const ids = new Set(all.map((s) => s.id)), linked = new Set(Object.keys(this.status));
    const st = store();
    const goneSpaces = Object.keys(st.spaces ?? {}).filter((id) => !id.includes("/") && !ids.has(id));
    const goneSeen = Object.keys(st.seen ?? {}).filter((key) => !linked.has(key));
    const goneHandled = Object.entries(st.spaces ?? {}).filter(([, s]) => Object.keys(s.handled ?? {}).some((k) => !(s.auto ?? []).includes(k)));
    if (!goneSpaces.length && !goneSeen.length && !goneHandled.length) return;
    edit((s) => {
      for (const id of goneSpaces) delete s.spaces[id];
      for (const key of goneSeen) delete s.seen[key];
      for (const space of Object.values(s.spaces)) for (const k of Object.keys(space.handled ?? {}))
        if (!(space.auto ?? []).includes(k)) delete space.handled[k];
    });
  }

  /** Sends a prompt to the space's agent, or starts Claude Code in a new tab when it has none. */
  async send(space, text, { onlyFree = false, name = "pr fix" } = {}) {
    const { agent, free } = agentFor(space);
    if (!agent) {
      run("tab.new", { space: space.id, name, argv: ["claude"], task: text });
      notify({ title: "review started Claude Code", body: `In ${space.name}, to fix the PR.`, level: "info" });
      return true;
    }
    if (onlyFree && !free) return false;
    const r = await hc(["send", agent.address, text]).catch((e) => ({ code: 1, stderr: String(e) }));
    if (r.code !== 0) {
      this.note = `Could not reach ${agent.address}: ${(r.stderr || r.stdout || "").trim()}`;
      return false;
    }
    notify({ title: "review sent a fix", body: `To ${agent.program?.name ?? "the agent"} in ${space.name}.`, level: "info", action: { name: "agent.focus", args: { terminal: agent.address } } });
    return true;
  }

  // ---- actions ----
  add(cx) {
    this.addRefs(this.activeSpace(), this.input.value(), cx);
  }

  addRefs(space, raw, cx, { announce = false } = {}) {
    const text = raw.trim();
    if (!space || !text) return;
    cx.spawn(async (cx) => {
      const where = whereOf(space);
      const repo = this.branch[space.id]?.ref?.repo ?? (await this.repoFor(where));
      const refs = gh.parseRefs(` ${text} `, repo);
      if (!refs.length) {
        this.note = repo || /\//.test(text) ? `Not a PR: ${text}` : "Not in a GitHub repo: use a URL or owner/repo#12";
        if (announce) notify({ title: "review.track", body: this.note, level: "error" });
        cx.notify();
        return;
      }
      editSpace(space.id, (st) => {
        st.refs ??= [];
        st.hidden = (st.hidden ?? []).filter((k) => !refs.some((r) => gh.keyOf(r) === k));
        for (const r of refs) if (!st.refs.some((one) => gh.keyOf(one) === gh.keyOf(r))) st.refs.push({ repo: r.repo, number: r.number });
      });
      if (announce) notify({ title: `Tracking ${refs.map(gh.keyOf).join(", ")}`, body: `In ${space.name}`, level: "info" });
      this.sel = gh.keyOf(refs[0]);
      this.note = null;
      if (!announce) this.input.set_value("");
      this.poll(cx);
      cx.notify();
    });
  }

  remove(space, ref) {
    const key = gh.keyOf(ref);
    editSpace(space.id, (st) => {
      if (ref.branch) st.hidden = [...new Set([...(st.hidden ?? []), key])];
      st.refs = (st.refs ?? []).filter((r) => gh.keyOf(r) !== key);
      st.auto = (st.auto ?? []).filter((k) => k !== key);
    });
    if (this.expanded === key) this.expanded = null;
  }

  toggleAuto(space, key, cx) {
    const on = !(spaceState(space.id).auto ?? []).includes(key);
    editSpace(space.id, (st) => {
      st.auto = on ? [...new Set([...(st.auto ?? []), key])] : (st.auto ?? []).filter((k) => k !== key);
      // Turning it on answers what is already failing or unread, once.
      if (st.handled) delete st.handled[key];
    });
    notify({ title: `Auto-fix ${on ? "on" : "off"} for ${key}`, body: on ? `New CI failures and review comments go to the agent in ${space.name}.` : "", level: "info" });
    if (on) cx.spawn(async (cx) => { await this.autoFix(spaces()); cx.notify(); });
  }

  /** f: the fix prompt (every open comment, outsiders' too) shows in the panel first; only Send sends it. */
  fixNow(space, pr) {
    const text = [pr.checks.failed.length ? gh.ciFixPrompt(pr) : null, gh.reviewFixPrompt(pr, { all: true, untrusted: true })].filter(Boolean).join("\n\n");
    if (!text) { this.note = `${gh.shortName(pr)}: no failing checks or open comments to fix`; return; }
    this.confirm = { space: space.id, key: gh.keyOf(pr), number: pr.number, text, outside: gh.fixComments(pr, { all: true, untrusted: true }).filter((c) => !c.trusted).length };
    this.handle.focus();
  }

  sendConfirmed(cx) {
    const c = this.confirm, space = c && spaces().find((s) => s.id === c.space);
    this.confirm = null;
    if (space) cx.spawn(async (cx) => { await this.send(space, c.text, { name: `fix ${c.number}` }); cx.notify(); });
  }

  /** s: a tracked PR's comments are read; an Inbox row's activity too. */
  markSeen(key) {
    const now = new Date().toISOString();
    edit((s) => { s.seen[key] = now; (s.inboxSeen ??= {})[key] = now; });
    const pr = this.status[key];
    if (pr) this.status[key] = { ...pr, newComments: 0, comments: pr.comments.map((c) => ({ ...c, isNew: false })) };
  }

  rerun(pr, cx) {
    cx.spawn(async (cx) => {
      const { runs, failed } = await gh.rerunFailed(pr);
      this.note = runs === 0 ? "No GitHub Actions runs to re-run" : failed ? `${failed} of ${runs} re-runs failed` : null;
      if (runs && !failed) notify({ title: `Re-running ${runs} failed run${runs === 1 ? "" : "s"}`, body: gh.shortName(pr), level: "info" });
      this.poll(cx);
      cx.notify();
    });
  }

  /** The review tab of a PR (or of the local branch) in the space: selected if it's there, else made. */
  openReview(space, { key = null, local = false, scope = null }) {
    const ref = key ? gh.parseKey(key) : null;
    if (!local && !ref) return;
    const who = { local, pr: key };
    if (!space.active) run("space.select", { id: space.id });
    const there = reviewTab(space.id, who);
    if (there) {
      run("tab.select", { id: there.id });
      // A chip names its scope: the open review switches to it.
      if (scope) run(`review.scope:${JSON.stringify({ key: local ? `local:${space.id}` : key, scope })}`);
      return;
    }
    // The local diff's base is the branch PR's base when it has one.
    const own = this.branch[space.id]?.ref;
    const base = local && own ? this.status[gh.keyOf(own)]?.baseRef || null : null;
    run("tab.new", { space: space.id, name: tabName(who), mod: "review", props: local ? { view: "review", local: true, space: space.id, base, ...(scope ? { scope } : {}) } : { view: "review", pr: key, space: space.id } });
  }

  /**
   * A PR's review in the space that has its code: a checkout of its repo on its head branch, else of its
   * repo, else the space that tracks it. None: a chooser in the panel (never the shown space by default).
   */
  openSmart(key, cx) {
    const ref = gh.parseKey(key);
    if (!ref || this.finding === key) return;
    // The row says what happens at once; the folders of every space are read side by side.
    this.finding = key;
    cx.spawn(async (cx) => {
      try {
        const head = this.status[key]?.headRef || statusOf(key)?.head || null;
        const all = spaces();
        const fits = await Promise.all(all.map(async (space) => {
          const [exact, repo] = await Promise.all([head ? checkoutOf(space, { repo: ref.repo, head }).catch(() => null) : null, checkoutOf(space, { repo: ref.repo }).catch(() => null)]);
          return exact ? 0 : repo ? 1 : this.linked(space).some((r) => gh.keyOf(r) === key) ? 2 : 3;
        }));
        const tiers = [0, 1, 2].map((tier) => all.filter((_, i) => fits[i] === tier));
        const best = tiers.find((tier) => tier.length);
        if (best?.length === 1) this.openReview(best[0], { key });
        else {
          // Several fit, or none: ask, best matches first.
          const list = [...tiers.flat(), ...all.filter((_, i) => fits[i] === 3)];
          this.choose = { key, list: list.map((s) => s.id), fits: new Set(tiers.flat().map((s) => s.id)), at: 0 };
          if (store().collapsed) this.toggle();
          this.handle.focus();
        }
      } finally {
        this.finding = null;
        cx.notify();
      }
    });
  }

  /** The "open in which space?" chooser: keys while it shows. */
  chooseKey(k, cx) {
    const c = this.choose;
    if (k === "escape") this.choose = null;
    else if (k === "j" || k === "down") c.at = Math.min(c.list.length - 1, c.at + 1);
    else if (k === "k" || k === "up") c.at = Math.max(0, c.at - 1);
    else if (k === "enter") {
      const space = spaces().find((s) => s.id === c.list[c.at]);
      this.choose = null;
      if (space) this.openReview(space, { key: c.key });
    } else return false;
    return true;
  }

  setTab(tab, cx) {
    edit((s) => { s.tab = tab; });
    this.expanded = null;
    if (tab === "inbox" && Date.now() - this.lists.at > 30_000) this.loadLists(cx);
  }

  toggle() {
    const block = findBlock(layout());
    const collapsed = !store().collapsed;
    if (block?.id) run("layout.resize", { id: block.id, px: collapsed ? PANEL_RAIL : store().width ?? WIDTH });
    edit((s) => {
      s.collapsed = collapsed;
      if (collapsed && this.width > PANEL_RAIL + 40) s.width = Math.round(this.width);
    });
  }

  /** Takes the keyboard: from `review.focus` or pane.go. A folded panel opens first. */
  focus(cx) {
    if (store().collapsed) this.toggle();
    markPanelFocus();
    this.handle.focus();
    cx.notify();
  }

  /**
   * O, a row's Open in…: the open-with picker on the row's code. Local changes: the space's checkout. A PR: a
   * checkout on its head branch (this space, then every other space and worktree), else the Open in choice.
   */
  openIn(space, key, cx) {
    this.sel = key;
    if (key === LOCAL) {
      cx.spawn(async (cx) => {
        const at = await checkoutOf(space).catch(() => null);
        if (at) openFolder(at); else this.note = `No git checkout in ${space.name}`;
        cx.notify();
      });
      return;
    }
    const ref = gh.parseKey(key);
    if (!ref) return;
    const head = this.status[key]?.headRef || this.inbox().rows.find((r) => r.key === key)?.row.headRef || statusOf(key)?.head || null;
    cx.spawn(async (cx) => {
      try {
        await withCheckout(this, { space, repo: ref.repo, head, number: ref.number }, (at) => openFolder(at), (cx) => cx.notify(), cx);
      } catch (e) {
        this.note = `Open in: ${e?.message ?? e}`;
      }
      cx.notify();
    });
  }

  /** The keys j/k move over on the shown tab, in the order they show. */
  rows(space) {
    if (this.tab() === "space") return [LOCAL, ...this.linked(space).map(gh.keyOf)];
    const { groups } = this.inbox();
    const folded = this.foldedSections();
    return SECTIONS.filter(([id]) => !folded[id]).flatMap(([id]) => groups[id].map((r) => r.key));
  }

  /** Keys while the panel has the keyboard. Returns false for keys it doesn't use. */
  onKey(e, space, cx) {
    const k = e.key, mods = e.modifiers ?? {};
    if (mods.platform || mods.control || mods.alt) return false;
    if (this.confirm) {
      if (k === "enter") this.sendConfirmed(cx);
      else if (k === "escape") this.confirm = null;
      return true;
    }
    if (this.openChoice) return choiceKey(this, e, cx);
    if (this.choose) return this.chooseKey(k, cx) || k.length === 1;
    const help = k === "?" || (k === "/" && mods.shift);
    if (this.keysOpen && (k === "escape" || help)) { this.keysOpen = false; return true; }
    const tab = this.tab();
    const keys = this.rows(space);
    const at = Math.max(0, keys.indexOf(this.sel));
    const key = keys[at];
    const move = (step) => { if (keys.length) this.sel = keys[Math.max(0, Math.min(keys.length - 1, at + step))]; };
    if (k === "j" || k === "down") move(1);
    else if (k === "k" || k === "up") move(-1);
    else if (k === "tab") this.setTab(tab === "space" ? "inbox" : "space", cx);
    else if (k === "escape") { if (this.expanded) this.expanded = null; else run("pane.go", { direction: "left" }); }
    else if (k === "r" && mods.shift) this.refresh(space, cx);
    else if (k === "o" && mods.shift) { if (key && space) this.openIn(space, key, cx); }
    else if (help) this.keysOpen = true;
    else if (k === "i" || k === "/") this.openInput();
    else if (tab === "inbox" && (k === "[" || k === "]")) {
      const g = SECTIONS.find(([id]) => this.inbox().groups[id].some((r) => r.key === key))?.[0];
      if (g) edit((s) => { s.inboxFolded = { ...this.foldedSections(), [g]: k === "[" }; });
    }
    else if (!key || !space) return k.length === 1;
    else if (k === "enter") this.openRow(space, key, cx);
    else if (k === "space") this.expanded = this.expanded === key ? null : key;
    else if (tab === "inbox") {
      const row = this.inbox().rows.find((r) => r.key === key)?.row;
      if (k === "t") this.addRefs(space, key, cx, { announce: true });
      else if (k === "o" && row) openUrl(row.url);
      else if (k === "s") this.markSeen(key);
      else return k.length === 1;
    } else if (key === LOCAL) return k.length === 1;
    else {
      const pr = this.status[key], ref = this.linked(space).find((r) => gh.keyOf(r) === key);
      if (k === "x" && ref) this.remove(space, ref);
      else if (!pr) return k.length === 1;
      else if (k === "o") openUrl(pr.url);
      else if (k === "f" && pr.state === "OPEN") this.fixNow(space, pr);
      else if (k === "a" && pr.state === "OPEN") this.toggleAuto(space, key, cx);
      else if (k === "r" && pr.checks.failed.length) this.rerun(pr, cx);
      else if (k === "s") this.markSeen(key);
      else return k.length === 1;
    }
    return true;
  }

  foldedSections() { return { drafts: true, ...(store().inboxFolded ?? {}) }; }

  /**
   * The Inbox: Mine and Requests merged, each row with its status, grouped by what must happen next. While the
   * pointer is over the panel (or it has the keyboard), rows keep their order: new data changes them in place,
   * and a row that changes group moves once the pointer leaves.
   */
  inbox() {
    const seen = store().inboxSeen ?? {};
    const sig = `${this.lists.at}|${JSON.stringify(seen)}`;
    if (this.inboxCache?.sig !== sig) {
      const rows = mergeInbox(this.lists).map((row) => {
        const key = gh.keyOf(row);
        const unread = Boolean(seen[key]) && row.updatedAt > seen[key];
        // A review tab or the Space poll that read this PR later knows its checks better.
        const st = statusOf(key);
        const ci = st && st.at > this.lists.at ? (st.checks.failed ? "failure" : st.checks.pending ? "pending" : st.checks.passed ? "success" : row.ci) : row.ci;
        return { key, row: { ...row, ci }, updatedAt: row.updatedAt, unread, status: prStatus(inboxFacts({ ...row, ci }, { unread }), Date.now()) };
      });
      this.inboxCache = { sig, rows, groups: groupRows(rows) };
    }
    const fresh = this.inboxCache;
    if (!this.frozen()) { this.shown = fresh; return fresh; }
    // Frozen: the old order with the new data; a row that is new goes to the end of its group.
    const old = this.shown ?? fresh, byKey = new Map(fresh.rows.map((r) => [r.key, r]));
    const groups = Object.fromEntries(Object.entries(old.groups).map(([g, list]) => [g, list.map((r) => byKey.get(r.key)).filter(Boolean)]));
    const placed = new Set(Object.values(groups).flat().map((r) => r.key));
    for (const r of fresh.rows) if (!placed.has(r.key)) groups[r.status.group].push(r);
    return { ...fresh, groups };
  }

  frozen() { return Boolean(this.pointerIn) || Boolean(this.handle.is_focused?.()); }

  /** A row's main action: its review. An Inbox row opens in the space that has the PR's code. */
  openRow(space, key, cx) {
    this.sel = key;
    if (key === LOCAL) return this.openReview(space, { local: true });
    if (this.tab() === "space") return this.openReview(space, { key });
    edit((s) => { (s.inboxSeen ??= {})[key] = new Date().toISOString(); });
    this.openSmart(key, cx);
  }

  openInput() {
    this.adding = true;
    this.input.set_value("");
    this.input.focus();
  }

  refresh(space, cx) {
    this.poll(cx);
    this.loadLists(cx);
    if (space) this.loadLocal(space, cx, true);
  }
}

mixin(Panel, PanelView);
