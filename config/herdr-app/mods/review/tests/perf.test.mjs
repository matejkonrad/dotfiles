// What keeps the review fast: shared state read once per frame, and a key or click redrawing only what it changed.
import test from "node:test";
import assert from "node:assert/strict";
import { host, cx, theme, drawn } from "./host.mjs";
import { fixture } from "./tab-fixture.mjs";

const store = await import("../store.js");
const { Scroller } = await import("../scroller.js");

const DRAFTS = (n) => ({ "o/r#1": { type: "pr", notes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, path: "new.js", side: "RIGHT", line: 8, body: `Note ${i}`, sha: "a" })),
  viewed: ["new.js@x", "other.js@y"] }, "o/r#2": { type: "agent", notes: [], viewed: ["a@b"], at: Date.now() } });

function realTab() {
  const f = fixture();
  // The fixture's stubs read nothing; the real ones read the drafts store.
  delete f.tab.notes; delete f.tab.fresh; delete f.tab.type;
  Object.assign(f.tab, { info: { commits: [] }, fileHandle: null, renders: 0, scroll: new Scroller("rows"), fileScroll: new Scroller("files") });
  host.store.set("review.drafts", JSON.stringify(DRAFTS(20)));
  return f;
}

test("one frame reads each shared key once, however many rows and files ask", () => {
  const { tab } = realTab();
  host.readsByKey = {};
  tab.render(cx);
  assert.ok(Object.keys(host.readsByKey).length > 0, "the frame read shared state");
  for (const [key, n] of Object.entries(host.readsByKey)) assert.equal(n, 1, `${key} read ${n} times`);
  assert.equal(tab.notes().length, 20);
});

test("within a frame the memos hold; a write in it is seen at once; outside a frame reads are fresh", () => {
  const { tab } = realTab();
  store.inFrame(() => {
    const marks = tab.viewedMarks();
    assert.equal(tab.viewedMarks(), marks, "one Set of viewed marks per frame");
    const rows = tab.noteRows();
    assert.equal(tab.noteRows(), rows);
    store.editDrafts("o/r#1", (d) => { d.notes = []; });
    assert.equal(tab.notes().length, 0, "the frame sees its own write");
  });
  host.store.set("review.drafts", JSON.stringify(DRAFTS(3)));
  assert.equal(tab.notes().length, 3, "outside a frame: the newest value");
});

test("editDrafts writes nothing when nothing changed, and keeps the other reviews' entries", () => {
  realTab();
  const writes = host.writes;
  store.editDrafts("o/r#1", (d) => { d.type = "pr"; });
  assert.equal(host.writes, writes, "no change, no setShared (every mod would re-render)");
  store.editDrafts("o/r#1", (d) => { d.viewed.push("new.js@z"); });
  assert.equal(host.writes, writes + 1);
  const all = JSON.parse(host.store.get("review.drafts"));
  assert.deepEqual(all["o/r#2"].viewed, ["a@b"]);
  assert.ok(all["o/r#1"].at > 0);
});

test("old drafts without notes are pruned; ones with notes stay", () => {
  realTab();
  const old = Date.now() - 40 * 86_400_000;
  host.store.set("review.drafts", JSON.stringify({ gone: { viewed: ["a@b"], at: old }, kept: { notes: [{ id: "n", path: "a", side: "RIGHT", line: 1, body: "x" }], viewed: [], at: old } }));
  store.editDrafts("o/r#1", (d) => { d.type = "agent"; });
  assert.deepEqual(Object.keys(JSON.parse(host.store.get("review.drafts"))).sort(), ["kept", "o/r#1"]);
});

test("a cursor key redraws the diff column alone; a step key in the Agent panel also the diff and files", () => {
  const { tab, a } = realTab();
  tab.cols = { files: { name: "files" }, diff: { name: "diff" }, agent: { name: "agent" } };
  tab.focus = "diff"; a.focused = false;
  tab.render(cx);
  const root = drawn.get("review-tab");
  const press = (key) => { cx.notified = []; root.handlers.key({ key, modifiers: {} }, cx); return cx.notified.map((x) => x.name).sort(); };
  tab.cursor = tab.where.get("new.js|LEFT|8");
  assert.deepEqual(press("j"), ["diff"]);
  tab.focus = "agent"; a.focused = true;
  assert.deepEqual(press("j"), ["agent", "diff", "files"]);
  assert.deepEqual(press("l"), ["agent"], "an excerpt focus is the panel's alone");
});

test("a click in the diff does not redraw the Agent panel or the file list", () => {
  const { tab, a } = realTab();
  tab.cols = { files: { name: "files" }, diff: { name: "diff" }, agent: { name: "agent" } };
  tab.focus = "diff"; a.focused = false;
  cx.notified = [];
  tab.down(tab.where.get("new.js|RIGHT|9"), { modifiers: {}, click_count: 1 }, cx);
  tab.render(cx);
  drawn.get("review-tab").handlers.down({}, cx);
  assert.deepEqual(cx.notified.map((x) => x.name), ["diff"]);
});

test("the excerpt jump changes nothing in the display when its file is open", () => {
  const { tab, a } = realTab();
  const v = tab.version;
  a.navigate({ path: "new.js", side: "RIGHT", start_line: 8, line: 9 }, cx);
  assert.equal(tab.version, v, "no fold changed: no display rebuild");
  tab.folds.set("new.js", true);
  a.navigate({ path: "new.js", side: "RIGHT", start_line: 8, line: 9 }, cx);
  assert.equal(tab.version, v + 1);
});
