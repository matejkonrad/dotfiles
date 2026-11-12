// Shared state of the review mod.
//   "review": {
//     panel: tab, collapsed, width, seen: {key: iso}, spaces: {id: {refs, hidden, auto, handled}}, dryRun, migrated
//     review tab: split, filesFolded, filesWidth, fileOrder, scopes: {repo: {scope, sig}}, localBases: {root: ref}
//     agent: agentFolded, agentWidth, agentProvider, agentModel: {provider: model}, agentProviderOverride (tests)
//   }
//   "review.drafts": { [prKey | "local:<root>"]: { type: "pr" | "agent", notes: [...], viewed: ["path@blob"], at, inflight? } }
// A note: {id, path, side: "RIGHT" | "LEFT", line, start_side?, start_line?, body, snippet: [lines], sha, scope?}.
// `scope`: the scope it was written in, when not the default one (scopes.scopeKey).
import { exec, focused, shared, setShared, spaces, panes, terminals } from "herdr";
import { repoOf } from "./gh.js";

export const STORE = "review";
const DRAFTS = "review.drafts";

// ---- reads: once per key per frame ----------------------------------------------------
// shared() deserializes the whole value on every call, and one frame asks for the same keys a hundred times.
// Inside inFrame() a key is read once; the host re-renders after every shared change, so a frame never sees
// a stale value. Outside a frame (events, tasks) every read is fresh. Callers must not change what read() gives.
let frame = null, depth = 0;

export function inFrame(fn) {
  if (depth++ === 0) frame = new Map();
  try { return fn(); } finally { if (--depth === 0) frame = null; }
}

export function read(key) {
  if (!frame) return shared(key);
  if (!frame.has(key)) frame.set(key, shared(key));
  return frame.get(key);
}

/** Writes a key unless its JSON is unchanged (each write re-renders every mod in the window). */
function write(key, value, before) {
  const text = JSON.stringify(value);
  if (text === before) return false;
  frame?.delete(key);
  setShared(key, value);
  return true;
}

export const store = () => read(STORE) ?? {};
export const spaceState = (id) => store().spaces?.[id] ?? {};

export function edit(fn) {
  migrate();
  // shared() hands out a fresh copy: no clone needed.
  const next = shared(STORE) ?? {};
  const before = JSON.stringify(next);
  next.spaces ??= {};
  next.seen ??= {};
  fn(next);
  write(STORE, next, before);
}
export const editSpace = (id, fn) => edit((s) => fn((s.spaces[id] ??= {})));

/** On the first start, pr-watch's tracked PRs, auto-fix, seen, fold and width come along (once: `migrated`). */
export function migrate() {
  const cur = read(STORE);
  if (cur && typeof cur === "object" && "migrated" in cur) return false;
  const old = shared("pr-watch");
  const next = { ...(old && typeof old === "object" ? old : {}), ...(cur && typeof cur === "object" ? cur : {}) };
  if (old?.spaces) next.spaces = { ...old.spaces, ...(cur?.spaces ?? {}) };
  if (old?.seen) next.seen = { ...old.seen, ...(cur?.seen ?? {}) };
  next.spaces ??= {};
  next.seen ??= {};
  next.tab ??= "tracked";
  next.migrated = old ? "pr-watch" : null;
  write(STORE, next);
  return true;
}

// ---- drafts -------------------------------------------------------------------

const EMPTY_DRAFTS = Object.freeze({ type: null, notes: Object.freeze([]), viewed: Object.freeze([]) });
// A review's drafts without notes go after this long; viewed marks keep the newest MAX_VIEWED.
const DRAFTS_MAX_AGE = 30 * 86_400_000;
const MAX_VIEWED = 1000;

const validNote = (n) => n && typeof n === "object" && typeof n.id === "string" && typeof n.path === "string"
  && (n.side === "LEFT" || n.side === "RIGHT") && Number.isInteger(n.line) && typeof n.body === "string";

/** One review's drafts, with the shape every reader relies on: a malformed note (an old build, a script) is left out. */
export function draftsOf(key) {
  const d = read(DRAFTS)?.[key];
  if (!d || typeof d !== "object") return EMPTY_DRAFTS;
  if (d.checked) return d;
  // Checked once per frame's copy: `checked` marks it, so the memo by identity holds within the frame.
  const notes = Array.isArray(d.notes) ? d.notes.filter(validNote) : [];
  const viewed = Array.isArray(d.viewed) ? d.viewed.filter((v) => typeof v === "string") : [];
  return Object.assign(d, { notes, viewed, checked: true });
}

/** Drops other reviews' entries without notes that nobody touched for DRAFTS_MAX_AGE; stamps entries from older builds. */
function pruneDrafts(all, keep) {
  const now = Date.now();
  let changed = false;
  for (const [k, d] of Object.entries(all)) {
    if (k === keep) continue;
    if (!d || typeof d !== "object") { delete all[k]; changed = true; continue; }
    if (typeof d.at !== "number") { d.at = now; changed = true; continue; }
    if (!d.notes?.length && !d.inflight && now - d.at > DRAFTS_MAX_AGE) { delete all[k]; changed = true; }
  }
  return changed;
}

/** Changes one review's drafts. Nothing is written when nothing changed; old entries are pruned on the way. */
export function editDrafts(key, fn) {
  // shared() hands out a fresh copy: only this entry is rebuilt, nothing else is cloned.
  const all = shared(DRAFTS) ?? {};
  const raw = all[key] && typeof all[key] === "object" ? all[key] : {};
  const one = { ...raw, type: raw.type ?? null, notes: Array.isArray(raw.notes) ? raw.notes.filter(validNote) : [], viewed: Array.isArray(raw.viewed) ? raw.viewed : [] };
  delete one.at; delete one.checked;
  const before = JSON.stringify(one);
  fn(one);
  if (one.viewed.length > MAX_VIEWED) one.viewed = one.viewed.slice(-MAX_VIEWED);
  const changed = JSON.stringify(one) !== before;
  const pruned = pruneDrafts(all, key);
  if (!changed && !pruned) return;
  if (changed) {
    if (!one.notes.length && !one.viewed.length && !one.type && !one.inflight) delete all[key];
    else all[key] = { ...one, at: Date.now() };
  }
  write(DRAFTS, all);
}

// ---- where things are -----------------------------------------------------------

/** Where the space works now: its first terminal's folder and branch. */
export function whereOf(space) {
  const tabs = new Set(space.tabs.map((t) => t.id));
  const pane = panes().find((p) => tabs.has(p.tab) && p.terminal && p.cwd);
  const cwd = pane?.cwd ?? (space.folder || null);
  const branch = pane?.branch ?? space.branch ?? null;
  return { cwd, branch, on: space.machine ?? null, sig: `${space.machine ?? ""}|${cwd}|${branch}` };
}

/** The folders a space works in: the focused pane's, then its other terminal panes', then its folder. */
export function foldersOf(space) {
  const tabs = new Set(space.tabs.map((t) => t.id));
  const list = panes().filter((p) => tabs.has(p.tab) && p.terminal && p.cwd).sort((a, b) => Number(b.focused) - Number(a.focused)).map((p) => p.cwd);
  if (space.folder) list.push(space.folder);
  return [...new Set(list)];
}

/**
 * The first git checkout among the space's folders: {root, branch, on}, or null. With `repo` and `head`, only a
 * checkout of that GitHub repo with that branch checked out counts (where a PR's files are).
 */
export async function checkoutOf(space, { repo = null, head = null } = {}) {
  const on = space.machine ?? null;
  const seen = new Set();
  for (const cwd of foldersOf(space)) {
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
    const root = top?.code === 0 ? top.stdout.trim() : null;
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const b = await exec("git", ["branch", "--show-current"], { cwd: root, on }).catch(() => null);
    const branch = b?.code === 0 ? b.stdout.trim() : "";
    if (head && branch !== head) continue;
    if (repo && (await repoOf(root, on))?.toLowerCase() !== repo.toLowerCase()) continue;
    return { root, branch, on };
  }
  return null;
}

const spaceOfTab = (tab) => spaces().find((s) => s.tabs.some((t) => t.id === tab)) ?? null;

/** The space that holds a terminal: its pane's tab, else its herdr.space label, else its parent's. */
export function spaceOfTerminal(address, depth = 0) {
  if (!address || depth > 5) return null;
  const pane = panes().find((p) => p.terminal === address);
  if (pane) return spaceOfTab(pane.tab);
  const all = terminals();
  const t = all.find((x) => x.address === address) ?? all.find((x) => x.name === address);
  if (!t) return null;
  const machine = address.includes("/") ? address.split("/")[0] : null;
  const label = t.labels?.["herdr.space"];
  if (label) {
    const id = machine ? `${machine}/${label}` : label;
    const s = spaces().find((x) => x.id === id || x.id === label);
    if (s) return s;
  }
  const tab = t.labels?.["herdr.tab"];
  if (tab) {
    const s = spaceOfTab(machine ? `${machine}/${tab}` : tab) ?? spaceOfTab(tab);
    if (s) return s;
  }
  return t.parent ? spaceOfTerminal(machine && !t.parent.includes("/") ? `${machine}/${t.parent}` : t.parent, depth + 1) : null;
}

/** A space for a command: `space` by id or name, else the one holding `terminal`, else the shown one. */
export function resolveSpace({ space, terminal } = {}) {
  if (space) return spaces().find((s) => s.id === space) ?? spaces().find((s) => s.name === space) ?? null;
  if (terminal) return spaceOfTerminal(String(terminal));
  return spaces().find((s) => s.active) ?? null;
}

// ---- review tabs ----------------------------------------------------------------------
// "review.tabs": {tabId: {pr | local, space}}, written by each review tab, so a PR's tab is found by its PR
// (two repos can both have a #12), not by the tab's name.
const TABS = "review.tabs";

export function registerTab(tab, o) {
  const all = read(TABS) ?? {};
  const want = { pr: o.pr ?? null, local: Boolean(o.local), space: o.space };
  if (JSON.stringify(all[tab]) === JSON.stringify(want)) return;
  const live = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
  const next = Object.fromEntries(Object.entries(all).filter(([id]) => live.has(id)));
  next[tab] = want;
  write(TABS, next);
}

/** The tab already showing this review in the space: by the registry, else by its name. */
export function reviewTab(spaceId, o) {
  const space = spaces().find((s) => s.id === spaceId);
  if (!space) return null;
  const withReview = new Set(panes().filter((p) => p.mod === "review").map((p) => p.tab));
  const reg = read(TABS) ?? {};
  const byReg = space.tabs.find((t) => withReview.has(t.id) && reg[t.id]?.space === spaceId
    && (o.local ? reg[t.id].local : reg[t.id].pr === o.pr));
  if (byReg) return byReg;
  // Not registered yet (a tab from an older version): by its name, new or old style ("#12").
  const names = [tabName(o), o.local ? "local" : `#${(o.pr ?? "").split("#")[1]}`];
  return space.tabs.find((t) => names.includes(t.name) && withReview.has(t.id) && !reg[t.id]) ?? null;
}

/** This copy's own tab when nothing is registered: the focused tab, if it is a review tab of that space no one claimed. */
export function claimTab(spaceId) {
  const f = focused();
  const space = spaces().find((s) => s.id === spaceId);
  if (!f?.tab || !space?.tabs.some((t) => t.id === f.tab)) return null;
  if (!panes().some((p) => p.tab === f.tab && p.mod === "review")) return null;
  return (read(TABS) ?? {})[f.tab] ? null : f.tab;
}

/** "FramerStudio#41167" for a PR ({pr: "owner/repo#n"}), "local" for the local diff. */
export function tabName(o) {
  if (o.local) return "local";
  const m = /^[\w.-]+\/([\w.-]+)#(\d+)$/.exec(o.pr ?? "");
  return m ? `${m[1]}#${m[2]}` : `#${o.number ?? "?"}`;
}

// ---- PR status, one store for the panel and the review tabs ------------------------------
// "review.status": {key: {title, state, checks: {passed, pending, failed}, head, base, at}}. The panel's poll
// and a review tab's load both write it; everything that shows checks reads it, with its time.
const STATUS = "review.status";

export const statusOf = (key) => read(STATUS)?.[key] ?? null;

// A status entry not refreshed for a day goes; an unchanged one gets a new time at most once an hour.
const STATUS_MAX_AGE = 86_400_000;
const STATUS_TOUCH = 3_600_000;

export function putStatus(entries) {
  const all = shared(STATUS) ?? {};
  let changed = false;
  for (const [key, v] of Object.entries(entries)) {
    const next = { ...v, checks: { passed: v.checks?.passed ?? 0, pending: v.checks?.pending ?? 0, failed: v.checks?.failed?.length ?? v.checks?.failed ?? 0 } };
    const was = all[key];
    if (was && JSON.stringify({ ...was, at: 0 }) === JSON.stringify({ ...next, at: 0 }) && next.at - was.at < STATUS_TOUCH) continue;
    all[key] = next;
    changed = true;
  }
  for (const [key, v] of Object.entries(all)) if (Date.now() - (v.at ?? 0) > STATUS_MAX_AGE) { delete all[key]; changed = true; }
  if (changed) write(STATUS, all);
}

/** "12s ago", "3m ago". */
export function ago(at) {
  if (!at) return "";
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

// ---- scopes ----------------------------------------------------------------------------------------
// "review".scopes: {[repo]: {scope, sig}}: the last scope per repo ("local:<root>" or the PR's key), with the head
// commit it was picked on (scopes.defaultScope). "review".localBases: {[root]: ref}: the chosen base per checkout.

export const savedScope = (repo) => store().scopes?.[repo] ?? null;
export const saveScope = (repo, scope, sig) => edit((st) => { st.scopes ??= {}; st.scopes[repo] = { scope, sig }; });
export const localBase = (root) => store().localBases?.[root] ?? null;
export const setLocalBase = (root, ref) => edit((st) => { st.localBases ??= {}; st.localBases[root] = ref; });
