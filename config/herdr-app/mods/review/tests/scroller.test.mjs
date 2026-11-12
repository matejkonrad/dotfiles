import test from "node:test";
import assert from "node:assert/strict";
import "./host.mjs";

const { Scroller } = await import("../scroller.js");
const { ReviewTab } = await import("../tab.js");

test("unmeasured and restored scrollers are safe before the first measurement", () => {
  const s = new Scroller("test");
  assert.equal(s.indexAt(0), -1);
  s.apply({ i: 0 });
  s.sizes = null; // old live instance during a hot reload
  assert.equal(s.indexAt(0), -1);
  s.apply({ i: 0 });
  s.measure([20, 30]);
  assert.equal(s.indexAt(0), 0);
  assert.equal(s.indexAt(20), 1);
  assert.equal(s.indexAt(50), -1);
});

test("a failed display measurement can recover on the next render", async () => {
  const tab = Object.create(ReviewTab.prototype);
  Object.assign(tab, { agent: { chips: () => [], chipsSig: () => "" }, version: 1, width: 100, openThreads: new Set(), pending: null,
    rows: [{ k: "file", f: 0 }], files: [{ path: "x" }], meta: { threads: [] }, notes: () => [], split: () => false,
    folded: () => false, scroll: new Scroller("test") });
  let fail = true;
  const measure = tab.scroll.measure.bind(tab.scroll);
  tab.scroll.measure = (sizes) => { if (fail) throw new Error("measurement failed"); measure(sizes); };
  assert.throws(() => tab.buildDisplay(), /measurement failed/);
  fail = false;
  tab.buildDisplay();
  assert.equal(tab.scroll.sizes.length, tab.display.length);
  tab.scroll.sizes = null;
  tab.buildDisplay();
  assert.equal(tab.scroll.sizes.length, 1);
});

test("large diffs evaluate expensive file folding once per file", async () => {
  const tab = Object.create(ReviewTab.prototype);
  let evaluations = 0;
  const files = Array.from({ length: 24 }, (_, i) => ({ path: `${i}.js` }));
  const rows = files.flatMap((_, f) => Array.from({ length: 180 }, () => ({ k: "add", f })));
  Object.assign(tab, { agent: { chips: () => [], chipsSig: () => "" }, version: 1, width: 100, openThreads: new Set(), pending: null, files, rows,
    meta: { threads: [] }, notes: () => [], split: () => false, folded: () => { evaluations++; return false; },
    scroll: new Scroller("test"), sizeOf: () => 20 });
  tab.buildDisplay();
  assert.equal(evaluations, files.length);
  assert.equal(tab.display.length, rows.length);
});

test("plain display can switch to inline drafts/composer and back in both diff modes", async () => {
  for (const split of [false, true]) {
    const tab = Object.create(ReviewTab.prototype);
    let notes = [];
    const rows = [{ k: "file", f: 0 }, { k: "del", f: 0, o: 1, n: null }, { k: "add", f: 0, o: null, n: 1 }];
    Object.assign(tab, { agent: { chips: () => [], chipsSig: () => "" }, version: 1, width: 100, openThreads: new Set(), pending: null,
      files: [{ path: "x" }], rows, fileStart: [0], where: new Map([["x|RIGHT|1", 2]]),
      meta: { threads: [] }, notes: () => notes, split: () => split, folded: () => false,
      scroll: new Scroller("test") });
    tab.buildDisplay();
    assert.equal(tab.display.length, split ? 2 : 3);
    notes = [{ id: "draft", path: "x", side: "RIGHT", line: 1, body: "Please check this" }];
    tab.pending = { after: 2, edit: null };
    tab.buildDisplay();
    assert.ok(tab.display.some((d) => d.note?.id === "draft"));
    assert.ok(tab.display.some((d) => d.composer));
    assert.equal(tab.scroll.sizes.length, tab.display.length);
    assert.equal(tab.stops.length, split ? 2 : 3);
    notes = []; tab.pending = null;
    tab.buildDisplay();
    assert.equal(tab.display.length, split ? 2 : 3);
    assert.equal(tab.stopAt.get(split ? 1 : 2), split ? 1 : 2);
  }
});
