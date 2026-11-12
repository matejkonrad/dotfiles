// Races, timeouts and bad saved data: an old answer never lands on a newer state, and nothing throws in render.
import test from "node:test";
import assert from "node:assert/strict";
import { host, cx, theme } from "./host.mjs";
import { fixture, setStore, AgentPanel } from "./tab-fixture.mjs";

/** Runs the tasks a call spawns, to the end. */
async function settle(fn) {
  const tasks = (cx.tasks = []);
  try { await fn(); while (tasks.length) await tasks.shift(); } finally { cx.tasks = undefined; }
}

/** A space with a git checkout of o/r on branch feat, as exec answers. */
function checkout(extra = () => null) {
  host.spaces = [{ id: "s1", name: "work", active: true, tabs: [], folder: "/repo" }];
  host.exec = async (cmd, args, opts) => {
    const got = extra(cmd, args, opts);
    if (got) return got;
    if (cmd === "git" && args.includes("--show-toplevel")) return { code: 0, stdout: "/repo\n" };
    if (cmd === "git" && args.includes("--show-current")) return { code: 0, stdout: "feat\n" };
    if (cmd === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:o/r.git\n" };
    return { code: 0, stdout: "", stderr: "" };
  };
}

test("an agent request the host stops waiting for leaves a .cancel for the runner", async () => {
  const { tab, a } = fixture();
  tab.ref = { repo: "o/r", number: 1 };
  checkout((cmd) => (cmd === "node" ? Promise.reject(new Error("timed out")) : null));
  await settle(() => AgentPanel.prototype.request.call(a, { action: "generate" }, cx));
  const cancel = host.fs.written.find(([f]) => f.endsWith(".json.cancel"));
  assert.ok(cancel, "the runner is told to stop");
  const request = JSON.parse(host.fs.written.find(([f]) => /requests\/\d+-\w+\.json$/.test(f))[1]);
  assert.ok(request.deadline > Date.now() && request.deadline < Date.now() + 600_000, "the runner's deadline is inside the host's cap");
  assert.match(a.error, /timed out/);
});

/** A local review tab over the fake checkout; `diff(n)` answers the n-th `git diff` of the scope. */
function localTab(diff) {
  const f = fixture();
  let n = 0;
  checkout((cmd, args) => (cmd === "git" && args.includes("diff") && !args.includes("--no-index") ? diff(n++) : null));
  Object.assign(f.tab, { local: true, ref: null, dkey: "local:s1", p: { space: "s1", local: true }, view: { report() {} }, details: new Map(), loadGen: 0, rows: [], files: [] });
  delete f.tab.load;
  return f;
}
const DIFF = "diff --git a/x.js b/x.js\nindex 1..2 100644\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n";

test("an older load that fails after a newer one succeeded changes nothing", async () => {
  let fail;
  const { tab } = localTab((n) => (n === 0 ? new Promise((_, reject) => { fail = reject; }) : { code: 0, stdout: DIFF }));
  const tasks = (cx.tasks = []);
  const first = tab.load(cx);
  while (!fail) await new Promise((r) => setImmediate(r));
  const second = tab.load(cx, { force: true });
  await second;
  fail(new Error("old load failed"));
  await first;
  cx.tasks = undefined; await Promise.all(tasks);
  assert.equal(tab.error, null);
  assert.equal(tab.files[0].path, "x.js");
  assert.equal(tab.loading, false);
});

test("a scope switch is saved only once its diff loaded", async () => {
  const { tab } = localTab((n) => (n === 0 ? { code: 0, stdout: DIFF } : { code: 128, stdout: "", stderr: "fatal: bad revision" }));
  await settle(() => tab.load(cx));
  assert.equal(tab.scopeKey(), "uncommitted");
  await settle(() => { tab.setScope({ kind: "branch" }, cx); return tab.loadPromise; });
  assert.equal(tab.scopeKey(), "uncommitted", "the failed scope goes back");
  assert.match(tab.flash, /bad revision/);
  assert.equal(JSON.parse(host.store.get("review") ?? "{}").scopes?.["local:/repo"], undefined, "nothing saved");
});

test("a background refresh of an unchanged diff keeps the rows, the cursor and its colors", async () => {
  const { tab } = localTab(() => ({ code: 0, stdout: DIFF }));
  await settle(() => tab.load(cx));
  const rows = tab.rows;
  tab.cursor = 2; rows[2].runs = ["kept"];
  await settle(() => tab.load(cx, { quiet: true }));
  assert.equal(tab.rows, rows);
  assert.equal(tab.cursor, 2);
  assert.deepEqual(rows[2].runs, ["kept"]);
});

test("pasting the notes keeps a note written while the paste ran", async () => {
  const { tab } = fixture();
  delete tab.notes;
  tab.ref = { repo: "o/r", number: 1 };
  host.store.set("review.drafts", JSON.stringify({ "o/r#1": { notes: [{ id: "n1", path: "new.js", side: "RIGHT", line: 8, body: "first" }], viewed: [] } }));
  let finish;
  host.exec = () => new Promise((resolve) => { finish = resolve; });
  const tasks = (cx.tasks = []);
  tab.pasteTo({ address: "t9" }, cx);
  const { editDrafts } = await import("../store.js");
  editDrafts("o/r#1", (d) => { d.notes.push({ id: "n2", path: "new.js", side: "RIGHT", line: 9, body: "second" }); });
  finish({ code: 0, stdout: "" });
  cx.tasks = undefined; await Promise.all(tasks);
  assert.deepEqual(tab.notes().map((n) => n.id), ["n2"]);
});

test("context lines of a checkout on another machine are read there", async () => {
  const { tab, a } = fixture();
  Object.assign(tab, { local: true, meta: { ...tab.meta, root: "/srv/repo" }, info: { on: "vps" } });
  const calls = [];
  host.exec = async (cmd, args, opts) => { calls.push([cmd, opts?.on]); return { code: 0, stdout: "x\n" }; };
  a.lineWants.add("abc|src/x.js");
  await settle(() => a.fetchLines(cx));
  assert.deepEqual(calls, [["git", "vps"]]);
});

test("an unreadable record is kept as a copy and named in the panel; a malformed one still renders", async () => {
  const { a } = fixture();
  a.record = null;
  host.files.set(a.file(), "{not json");
  await settle(() => a.loadRecord(cx));
  assert.match(a.error, /unreadable/);
  assert.ok([...host.files.keys()].some((k) => k.includes(".corrupt-")));
  const bad = { v: 2, at: 1, current: "v1", versions: [{ id: "v1", walkthrough: { summary: 3, steps: [null, { title: "S", blocks: [{ type: "code" }, { type: "text", md: "ok" }] }] } }],
    threads: [{ id: "T1", title: "no entries", anchor: { pr: true } }, { id: "T2", anchor: { path: "new.js", side: "RIGHT", line: 8 }, entries: [{ id: "e", role: "answer", blocks: "x" }] }] };
  a.record = AgentPanel.upgrade(bad);
  assert.deepEqual(a.record.threads.map((t) => t.id), ["T2"]);
  assert.deepEqual(a.record.versions[0].walkthrough.steps[0].blocks, [{ type: "text", md: "ok" }]);
  assert.doesNotThrow(() => a.render(theme, cx));
  a.tab = "T2";
  assert.doesNotThrow(() => a.render(theme, cx));
});
