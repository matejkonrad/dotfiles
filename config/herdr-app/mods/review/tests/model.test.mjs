import test from "node:test";
import assert from "node:assert/strict";
import { comparison, sameComparison, validReference, validateWalkthrough, mergeRecords, inlineRuns, excerptRows, normalizeRef,
  threadTitle, anchorStale, excerptPlan, mergeCodeBlocks, sideSource, upgradeRecord, currentVersion, recentEntries, blocksText, stepRefs, MAX_EXCERPT } from "../walkthrough-model.mjs";
import { codexDefaults } from "../providers.mjs";

const files = [{ path: "new.js", previous: "old.js", status: "renamed", rows: [
  { k: "del", o: 8, n: null, text: "old" }, { k: "add", n: 9, o: null, text: "new" },
  { k: "ctx", n: 10, o: 9, text: "context" },
] }];
const walk = () => ({ summary: "Changed behavior", steps: [{ title: "The contract", body: "Why it matters", references: [{ path: "new.js", side: "LEFT", line: 8 }] }] });

test("comparison identity covers base movement, content changes, rename, scope and checkout", () => {
  const meta = { sha: "head", baseSha: "base", root: "/repo", scope: "branch", from: "merge-base" };
  const a = comparison(meta, files, false);
  assert.ok(sameComparison(a, comparison(meta, files, false)));
  for (const update of [{ baseSha: "new-base" }, { sha: "new-head" }, { scope: "uncommitted" }, { root: "/other" }, { from: "other-base" }]) {
    assert.ok(!sameComparison(a, comparison({ ...meta, ...update }, files, false)));
  }
  const changed = structuredClone(files);
  changed[0].rows[1].text = "different content on the same line";
  assert.ok(!sameComparison(a, comparison(meta, changed, false)));
  changed[0].previous = "another.js";
  assert.ok(!sameComparison(a, comparison(meta, changed, false)));
  const highlighted = structuredClone(files);
  highlighted[0].rows[0].spans = [{ color: "red" }];
  assert.ok(sameComparison(a, comparison(meta, highlighted, false)), "syntax coloring cannot stale a walkthrough");
});

test("references use current rename path and the correct side, with no fabricated lines", () => {
  assert.ok(validReference({ path: "new.js", side: "LEFT", line: 8 }, files));
  assert.ok(validReference({ path: "new.js", side: "RIGHT", line: 9 }, files));
  assert.ok(!validReference({ path: "old.js", side: "LEFT", line: 8 }, files));
  assert.ok(!validReference({ path: "new.js", side: "RIGHT", line: 8 }, files));
  assert.ok(!validReference({ path: "new.js", side: "LEFT", line: 500 }, files));
  const v = validateWalkthrough(walk(), files);
  assert.deepEqual(v.steps[0].blocks, [{ type: "text", md: "Why it matters" }, { type: "code", ref: { path: "new.js", side: "LEFT", start_line: 8, line: 8 } }], "old steps become blocks");
  const bad = walk(); bad.steps[0].references[0].side = "RIGHT";
  assert.throws(() => validateWalkthrough(bad, files), /outside this diff/);
});

test("excerpts are the real diff lines of one hunk, bounded", () => {
  const rows = [{ k: "hunk", text: "@@" }, ...Array.from({ length: 30 }, (_, i) => ({ k: "ctx", o: i + 1, n: i + 1, text: `l${i + 1}` })), { k: "hunk", text: "@@" }, { k: "add", o: null, n: 50, text: "x" }];
  const f = [{ path: "a.js", rows }];
  assert.deepEqual(excerptRows({ path: "a.js", side: "RIGHT", start_line: 2, line: 4 }, f), [2, 3, 4]);
  assert.equal(excerptRows({ path: "a.js", side: "RIGHT", start_line: 1, line: 30 }, f).length, MAX_EXCERPT);
  assert.deepEqual(excerptRows({ path: "a.js", side: "RIGHT", start_line: 29, line: 50 }, f), [32], "never across a hunk header");
  assert.deepEqual(normalizeRef({ path: "a.js", side: "RIGHT", start_line: 4, line: 2 }, f), { path: "a.js", side: "RIGHT", start_line: 2, line: 4 });
  assert.equal(normalizeRef({ path: "a.js", side: "RIGHT", line: 99 }, f), null);
});

test("threads: a short title, stale only when the anchored lines changed after a push", () => {
  assert.equal(threadTitle("Why is mobileView optional? It was required."), "Why is mobileView optional?");
  assert.ok(threadTitle("x ".repeat(60)).length <= 48);
  assert.equal(threadTitle("  "), "Question");
  const anchor = { path: "new.js", side: "RIGHT", start_line: 9, line: 10, snippet: ["new", "context"], comparisonKey: "k1" };
  assert.equal(anchorStale(anchor, files, "k1"), false);
  assert.equal(anchorStale(anchor, files, "k2"), false, "a push that left these lines alone");
  const pushed = structuredClone(files); pushed[0].rows[1].text = "changed";
  assert.equal(anchorStale(anchor, pushed, "k2"), true);
  const gone = [{ path: "new.js", rows: [] }];
  assert.equal(anchorStale(anchor, gone, "k2"), true);
  assert.equal(anchorStale({ step: 1, comparisonKey: "k1" }, files, "k2"), false, "a step thread has no lines");
});

test("v1 records upgrade: the walkthrough becomes version 1, the chat one thread", () => {
  const v1 = { at: 5, comparisonKey: "k", walkthrough: walk(), messages: [{ id: "1", role: "user", body: "q", at: 1 }, { id: "2", role: "assistant", body: "a", at: 2, references: [{ path: "new.js", side: "LEFT", line: 8 }] }], proposal: null };
  const r = upgradeRecord(v1);
  assert.equal(r.v, 2);
  assert.equal(currentVersion(r).comparisonKey, "k");
  assert.equal(r.threads.length, 1);
  assert.deepEqual(r.threads[0].entries.map((e) => e.role), ["question", "answer"]);
  assert.equal(r.threads[0].entries[1].blocks[1].ref.line, 8);
});

test("two saved copies merge: every version, thread and entry of both", () => {
  const t = (id, entries, at = 1) => ({ id, title: id, at, entries: entries.map((e) => ({ id: e, at: Number(e.slice(1)) })) });
  const a = { v: 2, at: 2, versions: [{ id: "v1", at: 1 }, { id: "v2", at: 2 }], current: "v2", threads: [t("A", ["e1", "e3"]), { ...t("B", ["e1"]), closed: true }] };
  const b = { v: 2, at: 1, versions: [{ id: "v1", at: 1 }], current: "v1", threads: [t("A", ["e1", "e2"]), t("C", ["e1"])] };
  const m = mergeRecords(a, b);
  assert.equal(m.current, "v2");
  assert.deepEqual(m.versions.map((v) => v.id), ["v1", "v2"]);
  assert.deepEqual(m.threads.map((x) => x.id).sort(), ["A", "B", "C"], "a closed thread is kept, to reopen");
  assert.equal(m.threads.find((x) => x.id === "B").closed, true);
  assert.deepEqual(m.threads.find((x) => x.id === "A").entries.map((e) => e.id), ["e1", "e2", "e3"]);
  const r = recentEntries(Array.from({ length: 10 }, (_, i) => ({ body: "x".repeat(100), i })), 400);
  assert.ok(r.omitted > 0 && r.entries.at(-1).i === 9);
  assert.equal(blocksText([{ type: "text", md: "See" }, { type: "code", ref: { path: "a.js", start_line: 2, line: 4 } }]), "See\n\n`a.js:2-4`");
  assert.equal(stepRefs({ blocks: [{ type: "code", ref: { line: 1 } }] }).length, 1);
});

test("config defaults and inline markdown", () => {
  assert.deepEqual(codexDefaults('model = "m"\nmodel_reasoning_effort = "low"\n[mcp_servers.x]\nmodel = "other"'), { model: "m", effort: "low" });
  const runs = inlineRuns('Call `run()` with **care** and "quotes"');
  assert.ok(runs.some((r) => r.code && r.text === "run()"));
  assert.ok(runs.some((r) => r.bold && r.text === "care"));
  assert.ok(runs.at(-1).text.includes("“quotes”"));
});

const fn = (body) => ["function f(a) {", "  const x = 1;", ...body, "  return x;", "}"];
test("excerpt context: a one-line ref shows its small hunk, or ±3 lines and the enclosing header in a long one", () => {
  const small = { path: "a.js", rows: [{ k: "hunk", text: "@@" }, ...fn(["  if (a) {", "    go();", "  }"]).map((t, i) => ({ k: "ctx", o: i + 10, n: i + 10, text: t }))] };
  small.rows[4] = { k: "add", o: null, n: 13, text: "    go();" };
  const p = excerptPlan([{ path: "a.js", side: "RIGHT", start_line: 13, line: 13 }], small);
  assert.deepEqual(p.items.map((x) => x.i), [1, 2, 3, 4, 5, 6, 7], "the whole small hunk");
  assert.deepEqual(p.items.filter((x) => x.hot).map((x) => x.i), [4]);
  const body = Array.from({ length: 30 }, (_, i) => `    step${i}();`);
  const long = { path: "b.js", rows: [{ k: "hunk", text: "@@" }, ...["function g() {", ...body, "}"].map((t, i) => ({ k: "ctx", o: i + 1, n: i + 1, text: t }))] };
  const q = excerptPlan([{ path: "b.js", side: "RIGHT", start_line: 12, line: 12 }], long);
  assert.ok(q.items.length <= 16);
  assert.ok(q.items.some((x) => x.i === 9) && q.items.some((x) => x.i === 15), "3 lines above and below");
  const near = excerptPlan([{ path: "b.js", side: "RIGHT", start_line: 6, line: 6 }], long);
  assert.equal(near.items[0].i, 1, "back to the function header");
});

test("excerpt context: beyond the hunk from the file; refs in two hunks join with a gap; long ones fold", () => {
  const rows = [{ k: "hunk", text: "@@" }, { k: "del", o: 20, n: null, text: "  old();" }, { k: "add", o: null, n: 20, text: "  fresh();" },
    { k: "hunk", text: "@@" }, { k: "add", o: null, n: 40, text: "  later();" }];
  const file = { path: "c.js", rows };
  const lines = Array.from({ length: 50 }, (_, i) => (i === 14 ? "function c() {" : `  line${i + 1}();`));
  const one = excerptPlan([{ path: "c.js", side: "RIGHT", start_line: 20, line: 20 }], file, { lines: () => lines });
  assert.deepEqual(one.items.filter((x) => x.kind === "file").map((x) => x.n).slice(0, 2), [15, 16], "up to the header at line 15, read from the file");
  assert.ok(one.items.some((x) => x.kind === "file" && x.n === 21), "and below the hunk");
  const two = excerptPlan([{ path: "c.js", side: "RIGHT", start_line: 20, line: 20 }, { path: "c.js", side: "RIGHT", start_line: 40, line: 40 }], file);
  assert.deepEqual(two.items.map((x) => x.kind), ["row", "row", "gap", "row"]);
  const folded = excerptPlan([{ path: "c.js", side: "RIGHT", start_line: 20, line: 20 }], file, { lines: () => lines, cap: 6 });
  assert.equal(folded.items.length, 6);
  assert.ok(folded.more > 0);
  assert.deepEqual(mergeCodeBlocks([{ type: "code", ref: { path: "a", side: "RIGHT", line: 1 } }, { type: "code", ref: { path: "a", side: "RIGHT", line: 5 } }, { type: "text", md: "x" }]).map((b) => b.refs?.length ?? 0), [2, 0]);
  assert.deepEqual(sideSource("LEFT", { path: "n.js", previous: "o.js" }, { baseSha: "B", sha: "H" }, false), { rev: "B", path: "o.js" }, "the old side reads the base commit");
  assert.deepEqual(sideSource("RIGHT", { path: "n.js" }, { from: "HEAD" }, true), { rev: "worktree", path: "n.js" });
});
