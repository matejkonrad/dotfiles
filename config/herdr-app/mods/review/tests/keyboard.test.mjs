// The Agent panel and the review tab's keys and clicks, in node: the mod's real modules over a fake host
// (tests/host.mjs), whose element builder records ids and handlers, so a test can click what render() drew.
import test from "node:test";
import assert from "node:assert/strict";
import { host, drawn, theme, cx } from "./host.mjs";

import { fixture, setStore } from "./tab-fixture.mjs";

const render = (a) => { drawn.clear(); a.render(theme, cx); };
const click = (id) => { const e = drawn.get(id); assert.ok(e, `drawn: ${id}`); (e.handlers.click ?? e.handlers.down)({ modifiers: {}, click_count: 1, position: { x: 0 } }, cx); };

test("keys reach steps and excerpts; ↵ opens the excerpt in the diff with its lines selected", () => {
  const { tab, a } = fixture();
  a.key({ key: "j" }, cx);
  assert.equal(a.step, 1);
  a.key({ key: "l" }, cx);
  assert.equal(a.link, 0);
  a.key({ key: "enter" }, cx);
  assert.equal(tab.side, "right");
  assert.equal(tab.folded(0), false, "the file is open");
  assert.equal(tab.rows[tab.cursor].n, 9);
  assert.equal(tab.rows[tab.anchor].n, 8, "the excerpt's lines are selected");
  assert.equal(tab.focus, "diff");
});

test("clicks work: an excerpt's header, its Open button, a line in it, a step title, a tab", () => {
  const { tab, a } = fixture();
  render(a);
  click("s0-e0-head");
  assert.equal(tab.rows[tab.cursor].o, 8, "the header opens the excerpt");
  assert.ok(drawn.get("s0-e0-l2"), "a one-line ref shows its hunk as context");
  tab.cursor = 0;
  render(a);
  click("s1-e0-open");
  assert.equal(tab.rows[tab.cursor].n, 9);
  tab.cursor = 0; a.focused = true;
  render(a);
  const line = drawn.get("s1-e0-l1");
  line.handlers.down({ modifiers: {} }, cx);
  line.handlers.up({}, cx);
  assert.notEqual(tab.cursor, 0, "a click on an excerpt line opens that line");
  render(a);
  click("walk-step-1-head");
  assert.equal(a.step, 1);
});

test("Ask on a step or an excerpt opens a thread tab tied to it; the bottom input asks about the PR", () => {
  const { a, calls } = fixture();
  render(a);
  click("walk-step-1-ask");
  assert.notEqual(a.tab, "walk");
  assert.deepEqual({ step: a.thread().anchor.step }, { step: 1 });
  a.select("walk", cx);
  render(a);
  click("s0-e0-ask");
  assert.equal(a.thread().anchor.path, "new.js");
  assert.deepEqual(a.thread().anchor.snippet, ["old"]);
  const fresh = fixture();
  fresh.a.input.set_value("Is this right?");
  fresh.a.send(cx);
  assert.equal(fresh.a.thread().anchor.pr, true, "nothing picked: the thread is about the whole PR");
  assert.deepEqual(fresh.calls.map((c) => c.action), ["ask"]);
});

test("r regenerates at once, even with an error or a stale walkthrough showing", () => {
  const { tab, a } = fixture();
  const jobs = [];
  a.request = (job) => jobs.push(job.action);
  tab.meta.sha = "new-head";
  a.error = "Something failed.";
  assert.equal(a.key({ key: "r" }, cx), true);
  assert.deepEqual(jobs, ["generate"], "the first r generates; no Esc or y needed");
  assert.equal(a.error, null);
});

test("a stale walkthrough opens nothing until Show anyway", () => {
  const { tab, a } = fixture();
  tab.meta.sha = "new-head";
  a.key({ key: "enter" }, cx);
  assert.equal(a.showAnyway, true);
  assert.equal(tab.focus, "agent", "nothing opened yet");
});

test("threads: numbered tabs, x closes (kept), Threads ▾ reopens; c makes a draft from the answer", () => {
  const { tab, a } = fixture();
  a.change = (fn) => { fn(a.record); };
  const th = { id: "T1", title: "Why old?", at: 1, readAt: 0, anchor: { path: "new.js", side: "LEFT", start_line: 8, line: 8, snippet: ["old"], comparisonKey: a.comparisonKey },
    entries: [{ id: "q", role: "question", body: "Why?", at: 1 }, { id: "e", role: "answer", blocks: [{ type: "text", md: "Because." }], at: 2, provider: "claude" }] };
  a.record.threads.push(th);
  a.key({ key: "2" }, cx);
  assert.equal(a.tab, "T1");
  assert.equal(a.number("T1"), 1);
  a.key({ key: "x" }, cx);
  assert.equal(a.tab, "walk");
  assert.equal(a.record.threads[0].closed, true);
  assert.deepEqual([...a.tabs()], ["walk"]);
  a.reopen("T1", cx);
  assert.equal(a.tab, "T1");
  a.key({ key: "c" }, cx);
  assert.equal(tab.pending.range.line, 8);
  assert.equal(tab.composer.value(), "Because.");
});

test("review shortcuts never act while the Agent panel has the keyboard; Tab cycles the columns", () => {
  const { tab, a } = fixture();
  for (const key of ["a", "d", "q", "e"]) {
    assert.equal(tab.key({ key }, cx), true);
    assert.equal(tab.modal, null);
    assert.equal(tab.pending, null);
  }
  a.input.focus();
  assert.equal(tab.key({ key: "a" }, cx), false, "typing must not become a diff comment");
  tab.key({ key: "escape" }, cx);
  tab.key({ key: "tab" }, cx);
  assert.equal(tab.focus, "files");
  tab.key({ key: "tab" }, cx);
  assert.equal(tab.focus, "diff");
  tab.key({ key: "tab" }, cx);
  assert.equal(tab.focus, "agent");
});

test("i in the diff asks about the selected lines; n walks the step's excerpts", () => {
  const { tab, a } = fixture();
  tab.focus = "diff"; a.focused = false;
  tab.cursor = tab.where.get("new.js|RIGHT|8");
  tab.key({ key: "i" }, cx);
  assert.equal(a.thread().anchor.line, 8);
  assert.equal(a.thread().anchor.side, "RIGHT");
  a.key({ key: "escape" }, cx); // leave the question input
  a.select("walk", cx);
  tab.focus = "diff"; a.focused = false;
  a.step = 0;
  tab.cursor = 0;
  tab.key({ key: "n" }, cx);
  assert.equal(tab.rows[tab.cursor].o, 8);
  tab.key({ key: "n" }, cx);
  assert.equal(a.step, 1, "past the step's last excerpt: the next step");
});

test("closing the tab cancels a running request", async () => {
  const { a } = fixture();
  a.requestFile = "/home/data/walkthrough/requests/1-x.json";
  await a.close();
  assert.deepEqual(host.fs.written[0], ["/home/data/walkthrough/requests/1-x.json.cancel", "cancel"]);
});

test("file list clicks go by the row's key, in reading order and in folders", () => {
  const { tab, a } = fixture();
  tab.fileRowsKey = null;
  const reading = [...tab.fileRows()].map((n) => tab.fileRowKey(n));
  assert.deepEqual(reading, ["g:0", "f:0:new.js"], "step groups, then their files");
  tab.clickFileRow("g:0", cx);
  assert.equal(a.step, 0);
  assert.equal(tab.rows[tab.cursor].o, 8, "a step header opens the step's first excerpt");
  tab.cursor = 0;
  tab.clickFileRow("f:0:new.js", cx);
  assert.equal(tab.fileAt(tab.cursor), 0);
  assert.equal(tab.focus, "diff");
  setStore({ fileOrder: "folders" });
  tab.fileRowsKey = null;
  tab.cursor = 0;
  const folders = [...tab.fileRows()].map((n) => tab.fileRowKey(n));
  assert.deepEqual(folders, ["f::new.js"]);
  tab.clickFileRow("f::new.js", cx);
  assert.notEqual(tab.rows[tab.cursor].k, "file", "the file's first change");
});

test("1 2 3 pick the scope from the diff; in the Agent panel 1 to 9 still pick its tabs", () => {
  const { tab, a } = fixture();
  const loads = [];
  tab.load = (_cx, o) => { loads.push(o); };
  tab.info = { commits: [{ sha: "c2abcde", short: "c2abcde", parents: ["c1abcde"], subject: "two" }, { sha: "c1abcde", short: "c1abcde", parents: ["c0abcde"], subject: "one" }],
    since: { sha: "c1abcde", from: "review" }, newSince: 1 };
  tab.focus = "diff"; a.focused = false;
  tab.key({ key: "2" }, cx);
  assert.equal(tab.scopeKey(), "since");
  assert.equal(tab.akey(), "o/r#1~since", "each scope keeps its own walkthrough and threads");
  tab.key({ key: "1" }, cx);
  assert.equal(tab.scopeKey(), "all");
  assert.equal(tab.akey(), "o/r#1");
  tab.key({ key: "3" }, cx);
  assert.ok(tab.picker, "3 opens the commit picker");
  tab.key({ key: "down" }, cx);
  tab.key({ key: "down", modifiers: { shift: true } }, cx);
  assert.deepEqual({ ...tab.picker.sel }, { a: 0, b: 1 });
  tab.key({ key: "enter" }, cx);
  assert.equal(tab.picker, null);
  assert.equal(tab.scopeKey(), "c:c1abcde..c2abcde");
  assert.equal(loads.length, 3);
  assert.equal(a.record, null, "the new scope reads its own record");
  a.loaded = true;
  a.record = { v: 2, at: 1, current: null, versions: [], threads: [{ id: "T1", title: "Q", at: 1, readAt: 9, anchor: { pr: true }, entries: [] }] };
  tab.focus = "agent"; a.focused = true;
  tab.key({ key: "2" }, cx);
  assert.equal(a.tab, "T1", "the Agent panel's tab");
  assert.equal(tab.scopeKey(), "c:c1abcde..c2abcde", "the scope stays");
});

test("in every scope a file click opens its lines; the empty state shows only when the scope has no rows", () => {
  const scopes = [
    [true, { kind: "uncommitted" }, { ahead: 2, base: "master" }],
    [true, { kind: "branch" }, { ahead: 0, base: "origin/master" }],
    [true, { kind: "branch" }, { ahead: 0, merged: true, base: "origin/master" }],
    [true, { kind: "commits", from: "a", to: "a" }, { ahead: 1, base: "master" }],
    [false, { kind: "all" }, {}],
    [false, { kind: "since" }, { since: { sha: "s" } }],
  ];
  for (const [local, scope, info] of scopes) {
    const { tab } = fixture();
    Object.assign(tab, { local, scope, info });
    setStore({ fileOrder: "folders" });
    tab.fileRowsKey = null;
    tab.cursor = 0;
    tab.clickFileRow("f::new.js", cx);
    assert.equal(tab.fileAt(tab.cursor), 0, `${scope.kind}: the file`);
    assert.notEqual(tab.rows[tab.cursor].k, "file", `${scope.kind}: its first change`);
    assert.equal(tab.emptyEl(theme), null, `${scope.kind}: rows show, not an empty state`);
  }
  const { tab } = fixture();
  Object.assign(tab, { local: true, scope: { kind: "branch" }, info: { ahead: 0, base: "master" } });
  assert.match(tab.scopeLine(), /No commits ahead of master\. Showing uncommitted changes\./);
  tab.info.merged = true;
  assert.match(tab.scopeLine(), /Already merged into master/);
  tab.rows = [];
  assert.notEqual(tab.emptyEl(theme), null, "no rows: the empty state");
});
