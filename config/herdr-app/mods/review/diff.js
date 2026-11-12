// Diffs as rows: a PR's patches (GitHub gives one per file) or the local branch's `git diff`.
// A file is {path, previous, status, additions, deletions, rows}; a row is one of
//   {k: "hunk", text}                       a hunk header
//   {k: "fold", count}                      unchanged lines between two hunks (not loaded)
//   {k: "ctx" | "add" | "del", o, n, text}  a line with its old and new numbers
//   {k: "meta", text}                       binary, too big, renamed without changes
import { exec } from "herdr";
import { localDiffArgv, logArgv, parseLog, numstat, withUntracked } from "./scopes.mjs";

// One file shows at most this many lines; the rest is a note (the panel stays light).
const FILE_LINES = 4000;
// Untracked files the local diff shows as added, at most.
const UNTRACKED = 40;

/** A unified patch's hunks as rows. */
export function patchRows(patch) {
  return patch ? patchLines(patch.split("\n")) : [];
}

function patchLines(patch) {
  const rows = [];
  let o = 0, n = 0, end = 0, lines = 0;
  for (const line of patch) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (h) {
      const start = Number(h[1]);
      // The lines between the last hunk and this one are folded (GitHub sends only the hunks).
      if (rows.length && start > end) rows.push({ k: "fold", count: start - end });
      else if (!rows.length && start > 1) rows.push({ k: "fold", count: start - 1 });
      o = start;
      n = Number(h[3]);
      end = start;
      rows.push({ k: "hunk", text: line });
      continue;
    }
    if (!rows.length) continue;
    if (++lines > FILE_LINES) {
      if (lines === FILE_LINES + 1) rows.push({ k: "meta", text: `cut at ${FILE_LINES} lines: e opens the file` });
      continue;
    }
    const c = line[0], text = line.slice(1);
    if (c === "+") rows.push({ k: "add", o: null, n: n++, text });
    else if (c === "-") { rows.push({ k: "del", o: o++, n: null, text }); end = o; }
    else if (c === " " || line === "") {
      // A patch's last line can be an empty string after the final newline: not a line.
      if (line === "" && c === undefined) continue;
      rows.push({ k: "ctx", o: o++, n: n++, text });
      end = o;
    }
    // "\ No newline at end of file" and anything else: not a line.
  }
  return rows;
}

/** GitHub's files list as files with rows. */
export function prFiles(list) {
  return list.map((f) => ({
    path: f.path, previous: f.previous, status: f.status, additions: f.additions, deletions: f.deletions, blob: f.blob ?? null,
    rows: f.patch ? patchRows(f.patch) : [{ k: "meta", text: f.status === "renamed" ? `renamed from ${f.previous}` : "binary or too big to show" }],
  }));
}

/** `git diff` output (many files) as files with rows. */
export function parseGitDiff(text) {
  const steps = parseSteps(text);
  let r;
  while (!(r = steps.next()).done);
  return r.value;
}

/**
 * parseGitDiff in slices: `pause` (a task's cx.sleep(0)) runs whenever 8 ms went by, so a large local diff
 * never holds the app past its frame budget.
 */
export async function parseGitDiffAsync(text, pause) {
  const steps = parseSteps(text);
  let r, started = Date.now();
  while (!(r = steps.next()).done) {
    if (Date.now() - started > 8) { await pause(); started = Date.now(); }
  }
  return r.value;
}

function* parseSteps(text) {
  const files = [];
  let cur = null, patch = [], count = 0;
  const flush = () => {
    if (!cur) return;
    const rows = patchLines(patch);
    if (!rows.length) rows.push({ k: "meta", text: cur.binary ? "binary file" : cur.previous ? `renamed from ${cur.previous}` : "no text changes" });
    files.push({ ...cur, rows,
      additions: rows.filter((r) => r.k === "add").length, deletions: rows.filter((r) => r.k === "del").length });
  };
  for (const line of text.split("\n")) {
    if ((++count & 511) === 0) yield;
    const head = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
    if (head) {
      flush();
      yield;
      cur = { path: head[2], previous: null, status: "modified", binary: false, blob: null };
      patch = [];
      continue;
    }
    if (!cur) continue;
    if (!patch.length) {
      if (line.startsWith("new file")) cur.status = "added";
      else if (line.startsWith("deleted file")) cur.status = "removed";
      else if (line.startsWith("rename from ")) { cur.previous = line.slice(12); cur.status = "renamed"; }
      else if (line.startsWith("Binary files")) cur.binary = true;
      // "index <old>..<new> <mode>": the new content's blob (the viewed mark's key).
      else if (line.startsWith("index ")) cur.blob = /\.\.([0-9a-f]+)/.exec(line)?.[1] ?? null;
      else if (line.startsWith("+++ ") && line !== "+++ /dev/null") cur.path = line.slice(6);
      else if (line.startsWith("--- ") && line !== "--- /dev/null" && cur.status === "removed") cur.path = line.slice(6);
      if (!line.startsWith("@@")) continue;
    }
    patch.push(line);
  }
  flush();
  return files;
}

async function git(args, cwd, on, timeout = 60_000) {
  const r = await exec("git", ["-c", "core.quotePath=false", ...args], { cwd, on, timeout }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
  return r;
}

/** The checkout's top folder, or null. */
export async function topOf(cwd, on) {
  const r = await git(["rev-parse", "--show-toplevel"], cwd, on);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** The base to diff against: the PR's base, else origin/HEAD, else main or master. */
export async function baseOf(root, on, prBase) {
  const tries = [];
  if (prBase) tries.push(`origin/${prBase}`, prBase);
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root, on);
  if (head.code === 0 && head.stdout.trim()) tries.push(head.stdout.trim());
  tries.push("origin/main", "main", "origin/master", "master");
  for (const ref of tries) {
    const r = await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root, on);
    if (r.code === 0) return ref;
  }
  return null;
}

/** The base ref and the merge-base of HEAD with it (null when there is no base). `want`: a chosen base. */
export async function mergeBaseOf(root, on, prBase, want = null) {
  let base = null;
  if (want && (await git(["rev-parse", "--verify", "--quiet", `${want}^{commit}`], root, on)).code === 0) base = want;
  base ??= await baseOf(root, on, prBase);
  if (!base) return { base: null, mergeBase: null };
  const mb = await git(["merge-base", "HEAD", base], root, on);
  return { base, mergeBase: mb.code === 0 ? mb.stdout.trim() : null };
}

/** The branch's commits since the merge-base, newest first (parseLog's shape). */
export async function localCommits(root, on, mergeBase) {
  const r = await git(logArgv(mergeBase), root, on);
  return r.code === 0 ? parseLog(r.stdout) : [];
}

/** Untracked files as their `git diff` texts (at most UNTRACKED, 8 at a time). */
async function untrackedDiffs(root, on) {
  const untracked = await git(["ls-files", "--others", "--exclude-standard"], root, on);
  const paths = untracked.stdout.split("\n").filter(Boolean).slice(0, UNTRACKED);
  const out = [];
  for (let i = 0; i < paths.length; i += 8) {
    // --no-index exits 1 when the files differ, which they always do here.
    out.push(...await Promise.all(paths.slice(i, i + 8).map(async (path) => ({ path,
      text: (await git(["diff", "--no-color", "--full-index", "--no-index", "--", "/dev/null", path], root, on)).stdout }))));
  }
  return out;
}

/**
 * One local scope's diff (scopes.mjs: localDiffArgv), untracked files as added where the scope ends at the
 * working tree. Returns {files, from}: `from` is the diff's start, for the agent.
 */
export async function scopeDiff(root, on, scope, mergeBase, pause = async () => {}) {
  const argv = localDiffArgv(scope, { mergeBase });
  const d = await git(argv, root, on, 120_000);
  if (d.code !== 0) throw new Error(d.stderr.trim().split("\n")[0] || "git diff failed");
  const untracked = withUntracked(scope) ? await untrackedDiffs(root, on) : [];
  // The raw text: a refresh that reads the same text keeps the diff on screen as it is.
  const text = [d.stdout, ...untracked.map((u) => u.text)].join("\0");
  const files = await parseGitDiffAsync(d.stdout, pause);
  for (const u of untracked) {
    const [one] = await parseGitDiffAsync(u.text, pause);
    if (one) files.push({ ...one, path: u.path, status: "added" });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, text, from: argv[argv.length - (scope?.kind === "commits" ? 2 : 1)] };
}

/** The diff between two commits in a checkout, as files; `paths` limits it (at most 400 paths, else all). */
export async function revDiff(root, on, from, to, paths = null, pause = async () => {}) {
  const only = paths?.length && paths.length <= 400 ? ["--", ...paths] : [];
  const d = await git(["diff", "--no-color", "--no-ext-diff", "-M", "--full-index", "--end-of-options", from, to, ...only], root, on, 120_000);
  if (d.code !== 0) throw new Error(d.stderr.trim().split("\n")[0] || "git diff failed");
  return parseGitDiffAsync(d.stdout, pause);
}

/** Whether a checkout has a commit. */
export async function hasCommit(root, on, sha) {
  return (await git(["cat-file", "-e", `${sha}^{commit}`], root, on)).code === 0;
}

/** The merged branch's commits the picker still lists. */
const MERGED_COMMITS = 20;

/** Whether HEAD is already in `base` (merged), while not being the base's own tip. */
export async function mergedInto(root, on, base) {
  const anc = await git(["merge-base", "--is-ancestor", "HEAD", base], root, on);
  if (anc.code !== 0) return false;
  const [head, tip] = await Promise.all([git(["rev-parse", "HEAD"], root, on), git(["rev-parse", `${base}^{commit}`], root, on)]);
  return head.stdout.trim() !== tip.stdout.trim();
}

/** Where the local review stands: branch, HEAD, base, merge-base, commits ahead of the base, and the commits. */
export async function localState(cwd, on, prBase, want = null) {
  const root = await topOf(cwd, on);
  if (!root) throw new Error(`Not a git checkout: ${cwd}`);
  const branch = (await git(["branch", "--show-current"], root, on)).stdout.trim() || "HEAD";
  const sha = (await git(["rev-parse", "HEAD"], root, on)).stdout.trim();
  const { base, mergeBase } = await mergeBaseOf(root, on, prBase, want);
  let commits = await localCommits(root, on, mergeBase);
  const ahead = mergeBase ? commits.length : 0;
  // Already merged: HEAD is in the base, and is not the base's own tip. Its recent commits stay reviewable one by one.
  const merged = !ahead && base ? await mergedInto(root, on, base) : false;
  if (merged) commits = (await localCommits(root, on, null)).slice(0, MERGED_COMMITS).map((c) => ({ ...c, merged: true }));
  return { root, branch, sha, base, mergeBase, ahead, merged, commits };
}

/** The bases to offer: the default bases that exist, the PR's base, then recent branches. */
export async function baseChoices(root, on, prBase) {
  const out = [];
  const add = (ref, note) => { if (ref && !out.some((x) => x.ref === ref)) out.push({ ref, note }); };
  const exists = async (ref) => (await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root, on)).code === 0;
  const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root, on);
  if (head.code === 0 && head.stdout.trim()) add(head.stdout.trim(), "default");
  for (const ref of ["main", "master", "origin/main", "origin/master"]) if (await exists(ref)) add(ref, "default");
  if (prBase && await exists(`origin/${prBase}`)) add(`origin/${prBase}`, "PR base");
  else if (prBase && await exists(prBase)) add(prBase, "PR base");
  const current = (await git(["branch", "--show-current"], root, on)).stdout.trim();
  const recent = await git(["for-each-ref", "--sort=-committerdate", "--count=8", "--format=%(refname:short)", "refs/heads"], root, on);
  for (const ref of recent.stdout.split("\n").filter((r) => r && r !== current)) add(ref, "recent");
  return out;
}

/**
 * Branch, ahead/behind its upstream, uncommitted files, and the lines of both local scopes (untracked files
 * count as added in both), for the panel's "Local changes" row and its two chips.
 */
export async function localSummary(cwd, on, want = null) {
  const branch = (await git(["branch", "--show-current"], cwd, on)).stdout.trim();
  if (!branch) return null;
  const counts = await git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd, on);
  const [behind, ahead] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [null, null];
  const status = await git(["status", "--porcelain", "-uall"], cwd, on);
  const lines = status.code === 0 ? status.stdout.split("\n").filter(Boolean) : [];
  const dirty = lines.length;
  const { base, mergeBase } = await mergeBaseOf(cwd, on, null, want);
  const stat = async (from) => { const r = await git(["diff", "--numstat", from], cwd, on); return r.code === 0 ? numstat(r.stdout) : { added: 0, deleted: 0 }; };
  const uncommitted = await stat("HEAD");
  const branchStat = mergeBase ? await stat(mergeBase) : { ...uncommitted };
  const aheadOfBase = mergeBase ? Number((await git(["rev-list", "--count", `${mergeBase}..HEAD`], cwd, on)).stdout.trim()) || 0 : 0;
  const merged = !aheadOfBase && base ? await mergedInto(cwd, on, base) : false;
  // Untracked files are all added lines (the same first UNTRACKED files the review shows).
  const untracked = lines.filter((l) => l.startsWith("?? ")).map((l) => l.slice(3)).filter((p) => !p.endsWith("/")).slice(0, UNTRACKED);
  if (untracked.length) {
    const wc = await exec("wc", ["-l", "--", ...untracked], { cwd, on }).catch(() => null);
    const rowsOf = (wc?.stdout ?? "").trim().split("\n");
    // With one file wc prints its line; with more, a "total" line ends the list.
    const total = rowsOf.length > 1 ? rowsOf.at(-1) : rowsOf[0];
    const n = Number(/^\s*(\d+)/.exec(total ?? "")?.[1] ?? 0);
    uncommitted.added += n;
    branchStat.added += n;
  }
  return { branch, ahead, behind, dirty, upstream: counts.code === 0, base, aheadOfBase, merged, uncommitted, branchStat,
    // The row's old single count: the scope the review opens with.
    added: (aheadOfBase ? branchStat : uncommitted).added, deleted: (aheadOfBase ? branchStat : uncommitted).deleted };
}
