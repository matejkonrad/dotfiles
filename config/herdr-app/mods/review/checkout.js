// Where a PR's code is on this computer, for Open in…, `e` and the panel. One resolver:
//   1. the folders of the review's own space, 2. every other space's folders and the clones under
//   ~/.herdr/worktrees, 3. `git worktree list` of every clone of the repo found so far.
// A checkout on the PR's head branch wins; without one the caller offers the clones found and a new worktree.
// Nothing here switches a branch in an existing folder: a new worktree is the only thing it makes.
import * as fs from "fs/promises";
import { exec, home, spaces } from "herdr";
import { repoOf } from "./gh.js";
import { foldersOf } from "./store.js";

const TTL_MS = 15_000;
const facts = new Map(); // `${on}|${cwd}` → {at, value: Promise<{root, branch, repo, common} | null>}
const lists = new Map(); // `${on}|${common}` → {at, value: Promise<[{root, branch}]>}

/** Drops the cached folder facts (a new worktree, tests). */
export function forgetCheckouts() { facts.clear(); lists.clear(); }

function cached(map, key, make, now = Date.now()) {
  const hit = map.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = make().catch(() => null);
  map.set(key, { at: now, value });
  return value;
}

const git = (args, cwd, on) => exec("git", args, { cwd, on }).catch(() => ({ code: 1, stdout: "", stderr: "" }));

/** A folder's checkout: its root, branch ("" when detached), GitHub repo and git common dir (one per clone). */
export function folderInfo(cwd, on = null) {
  return cached(facts, `${on ?? ""}|${cwd}`, async () => {
    const [top, br, repo] = await Promise.all([
      git(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], cwd, on),
      git(["branch", "--show-current"], cwd, on),
      repoOf(cwd, on).catch(() => null),
    ]);
    if (top.code !== 0) return null;
    const [root, common] = top.stdout.trim().split("\n");
    if (!root) return null;
    return { root, branch: br.code === 0 ? br.stdout.trim() : "", repo, common: common || `${root}/.git`, on };
  });
}

/** `git worktree list --porcelain` as [{root, branch}]; the first is the main checkout. */
export function parseWorktrees(text) {
  const out = [];
  for (const block of String(text ?? "").split(/\n\s*\n/)) {
    const root = /^worktree (.+)$/m.exec(block)?.[1];
    if (!root || /^prunable/m.test(block)) continue;
    out.push({ root, branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? "" });
  }
  return out;
}

function worktreesOf(info) {
  return cached(lists, `${info.on ?? ""}|${info.common}`, async () => {
    const r = await git(["worktree", "list", "--porcelain"], info.root, info.on);
    return r.code === 0 ? parseWorktrees(r.stdout) : [];
  });
}

/** A branch name safe to hand to git as a ref (git check-ref-format, stricter). */
export function validBranch(b) {
  return typeof b === "string" && b.length > 0 && b.length <= 200 && /^[A-Za-z0-9._/+-]+$/.test(b)
    && !/^[-./]|[/.]$|\.\.|\/\/|\/\.|\.lock$|\.lock\//.test(b) && b !== "HEAD";
}

/** "feat/mobile-preview-stage" → "feat-mobile-preview-stage": a folder name. */
export const slugOf = (branch) => String(branch).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "") || "branch";

/** The clone's folder name: the main checkout's, else the repo's name ("FramerStudio"). */
export function cloneName(main, repo) {
  const base = String(main ?? "").replace(/\/+$/, "").split("/").pop();
  return base && base !== ".git" ? base : String(repo ?? "repo").split("/").pop();
}

/** ~/.herdr/worktrees/<Repo>/<branch slug>, where Herdr keeps its worktrees. */
export const worktreePath = (homeDir, name, branch) => `${String(homeDir).replace(/\/+$/, "")}/.herdr/worktrees/${name}/${slugOf(branch)}`;

/** The checkouts under ~/.herdr/worktrees/<Repo>/: one per repo folder is enough to find its clone. */
async function herdrWorktrees() {
  const base = `${home()}/.herdr/worktrees`;
  const repos = await fs.readdir(base).catch(() => []);
  const one = await Promise.all(repos.map(async (r) => {
    const kids = await fs.readdir(`${base}/${r}`).catch(() => []);
    return kids.length ? `${base}/${r}/${kids[0]}` : null;
  }));
  return one.filter(Boolean);
}

const sameRepo = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();

/**
 * Where `repo`'s code is. Returns {exact: {root, branch, on} | null, clones: [{root, branch, on, main}]} with the
 * clones in the order found: the space's own first. `head` null: the first clone is the answer (exact).
 */
export async function resolveCheckout({ space, repo, head = null }) {
  const all = spaces();
  const order = [space, ...all.filter((s) => s.id !== space?.id)].filter(Boolean);
  const clones = [], seen = new Set(), commons = new Map();
  const add = (info, main = null) => {
    if (!info || seen.has(`${info.on ?? ""}|${info.root}`)) return null;
    seen.add(`${info.on ?? ""}|${info.root}`);
    const c = { root: info.root, branch: info.branch, on: info.on ?? null, main };
    clones.push(c);
    return c;
  };
  const fits = (c) => (head ? c.branch === head : true);
  const scan = async (folders) => {
    const infos = await Promise.all(folders.map(([cwd, on]) => folderInfo(cwd, on)));
    for (const info of infos) {
      if (!info || !sameRepo(info.repo, repo)) continue;
      if (!commons.has(`${info.on ?? ""}|${info.common}`)) commons.set(`${info.on ?? ""}|${info.common}`, info);
      add(info);
    }
  };
  // 1. The review's own space.
  if (space) await scan(foldersOf(space).map((cwd) => [cwd, space.machine ?? null]));
  let exact = clones.find(fits);
  if (exact) return { exact, clones };
  // 2. Every other space, and the clones Herdr made worktrees for.
  const others = order.slice(1).flatMap((s) => foldersOf(s).map((cwd) => [cwd, s.machine ?? null]));
  await scan([...others, ...(await herdrWorktrees()).map((p) => [p, null])]);
  exact = clones.find(fits);
  if (exact) return { exact, clones };
  // 3. The worktrees of every clone found.
  const lists = await Promise.all([...commons.values()].map(async (info) => ({ info, list: await worktreesOf(info) ?? [] })));
  for (const { info, list } of lists) {
    const main = list[0]?.root ?? null;
    for (const c of clones) if (c.on === (info.on ?? null) && list.some((w) => w.root === c.root)) c.main ??= main;
    for (const w of list) add({ root: w.root, branch: w.branch, on: info.on ?? null }, main);
  }
  return { exact: clones.find((c) => head && c.branch === head) ?? null, clones };
}

/**
 * A new worktree of `clone` on the PR's head: fetch the branch (a fork's PR: pull/<n>/head), then
 * `git worktree add` under ~/.herdr/worktrees. Returns {root, branch, on}; throws with git's message.
 */
export async function addWorktree({ clone, repo, head, number }) {
  if (!validBranch(head)) throw new Error(`Not a branch name git takes: ${head}`);
  const on = clone.on ?? null, cwd = clone.root;
  // Named after the main checkout, also when `clone` is one of its worktrees.
  const list = await git(["worktree", "list", "--porcelain"], cwd, on);
  const main = (list.code === 0 ? parseWorktrees(list.stdout)[0]?.root : null) ?? clone.main ?? clone.root;
  const path = worktreePath(home(), cloneName(main, repo), head);
  const branch = await git(["fetch", "--end-of-options", "origin", `+refs/heads/${head}:refs/remotes/origin/${head}`], cwd, on);
  let add;
  if (branch.code === 0) {
    const local = await git(["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${head}`], cwd, on);
    add = local.code === 0 ? ["worktree", "add", "--end-of-options", path, head]
      : ["worktree", "add", "--track", "-b", head, "--end-of-options", path, `refs/remotes/origin/${head}`];
  } else {
    // A fork's branch is not on origin: its PR ref is.
    if (!Number.isInteger(Number(number))) throw new Error(`git fetch origin ${head}: ${branch.stderr.trim() || "failed"}`);
    const pr = await git(["fetch", "--end-of-options", "origin", `+refs/pull/${Number(number)}/head:refs/remotes/origin/pr/${Number(number)}`], cwd, on);
    if (pr.code !== 0) throw new Error(`git fetch: ${pr.stderr.trim() || branch.stderr.trim() || "failed"}`);
    add = ["worktree", "add", "--detach", "--end-of-options", path, `refs/remotes/origin/pr/${Number(number)}`];
  }
  const r = await git(add, cwd, on);
  if (r.code !== 0) throw new Error(`git worktree add: ${r.stderr.trim() || "failed"}`);
  forgetCheckouts();
  return { root: path, branch: head, on };
}

/** A clone of `repo` on its head branch under ~/.herdr/worktrees, when this computer has none (gh does the auth). */
export async function cloneRepo({ repo, head }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !validBranch(head)) throw new Error(`Can't clone ${repo} on ${head}`);
  const path = worktreePath(home(), cloneName(null, repo), head);
  const r = await exec("gh", ["repo", "clone", repo, path, "--", "--branch", head]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
  if (r.code !== 0) throw new Error(`gh repo clone: ${String(r.stderr ?? "").trim() || "failed"}`);
  forgetCheckouts();
  return { root: path, branch: head, on: null };
}
