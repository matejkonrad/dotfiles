import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as sc from "../scopes.mjs";

const FLAGS = ["diff", "--no-color", "--no-ext-diff", "-M", "--full-index"];

test("each local scope maps to its git diff", () => {
  assert.deepEqual(sc.localDiffArgv({ kind: "uncommitted" }), [...FLAGS, "HEAD"]);
  assert.deepEqual(sc.localDiffArgv({ kind: "branch" }, { mergeBase: "mb1" }), [...FLAGS, "mb1"], "the working tree vs the merge-base");
  assert.deepEqual(sc.localDiffArgv({ kind: "commits", from: "c2", to: "c2" }), [...FLAGS, "c2^", "c2"], "one commit: its parent to it");
  assert.deepEqual(sc.localDiffArgv({ kind: "commits", from: "c1", to: "c3", count: 3 }), [...FLAGS, "c1^", "c3"], "a range: the oldest's parent to the newest");
  assert.deepEqual(sc.localDiffArgv({ kind: "commits", from: "r", to: "r", root: true }), [...FLAGS, sc.EMPTY_TREE, "r"], "a root commit: the empty tree");
  assert.ok(sc.withUntracked({ kind: "uncommitted" }) && sc.withUntracked({ kind: "branch" }));
  assert.ok(!sc.withUntracked({ kind: "commits", from: "a", to: "a" }), "a commit never shows untracked files");
  assert.deepEqual(sc.logArgv("mb1").slice(-2), ["mb1..HEAD", "--"]);
  assert.throws(() => sc.localDiffArgv({ kind: "since" }));
});

test("a range picked in the list (newest first) is oldest-parent to newest", () => {
  const list = [{ sha: "c3", parents: ["c2"] }, { sha: "c2", parents: ["c1"] }, { sha: "c1", parents: ["c0"] }, { sha: "c0", parents: [] }];
  const range = sc.commitsScope(list, 0, 2);
  assert.deepEqual(range, { kind: "commits", from: "c1", to: "c3", base: "c0", root: false, count: 3 });
  assert.deepEqual(sc.localDiffArgv(range), [...FLAGS, "c1^", "c3"]);
  assert.equal(sc.prScopeApi("o/r", range, { head: "c3" }), "repos/o/r/compare/c0...c3");
  assert.deepEqual(sc.commitsScope(list, 2, 0), range, "either drag direction");
  assert.equal(sc.commitsScope(list, 3).root, true);
  assert.deepEqual(sc.rowsOfScope(list, range), [0, 2]);
  assert.equal(sc.commitsLabel(range), "3 commits");
  assert.equal(sc.commitsLabel(sc.commitsScope(list, 1)), "c2");
  assert.equal(sc.scopeKey(range), "c:c1..c3");
  assert.deepEqual(sc.parseScopeKey("c:a1b2..c3d4"), { kind: "commits", from: "a1b2", to: "c3d4" });
  assert.deepEqual(sc.parseScopeKey("since"), { kind: "since" });
});

test("each PR scope maps to its GitHub call", () => {
  assert.equal(sc.prScopeApi("o/r", { kind: "all" }, { head: "h" }), null, "the PR's own files list");
  assert.equal(sc.prScopeApi("o/r", { kind: "since" }, { head: "h", since: "s" }), "repos/o/r/compare/s...h");
  assert.throws(() => sc.prScopeApi("o/r", { kind: "since" }, { head: "h" }), /Nothing reviewed yet/);
  assert.equal(sc.prScopeApi("o/r", { kind: "commits", from: "x", to: "x", base: "w" }, { head: "h" }), "repos/o/r/commits/x");
});

test("the default scope: local by commits ahead, PR by new commits since the review; a saved pick wins until the head moves", () => {
  assert.equal(sc.defaultScope({ local: true, ahead: 3 }).kind, "branch");
  assert.equal(sc.defaultScope({ local: true, ahead: 0 }).kind, "uncommitted");
  assert.equal(sc.defaultScope({ local: false }).kind, "all");
  assert.equal(sc.defaultScope({ local: false, newSince: 2 }).kind, "since");
  const saved = { scope: "uncommitted", sig: "head1" };
  assert.equal(sc.defaultScope({ local: true, ahead: 3, saved, sig: "head1" }).kind, "uncommitted", "the same state: the saved pick");
  assert.equal(sc.defaultScope({ local: true, ahead: 3, saved, sig: "head2" }).kind, "branch", "new commits: the smart default wins");
  assert.equal(sc.defaultScope({ local: false, newSince: 2, saved: { scope: "all", sig: "h" }, sig: "h" }).kind, "all");
  assert.equal(sc.defaultScope({ local: false, saved: { scope: "uncommitted", sig: "h" }, sig: "h" }).kind, "all", "a local scope never opens a PR");
  assert.equal(sc.defaultScope({ local: true, ahead: 1, saved: { scope: "c:abcd", sig: "h" }, sig: "h", valid: () => false }).kind, "branch", "a commit that is gone");
});

test("Since review starts at the viewer's last submitted review, else the last fully viewed commit", () => {
  const commits = [{ sha: "a", files: [{ path: "x", blob: "1" }] }, { sha: "b", files: [{ path: "y", blob: "2" }] }, { sha: "c", files: [{ path: "x", blob: "3" }] }];
  const reviews = [
    { user: { login: "me" }, state: "COMMENTED", commit_id: "a", submitted_at: "2026-01-01T00:00:00Z" },
    { user: { login: "me" }, state: "APPROVED", commit_id: "b", submitted_at: "2026-01-02T00:00:00Z" },
    { user: { login: "me" }, state: "PENDING", commit_id: "c" },
    { user: { login: "other" }, state: "COMMENTED", commit_id: "c", submitted_at: "2026-01-03T00:00:00Z" },
  ];
  assert.deepEqual(sc.sinceBase({ reviews, viewer: "me", commits }), { sha: "b", from: "review" });
  assert.equal(sc.commitsAfter(commits, "b"), 1, "one new commit since the review");
  assert.equal(sc.commitsAfter(commits, "gone"), null, "a force push: unknown");
  const marks = new Set(["x@1", "y@2"]);
  assert.deepEqual(sc.sinceBase({ reviews: [], viewer: "me", commits, viewed: (c) => sc.commitViewed(marks, c) }), { sha: "b", from: "viewed" });
  assert.equal(sc.sinceBase({ reviews: [], viewer: "me", commits }), null, "nothing reviewed yet");
});

test("drafts: All changes always posts; other scopes only where the line is in the PR head with the same text", () => {
  const head = sc.lineIndex([{ path: "a.js", rows: [{ k: "ctx", o: 1, n: 1, text: "keep" }, { k: "add", o: null, n: 2, text: "new" }, { k: "del", o: 2, n: null, text: "old" }] }]);
  assert.ok(sc.postable({ path: "a.js", side: "RIGHT", line: 99 }, head), "no scope: All changes");
  assert.ok(sc.postable({ path: "a.js", side: "RIGHT", line: 2, scope: "since", snippet: ["new"] }, head));
  assert.ok(!sc.postable({ path: "a.js", side: "RIGHT", line: 2, scope: "c:abc", snippet: ["changed later"] }, head), "the head has other text there");
  assert.ok(!sc.postable({ path: "a.js", side: "RIGHT", line: 7, scope: "c:abc" }, head), "not in the PR's diff");
  assert.ok(!sc.postable({ path: "b.js", side: "RIGHT", line: 1, scope: "since" }, head));
  assert.ok(sc.postable({ path: "a.js", side: "LEFT", line: 2, scope: "since", snippet: ["old"] }, head));
  assert.ok(!sc.postable({ path: "a.js", side: "RIGHT", line: 2, start_line: 5, scope: "since", snippet: ["x", "new"] }, head), "a range must start in the diff too");
  assert.ok(!sc.postable({ path: "a.js", side: "RIGHT", line: 2, scope: "since" }, null));
});

test("viewed marks are per path and content: they hold across scopes until the file changes", () => {
  const marks = new Set([sc.viewedKey({ path: "a.js", blob: "b1" })]);
  assert.ok(sc.isViewed(marks, { path: "a.js", blob: "b1" }), "the same content in another scope");
  assert.ok(!sc.isViewed(marks, { path: "a.js", blob: "b2" }), "the file changed");
  assert.ok(sc.isViewed(["a.js"], { path: "a.js", blob: "b9" }), "a mark from before blobs still counts");
  assert.ok(sc.commitViewed(marks, { files: [{ path: "a.js", blob: "b1" }] }));
  assert.ok(!sc.commitViewed(marks, { files: [{ path: "a.js", blob: "b1" }, { path: "c.js", blob: "x" }] }));
  assert.ok(!sc.commitViewed(marks, { files: null }), "no files known yet");
});

test("Space in the picker grows, shrinks or restarts the range", () => {
  assert.deepEqual(sc.toggleRow(null, 2), { a: 2, b: 2 });
  assert.deepEqual(sc.toggleRow({ a: 2, b: 2 }, 3), { a: 2, b: 3 });
  assert.deepEqual(sc.toggleRow({ a: 2, b: 3 }, 0), { a: 0, b: 3 });
  assert.deepEqual(sc.toggleRow({ a: 0, b: 3 }, 0), { a: 1, b: 3 });
  assert.deepEqual(sc.toggleRow({ a: 1, b: 3 }, 3), { a: 1, b: 2 });
  assert.deepEqual(sc.toggleRow({ a: 1, b: 3 }, 2), { a: 2, b: 2 });
  assert.equal(sc.toggleRow({ a: 2, b: 2 }, 2), null);
});

test("the git commands give each scope's files in a real repository", async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "review-scopes-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" } });
  const write = (name, text) => fs.writeFile(path.join(dir, name), text);
  const names = (argv) => git(...argv.filter((a) => a !== "--no-color"), "--name-only").split("\n").filter(Boolean).sort();
  try {
    git("init", "-q", "-b", "main");
    await write("base.txt", "base\n"); git("add", "."); git("commit", "-qm", "base");
    git("checkout", "-qb", "feature");
    for (const n of [1, 2, 3]) { await write(`f${n}.txt`, `${n}\n`); git("add", "."); git("commit", "-qm", `commit ${n}`); }
    await write("base.txt", "base\nchanged\n");
    await write("new.txt", "untracked\n");
    const mergeBase = git("merge-base", "HEAD", "main").trim();
    const commits = sc.parseLog(git(...sc.logArgv(mergeBase)));
    assert.deepEqual(commits.map((c) => c.subject), ["commit 3", "commit 2", "commit 1"], "newest first, only the branch's");
    assert.deepEqual(commits[0].files.map((f) => f.path), ["f3.txt"]);
    assert.equal(commits[0].short.length, 7, "a short SHA, though the blobs are full");
    assert.equal(commits[0].additions, 1);
    assert.match(commits[0].files[0].blob, /^[0-9a-f]{40}$/);
    assert.deepEqual(names(sc.localDiffArgv({ kind: "uncommitted" })), ["base.txt"], "untracked files are added by ls-files, not the diff");
    assert.deepEqual(names(sc.localDiffArgv({ kind: "branch" }, { mergeBase })), ["base.txt", "f1.txt", "f2.txt", "f3.txt"], "the branch includes the working tree");
    assert.deepEqual(names(sc.localDiffArgv(sc.commitsScope(commits, 1))), ["f2.txt"]);
    assert.deepEqual(names(sc.localDiffArgv(sc.commitsScope(commits, 0, 1))), ["f2.txt", "f3.txt"]);
    const all = sc.parseLog(git(...sc.logArgv(null)));
    assert.deepEqual(names(sc.localDiffArgv(sc.commitsScope(all, all.length - 1))), ["base.txt"], "the root commit against the empty tree");
    assert.deepEqual(git("ls-files", "--others", "--exclude-standard").trim(), "new.txt");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
