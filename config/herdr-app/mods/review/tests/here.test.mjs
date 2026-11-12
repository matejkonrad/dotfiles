// review.here is synchronous: back from a focused review tab, select an existing one, else a new smart tab at once.
import test from "node:test";
import assert from "node:assert/strict";
import { host, reset } from "./host.mjs";

const here = await import("../here.js");
const plain = (x) => JSON.parse(JSON.stringify(x));

/** A space "s1" whose terminal works in /repo on `branch`; `hints` is what the panel's poll published. */
function world({ tabs, reviewTabs = [], focus, branch = "feat", hints = {} }) {
  reset();
  const space = { id: "s1", active: true, tabs: [...tabs, "term"].map((id) => ({ id, name: id })) };
  host.spaces = [space];
  host.focused = { tab: focus };
  host.panes = [...reviewTabs.map((tab) => ({ tab, mod: "review" })), { tab: "term", terminal: "t1", cwd: "/repo", branch }];
  host.store.set(here.BRANCH_PRS, JSON.stringify(hints));
  const store = new Proxy({}, { get: (_t, k) => JSON.parse(host.store.get(k) ?? "null"), set: (_t, k, v) => { host.store.set(k, JSON.stringify(v)); return true; } });
  return { api: here, runs: host.runs, store };
}

test("select and back act at once, with no await", () => {
  const w = world({ tabs: ["t1", "t2", "rv"], reviewTabs: ["rv"], focus: "t2" });
  assert.equal(w.api.reviewHere(), "select");
  assert.deepEqual(plain(w.runs.at(-1)), ["tab.select", { id: "rv" }]);
  const back = world({ tabs: ["t1", "t2", "rv"], reviewTabs: ["rv"], focus: "rv" });
  back.store["review.back"] = { s1: "t2" };
  assert.equal(back.api.reviewHere(), "back");
  assert.deepEqual(plain(back.runs.at(-1)), ["tab.select", { id: "t2" }]);
});

test("no review tab: a new smart tab at once; the panel's cached branch PR is only a hint", () => {
  const w = world({ tabs: ["t1"], focus: "t1" });
  assert.equal(w.api.reviewHere(), "open");
  assert.deepEqual(plain(w.runs.at(-1)[1].props), { view: "review", space: "s1", smart: true, local: true });
  const hinted = world({ tabs: ["t1"], focus: "t1", hints: { s1: { sig: "|/repo|feat", pr: "o/r#7" } } });
  hinted.api.reviewHere();
  assert.equal(hinted.runs.at(-1)[1].props.pr, "o/r#7");
  // The same branch name in another checkout (or after a switch) is not this PR.
  const moved = world({ tabs: ["t1"], focus: "t1", hints: { s1: { sig: "|/other-repo|feat", pr: "o/r#7" } } });
  moved.api.reviewHere();
  assert.equal(moved.runs.at(-1)[1].props.pr, undefined);
  assert.equal(moved.runs.at(-1)[1].props.local, true);
});

test("one command acts once across copies; a quick second press still counts", () => {
  const w = world({ tabs: ["t1"], focus: "t1" });
  assert.equal(w.api.claim(1000), true);
  assert.equal(w.api.claim(1005), false, "the other copy, a few ms later");
  assert.equal(w.api.claim(1200), true, "a second press 200 ms later");
});
