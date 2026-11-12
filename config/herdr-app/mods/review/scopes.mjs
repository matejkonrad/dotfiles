// Review scopes, with no UI or herdr dependencies: which changes a review shows, the git commands and GitHub
// calls for each, the default choice, and the rules that follow the scope (postable drafts, viewed marks).
// A scope: {kind: "uncommitted" | "branch" | "all" | "since" | "commits", from?, to?, root?, count?}.
//   uncommitted  local: the working tree and untracked files vs HEAD
//   branch       local: merge-base(base, HEAD) vs the working tree, untracked files included
//   all          PR: the PR's diff
//   since        PR: since the head of the viewer's last review (or the last commit marked viewed)
//   commits      one commit (from === to) or a range, oldest `from` to newest `to`; `root`: `from` has no parent

/** git's empty tree: the "parent" of a root commit. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const DIFF = ["diff", "--no-color", "--no-ext-diff", "-M", "--full-index"];

export const isCommits = (s) => s?.kind === "commits";
export const isDefault = (s, local) => !s || s.kind === (local ? "branch" : "all");

/** A scope as a short string: saved per repo, and part of the keys of walkthroughs and drafts. */
export function scopeKey(s) {
  if (!s) return null;
  if (!isCommits(s)) return s.kind;
  return s.from === s.to ? `c:${s.to}` : `c:${s.from}..${s.to}`;
}

/** The scope a key names; commits come back with only their SHAs (the commit list adds the rest). */
export function parseScopeKey(key) {
  if (["uncommitted", "branch", "all", "since"].includes(key)) return { kind: key };
  const m = /^c:([0-9a-f]{4,64})(?:\.\.([0-9a-f]{4,64}))?$/.exec(String(key ?? ""));
  if (!m) return null;
  return { kind: "commits", from: m[1], to: m[2] ?? m[1] };
}

export const sameScope = (a, b) => scopeKey(a) === scopeKey(b);

/** The scopes a review offers: local {uncommitted, branch, commits}; PR {all, since, commits}. */
export const scopeKinds = (local) => (local ? ["uncommitted", "branch", "commits"] : ["all", "since", "commits"]);

// ---- local: git ----------------------------------------------------------------------------------

/**
 * The `git diff` argv of a local scope. Uncommitted: vs HEAD. Branch: vs the merge-base (the working tree
 * included). Commits: the parent of the oldest commit (the empty tree for a root commit) vs the newest.
 */
export function localDiffArgv(scope, { mergeBase = null } = {}) {
  const s = scope ?? { kind: "branch" };
  if (s.kind === "uncommitted") return [...DIFF, "HEAD"];
  if (s.kind === "branch") return [...DIFF, mergeBase ?? "HEAD"];
  if (isCommits(s)) return [...DIFF, s.root ? EMPTY_TREE : `${s.from}^`, s.to];
  throw new Error(`Not a local scope: ${s.kind}`);
}

/** Untracked files belong to the scopes that end at the working tree. */
export const withUntracked = (scope) => !scope || scope.kind === "uncommitted" || scope.kind === "branch";

/** Each commit: a record mark, then its fields; --raw gives the blobs (viewed marks), --numstat the counts. */
const LOG_FORMAT = "%x1e%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%s";
export const LOG_LIMIT = 200;

/** The `git log` argv of the branch's commits: merge-base..HEAD, newest first. No merge-base: the last commits. */
export function logArgv(mergeBase) {
  return ["log", "--no-color", `--format=${LOG_FORMAT}`, "--raw", "--numstat", "--no-abbrev", "-M", "-n", String(LOG_LIMIT),
    mergeBase ? `${mergeBase}..HEAD` : "HEAD", "--"];
}

/** logArgv's output as commits: {sha, short, parents, author, at, subject, additions, deletions, files: [{path, blob}]}. */
export function parseLog(text) {
  const out = [];
  for (const record of String(text ?? "").split("\x1e")) {
    const [head, ...rest] = record.split("\n");
    const f = head.split("\x1f");
    if (f.length < 6 || !/^[0-9a-f]{7,64}$/.test(f[0])) continue;
    // --no-abbrev (full blobs) makes %h full too: the short SHA is cut here.
    const c = { sha: f[0], short: f[0].slice(0, 7), parents: f[2] ? f[2].split(" ") : [], author: f[3], at: f[4], subject: f.slice(5).join("\x1f"),
      additions: 0, deletions: 0, files: [] };
    for (const line of rest) {
      // ":100644 100644 <old> <new> M\tpath" (a rename: "R100\told\tnew").
      const raw = /^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) [A-Z]\d*\t(.*)$/.exec(line);
      if (raw) { const paths = raw[3].split("\t"); c.files.push({ path: paths.at(-1), blob: raw[2] }); continue; }
      const num = /^(\d+|-)\t(\d+|-)\t/.exec(line);
      if (num) { c.additions += Number(num[1]) || 0; c.deletions += Number(num[2]) || 0; }
    }
    out.push(c);
  }
  return out;
}

/** `git diff --numstat` output as {added, deleted}. */
export function numstat(text) {
  let added = 0, deleted = 0;
  for (const line of String(text ?? "").split("\n")) {
    const [a, d] = line.split("\t");
    if (/^\d+$/.test(a)) added += Number(a);
    if (/^\d+$/.test(d)) deleted += Number(d);
  }
  return { added, deleted };
}

// ---- PR: GitHub ------------------------------------------------------------------------------------

/**
 * The `gh api` path of a PR scope's diff, or null for the PR's own files list (All changes).
 * since: compare the review's head with the PR head. One commit: the commit. A range: compare the parent of the
 * oldest commit with the newest.
 */
export function prScopeApi(repo, scope, { head, since = null } = {}) {
  const s = scope ?? { kind: "all" };
  if (s.kind === "all") return null;
  if (s.kind === "since") {
    if (!since) throw new Error("Nothing reviewed yet");
    return `repos/${repo}/compare/${since}...${head}`;
  }
  if (isCommits(s)) {
    if (s.from === s.to || !s.base) return `repos/${repo}/commits/${s.to}`;
    return `repos/${repo}/compare/${s.base}...${s.to}`;
  }
  throw new Error(`Not a PR scope: ${s.kind}`);
}

/** A commit from GitHub's list (pulls/n/commits or a commit) in parseLog's shape. */
export function ghCommit(c) {
  const files = (c.files ?? []).map((f) => ({ path: f.filename, blob: f.sha ?? null }));
  return { sha: c.sha, short: c.sha.slice(0, 7), parents: (c.parents ?? []).map((p) => p.sha), author: c.commit?.author?.name ?? c.author?.login ?? "",
    at: c.commit?.author?.date ?? "", subject: String(c.commit?.message ?? "").split("\n")[0],
    additions: c.stats?.additions ?? null, deletions: c.stats?.deletions ?? null, files: c.files ? files : null };
}

/**
 * Where "Since review" starts: the head commit of the viewer's last submitted review, else the newest commit
 * whose files the viewer marked viewed. commits: oldest first. Returns {sha, from: "review" | "viewed"} or null.
 */
export function sinceBase({ reviews = [], viewer = null, commits = [], viewed = () => false } = {}) {
  const mine = reviews.filter((r) => r.user?.login === viewer && r.state !== "PENDING" && r.commit_id && r.submitted_at)
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  if (viewer && mine.length) return { sha: mine.at(-1).commit_id, from: "review" };
  for (let i = commits.length - 1; i >= 0; i--) if (viewed(commits[i])) return { sha: commits[i].sha, from: "viewed" };
  return null;
}

/** How many commits came after `sha` (commits: oldest first); null when `sha` is not among them (a force push). */
export function commitsAfter(commits, sha) {
  const at = commits.findIndex((c) => c.sha === sha);
  return at < 0 ? null : commits.length - 1 - at;
}

// ---- the default -----------------------------------------------------------------------------------

/**
 * The scope a review opens with. A saved choice wins while the state it was made in holds (same `sig`: the
 * head commit). Else the smart default: local, Branch when the branch is ahead of its base, else Uncommitted;
 * PR, Since review when commits came after the last review, else All changes.
 */
export function defaultScope({ local, ahead = 0, newSince = 0, saved = null, sig = null, valid = () => true }) {
  const kept = saved?.scope ? parseScopeKey(saved.scope) : null;
  if (kept && saved.sig === sig && scopeKinds(local).includes(kept.kind) && valid(kept)) return kept;
  if (local) return { kind: ahead > 0 ? "branch" : "uncommitted" };
  return { kind: newSince > 0 ? "since" : "all" };
}

/** A pick in the commit list (newest first): rows a..b as a scope, oldest to newest. */
export function commitsScope(list, a, b = a) {
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  const newest = list[lo], oldest = list[hi];
  if (!newest || !oldest) return null;
  return { kind: "commits", from: oldest.sha, to: newest.sha, base: oldest.parents?.[0] ?? null, root: !oldest.parents?.length, count: hi - lo + 1 };
}

/** The commit list's rows (newest first) that a commits scope covers, or null when they are not all there. */
export function rowsOfScope(list, scope) {
  if (!isCommits(scope)) return null;
  const a = list.findIndex((c) => c.sha.startsWith(scope.to) || scope.to.startsWith(c.sha));
  const b = list.findIndex((c) => c.sha.startsWith(scope.from) || scope.from.startsWith(c.sha));
  return a < 0 || b < 0 || a > b ? null : [a, b];
}

/** Space in the picker: a row joins the range at its edge, leaves it from an edge, or starts a new one. */
export function toggleRow(sel, i) {
  if (!sel) return { a: i, b: i };
  const { a, b } = sel;
  if (i < a) return { a: i, b };
  if (i > b) return { a, b: i };
  if (a === b) return null;
  if (i === a) return { a: a + 1, b };
  if (i === b) return { a, b: b - 1 };
  return { a: i, b: i };
}

/** A segment's label: "a1b2c3d" for one commit, "3 commits" for a range. */
export function commitsLabel(scope) {
  if (!isCommits(scope)) return "Commits";
  if (scope.from === scope.to) return scope.to.slice(0, 7);
  return scope.count ? `${scope.count} commits` : `${scope.from.slice(0, 7)}..${scope.to.slice(0, 7)}`;
}

/** The scope's name in the tab title and the ⌘K list. */
export function scopeName(scope, local) {
  const s = scope ?? { kind: local ? "branch" : "all" };
  return { uncommitted: "Uncommitted", branch: "Branch", all: "All changes", since: "Since review" }[s.kind] ?? commitsLabel(s);
}

// ---- what follows the scope ----------------------------------------------------------------------------

/** A file's viewed mark: its path and its content (blob SHA), so the mark holds in every scope until it changes. */
export const viewedKey = (file) => (file.blob ? `${file.path}@${file.blob}` : file.path);

/** Whether a file is viewed. Marks from before blobs were kept (a bare path) still count. */
export function isViewed(marks, file) {
  const set = marks instanceof Set ? marks : new Set(marks ?? []);
  return set.has(viewedKey(file)) || set.has(file.path);
}

/** A commit is viewed when every file it touched is viewed at the content it gave that file. */
export function commitViewed(marks, commit) {
  if (!commit.files?.length) return false;
  const set = marks instanceof Set ? marks : new Set(marks ?? []);
  return commit.files.every((f) => f.blob && set.has(`${f.path}@${f.blob}`));
}

/**
 * Whether GitHub can take a draft as a line comment of the PR. A draft from All changes (no scope) can. A draft
 * from another scope can only when its line is in the PR head's diff with the same text: `head` maps
 * "path|side|line" to that line's text.
 */
export function postable(note, head) {
  if (!note.scope || note.scope === "all") return true;
  if (!head) return false;
  const text = head.get(`${note.path}|${note.side}|${note.line}`);
  if (text === undefined) return false;
  if (note.snippet?.length && text !== note.snippet.at(-1)) return false;
  if (note.start_line && note.start_line !== note.line) {
    const first = head.get(`${note.path}|${note.start_side ?? note.side}|${note.start_line}`);
    if (first === undefined || (note.snippet?.length && first !== note.snippet[0])) return false;
  }
  return true;
}

/** The lines of a diff's files as postable() reads them. */
export function lineIndex(files) {
  const out = new Map();
  for (const f of files) for (const r of f.rows) {
    if (r.n != null && r.k !== "del") out.set(`${f.path}|RIGHT|${r.n}`, r.text);
    if (r.o != null && r.k !== "add") out.set(`${f.path}|LEFT|${r.o}`, r.text);
  }
  return out;
}

/**
 * The argv that opens a past version of a file read-only in Neovim: `git show <sha>:<path>` into a buffer.
 * The name reaches Vim only through an env var and fnameescape(): a PR author picks file names, and `:file`
 * would run whatever follows a `|` in one.
 */
export function showArgv(sha, path, line = 1) {
  return ["sh", "-c", `export HERDR_REVIEW_NAME="$1"; git show "$1" | nvim -R "+$2" -c 'exe "file " . fnameescape($HERDR_REVIEW_NAME)' -c 'filetype detect' -`,
    "sh", `${sha}:${path}`, String(Math.max(1, Number(line) || 1))];
}
