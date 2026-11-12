// The PR panel: old tab names still work, the Inbox groups by what must happen next, rows never move under
// the pointer, and one click opens a review.
import test from "node:test";
import assert from "node:assert/strict";
import { host, reset, cx, drawn } from "./host.mjs";

const { Panel } = await import("../panel.js");
const H = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const row = (n, extra = {}) => ({ repo: "o/r", number: n, title: `PR ${n}`, url: `https://github.com/o/r/pull/${n}`, updatedAt: H(n), isDraft: false,
  reviewDecision: "REVIEW_REQUIRED", mergeState: "BLOCKED", mergeable: "MERGEABLE", ci: "success", reviews: [], openThreads: 0, ...extra });

function panel() {
  reset();
  host.store.set("review", JSON.stringify({ migrated: null, spaces: {}, seen: {}, tab: "space" }));
  host.spaces = [{ id: "s1", name: "work", active: true, tabs: [] }];
  const p = new Panel({}, cx);
  p.lists = { viewer: "me", at: Date.now(), error: null, loading: false, mine: [row(1, { ci: "failure" }), row(2), row(3, { isDraft: true })], requests: [row(4)], team: [] };
  p.inboxCache = null;
  p.handle = { focus() {}, is_focused: () => false };
  return p;
}
const tabOf = () => JSON.parse(host.store.get("review")).tab;

test("review.tab:mine and review.tab:requests open the Inbox; tracked opens Space", () => {
  const p = panel();
  for (const [arg, want] of [["mine", "inbox"], ["requests", "inbox"], ["tracked", "space"], ["inbox", "inbox"]]) {
    p.command(`tab:${arg}`, cx);
    assert.equal(p.tab(), want, arg);
  }
  assert.equal(tabOf(), "inbox");
});

test("the Inbox groups by action and counts only your turn; drafts start folded", () => {
  const p = panel();
  p.setTab("inbox", cx);
  const { groups } = p.inbox();
  assert.deepEqual(groups.turn.map((r) => r.row.number), [1, 4]);
  assert.deepEqual(groups.waiting.map((r) => r.row.number), [2]);
  assert.deepEqual(groups.drafts.map((r) => r.row.number), [3]);
  assert.deepEqual(p.rows(host.spaces[0]), ["o/r#1", "o/r#4", "o/r#2"], "j/k skip the folded drafts");
});

test("while the pointer is over the panel, a refresh changes rows in place and moves none", () => {
  const p = panel();
  p.setTab("inbox", cx);
  p.inbox();
  p.pointerIn = true;
  p.lists = { ...p.lists, at: Date.now() + 1, mine: [row(1), row(2, { ci: "failure" }), row(3, { isDraft: true })] };
  const frozen = p.inbox().groups;
  assert.deepEqual(frozen.turn.map((r) => r.row.number), [1, 4], "row 1 stays where it was");
  assert.equal(frozen.turn[0].status.phrase, "Waiting for review", "with its new phrase");
  assert.deepEqual(frozen.waiting.map((r) => r.row.number), [2]);
  p.pointerIn = false;
  assert.deepEqual(p.inbox().groups.turn.map((r) => r.row.number), [2, 4], "it sorts once the pointer leaves");
});

test("one click on an Inbox row opens its review; ⌥-click expands it", () => {
  const p = panel();
  p.setTab("inbox", cx);
  const opened = [];
  p.openSmart = (key) => opened.push(key);
  drawn.clear();
  p.render(cx);
  const el = drawn.get("row-o/r#4");
  assert.ok(el, "the row is drawn");
  el.handlers.click({ modifiers: {} }, cx);
  assert.deepEqual(opened, ["o/r#4"]);
  el.handlers.click({ modifiers: { alt: true } }, cx);
  assert.equal(p.expanded, "o/r#4");
  assert.ok(JSON.parse(host.store.get("review")).inboxSeen["o/r#4"], "opening marks it seen");
});
