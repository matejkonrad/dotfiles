// Open in…: where a PR's code is (own space, other spaces, worktrees of the clones found), the inline choice
// when no checkout is on the head branch, and the worktree it makes.
import test from "node:test";
import assert from "node:assert/strict";
import { host, reset, cx } from "./host.mjs";

const ck = await import("../checkout.js");
const oi = await import("../open-in.js");

/**
 * A fake computer: folders → {root, branch, repo, common}; `lists` per common dir → worktree list text.
 * Every git call is recorded in `calls`.
 */
function machine(folders, lists = {}) {
  reset();
  ck.forgetCheckouts();
  const calls = [];
  host.exec = async (cmd, args, opts = {}) => {
    calls.push([cmd, ...args, opts.cwd]);
    const f = folders[opts.cwd];
    if (cmd !== "git") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return f ? { code: 0, stdout: `${f.root}\n${f.common}\n`, stderr: "" } : { code: 128, stdout: "", stderr: "not a repo" };
    if (args[0] === "branch") return f ? { code: 0, stdout: `${f.branch}\n`, stderr: "" } : { code: 128, stdout: "", stderr: "" };
    if (args[0] === "remote") return f && args[2] === "origin" ? { code: 0, stdout: `git@github.com:${f.repo}.git\n`, stderr: "" } : { code: 2, stdout: "", stderr: "" };
    if (args[0] === "worktree" && args[1] === "list") { const common = Object.values(folders).find((x) => x.root === opts.cwd)?.common; return { code: 0, stdout: lists[common] ?? "", stderr: "" }; }
    return { code: 0, stdout: "", stderr: "" };
  };
  return calls;
}
const space = (id, folder, extra = {}) => ({ id, name: id, folder, tabs: [], machine: null, ...extra });
const wt = (...entries) => entries.map(([root, branch]) => `worktree ${root}\nHEAD abc\n${branch ? `branch refs/heads/${branch}` : "detached"}\n`).join("\n");

test("the review's own space wins when it is on the head branch", async () => {
  machine({ "/a": { root: "/a", branch: "feat/x", repo: "o/web", common: "/a/.git" }, "/b": { root: "/b", branch: "feat/x", repo: "o/web", common: "/b/.git" } });
  host.spaces = [space("other", "/b"), space("mine", "/a")];
  const res = await ck.resolveCheckout({ space: host.spaces[1], repo: "o/web", head: "feat/x" });
  assert.equal(res.exact.root, "/a");
});

test("then another space's folder on the head branch (the repo matched by its remote, any case)", async () => {
  machine({ "/a": { root: "/a", branch: "main", repo: "o/web", common: "/a/.git" }, "/c": { root: "/c", branch: "feat/x", repo: "O/Web", common: "/a/.git" },
    "/n": { root: "/n", branch: "feat/x", repo: "o/other", common: "/n/.git" } });
  host.spaces = [space("mine", "/a"), space("unrelated", "/n"), space("wt", "/c")];
  const res = await ck.resolveCheckout({ space: host.spaces[0], repo: "o/web", head: "feat/x" });
  assert.equal(res.exact.root, "/c");
  assert.deepEqual(res.clones.map((c) => c.root), ["/a", "/c"], "the own space's clone first; another repo never");
});

test("then a worktree of a clone found, from git worktree list", async () => {
  machine({ "/a": { root: "/a", branch: "main", repo: "o/web", common: "/a/.git" } },
    { "/a/.git": wt(["/a", "main"], ["/home/.herdr/worktrees/a/feat-x", "feat/x"], ["/tmp/agent", null]) });
  host.spaces = [space("mine", "/a")];
  const res = await ck.resolveCheckout({ space: host.spaces[0], repo: "o/web", head: "feat/x" });
  assert.deepEqual(res.exact, { root: "/home/.herdr/worktrees/a/feat-x", branch: "feat/x", on: null, main: "/a" });
});

test("clones under ~/.herdr/worktrees count even when no space shows them", async () => {
  machine({ "/home/.herdr/worktrees/web/feat-y": { root: "/home/.herdr/worktrees/web/feat-y", branch: "feat/y", repo: "o/web", common: "/src/web/.git" } });
  host.files.set("/home/.herdr/worktrees/web/feat-y/.git", "gitdir: …");
  host.spaces = [space("mine", "/nothing")];
  const res = await ck.resolveCheckout({ space: host.spaces[0], repo: "o/web", head: "feat/y" });
  assert.equal(res.exact?.root, "/home/.herdr/worktrees/web/feat-y");
});

test("no head: the first clone is the answer; folder facts are cached", async () => {
  const calls = machine({ "/a": { root: "/a", branch: "dirty-work", repo: "o/web", common: "/a/.git" } });
  host.spaces = [space("mine", "/a")];
  assert.equal((await ck.resolveCheckout({ space: host.spaces[0], repo: "o/web" })).exact.root, "/a");
  const before = calls.length;
  await ck.resolveCheckout({ space: host.spaces[0], repo: "o/web" });
  assert.equal(calls.length, before, "the second lookup reads no git");
});

test("worktree folders: ~/.herdr/worktrees/<clone>/<branch slug>", () => {
  assert.equal(ck.slugOf("feat/mobile-preview-stage"), "feat-mobile-preview-stage");
  assert.equal(ck.slugOf("fix/ä weird//name"), "fix-weird-name");
  assert.equal(ck.cloneName("/Users/me/Project/framer/FramerStudio", "framer/FramerStudio"), "FramerStudio");
  assert.equal(ck.cloneName(null, "framer/FramerWeb"), "FramerWeb");
  assert.equal(ck.worktreePath("/Users/me", "FramerStudio", "feat/framer-mobile-fixes"), "/Users/me/.herdr/worktrees/FramerStudio/feat-framer-mobile-fixes");
});

test("branch names git would read as options or odd refs are refused", () => {
  for (const ok of ["main", "feat/x", "user/fix-1.2", "release+next"]) assert.ok(ck.validBranch(ok), ok);
  for (const bad of ["-x", "--upload-pack=evil", "a..b", "a/", "/a", "a.lock", "a//b", "a b", "a~1", "a^", "a:b", "HEAD", "", ".hidden", "a/.b"]) assert.equal(ck.validBranch(bad), false, bad);
});

test("parseWorktrees reads branches and detached heads, skips prunable ones", () => {
  const list = ck.parseWorktrees(`${wt(["/a", "main"], ["/b", null])}\nworktree /gone\nHEAD 1\nprunable gitdir file points to non-existent location\n`);
  assert.deepEqual(list, [{ root: "/a", branch: "main" }, { root: "/b", branch: "" }]);
});

test("a new worktree: fetch the head, then worktree add with --end-of-options; nothing switches the clone's branch", async () => {
  const calls = machine({ "/src/FramerStudio": { root: "/src/FramerStudio", branch: "master", repo: "o/FramerStudio", common: "/src/FramerStudio/.git" } });
  const realExec = host.exec;
  host.exec = async (cmd, args, opts) => (args[0] === "rev-parse" && args.includes("--verify") ? (calls.push([cmd, ...args, opts.cwd]), { code: 1, stdout: "", stderr: "" }) : realExec(cmd, args, opts));
  const at = await ck.addWorktree({ clone: { root: "/src/FramerStudio", on: null, main: "/src/FramerStudio" }, repo: "o/FramerStudio", head: "feat/x", number: 7 });
  assert.equal(at.root, "/home/.herdr/worktrees/FramerStudio/feat-x");
  const git = calls.map((c) => c.slice(1, -1).join(" "));
  assert.ok(git.includes("fetch --end-of-options origin +refs/heads/feat/x:refs/remotes/origin/feat/x"));
  assert.ok(git.includes("worktree add --track -b feat/x --end-of-options /home/.herdr/worktrees/FramerStudio/feat-x refs/remotes/origin/feat/x"));
  assert.ok(!git.some((g) => /^(checkout|switch|reset|stash)/.test(g)), "the clone's own checkout is never touched");
});

test("a fork's PR: its pull ref, checked out detached", async () => {
  const calls = machine({});
  host.exec = async (cmd, args, opts) => { calls.push([cmd, ...args, opts.cwd]); return { code: args[0] === "fetch" && args[3].startsWith("+refs/heads/") ? 1 : 0, stdout: "", stderr: "" }; };
  await ck.addWorktree({ clone: { root: "/src/web", on: null }, repo: "o/web", head: "patch-1", number: 12 });
  const git = calls.map((c) => c.slice(1, -1).join(" "));
  assert.ok(git.includes("fetch --end-of-options origin +refs/pull/12/head:refs/remotes/origin/pr/12"));
  assert.ok(git.includes("worktree add --detach --end-of-options /home/.herdr/worktrees/web/patch-1 refs/remotes/origin/pr/12"));
});

test("an invalid head never reaches git", async () => {
  const calls = machine({});
  await assert.rejects(ck.addWorktree({ clone: { root: "/src/web", on: null }, repo: "o/web", head: "--upload-pack=x", number: 1 }));
  assert.equal(calls.length, 0);
});

test("no checkout on the branch: the choice lists the clones, then a new worktree; picking a clone opens it as it is", async () => {
  machine({ "/a": { root: "/a", branch: "main", repo: "o/web", common: "/a/.git" } });
  host.spaces = [space("mine", "/a")];
  const owner = {};
  const opened = [];
  await oi.withCheckout(owner, { space: host.spaces[0], repo: "o/web", head: "feat/x", number: 3 }, (at) => opened.push(at.root), () => {}, cx);
  assert.deepEqual(owner.openChoice.items.map((i) => [i.kind, i.label]), [["folder", "Open /a"], ["worktree", "New worktree for feat/x"]]);
  assert.equal(oi.choiceKey(owner, { key: "1", modifiers: {} }, cx), true);
  assert.deepEqual(opened, ["/a"]);
  assert.equal(owner.openChoice, null);
});

test("no clone at all: the choice offers a clone; Ctrl keys pass through it; esc closes it", async () => {
  machine({});
  host.spaces = [space("mine", "/x")];
  const owner = {};
  await oi.withCheckout(owner, { space: host.spaces[0], repo: "framer/FramerWeb", head: "feat/phone", number: 1 }, () => {}, () => {}, cx);
  assert.deepEqual(owner.openChoice.items.map((i) => i.label), ["Clone framer/FramerWeb on feat/phone"]);
  assert.equal(oi.choiceKey(owner, { key: "h", modifiers: { control: true } }, cx), false, "Ctrl+H still moves between panes");
  assert.equal(oi.choiceKey(owner, { key: "escape", modifiers: {} }, cx), true);
  assert.equal(owner.openChoice, null);
});

test("an exact checkout opens the picker on it at once", async () => {
  machine({ "/a": { root: "/a", branch: "feat/x", repo: "o/web", common: "/a/.git" } });
  host.spaces = [space("mine", "/a")];
  const owner = {};
  await oi.withCheckout(owner, { space: host.spaces[0], repo: "o/web", head: "feat/x" }, (at) => oi.openFolder(at, "src/a.js"), () => {}, cx);
  assert.equal(owner.openChoice, undefined);
  assert.deepEqual(host.overlays.at(-1).props, { file: "/a/src/a.js", folder: "/a", machine: null });
});

const { fixture } = await import("./tab-fixture.mjs");
const { Panel } = await import("../panel.js");
const { render, drawn } = await import("./host.mjs");
const settle = () => new Promise((r) => setTimeout(r, 0));

test("review tab: O and the top bar's Open in… open the file at the cursor in its checkout; the choice takes the keys", async () => {
  const { tab } = fixture();
  machine({ "/a": { root: "/a", branch: "main", repo: "o/r", common: "/a/.git" } });
  host.spaces = [space("s1", "/a")];
  Object.assign(tab, { ref: { repo: "o/r", number: 1 }, meta: { head: "feat/x", threads: [] }, space: () => host.spaces[0], redraw() {} });
  tab.focus = "diff"; tab.agent.focused = false;
  cx.tasks = [];
  assert.equal(tab.key({ key: "o", modifiers: { shift: true } }, cx), true);
  await Promise.all(cx.tasks); cx.tasks = null;
  assert.equal(tab.openChoice.items[0].label, "Open /a", "main is not feat/x: the choice, no switch");
  assert.equal(tab.key({ key: "1", modifiers: {} }, cx), true);
  assert.deepEqual(host.overlays.at(-1).props, { file: "/a/new.js", folder: "/a", machine: null });
  render(() => tab.topBar({ ...host.theme }));
  assert.ok(drawn.has("act-open"), "the top bar has Open in…");
});

test("panel: O on a PR row opens the picker on the checkout on its head branch", async () => {
  machine({ "/a": { root: "/a", branch: "feat/x", repo: "o/r", common: "/a/.git" } });
  host.store.set("review", JSON.stringify({ migrated: null, spaces: { s1: { refs: [{ repo: "o/r", number: 5 }] } }, seen: {}, tab: "space" }));
  host.spaces = [{ ...space("s1", "/a"), active: true }];
  const p = new Panel({}, cx);
  p.handle = { focus() {}, is_focused: () => true };
  p.status["o/r#5"] = { headRef: "feat/x" };
  p.sel = "o/r#5";
  cx.tasks = [];
  assert.equal(p.onKey({ key: "o", modifiers: { shift: true } }, host.spaces[0], cx), true);
  await Promise.all(cx.tasks); cx.tasks = null;
  await settle();
  assert.deepEqual(host.overlays.at(-1).props, { folder: "/a", machine: null });
});
