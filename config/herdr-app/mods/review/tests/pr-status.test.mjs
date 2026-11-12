// The PR panel's status phrase: one per row, picked by priority, with color only where it means a state.
import test from "node:test";
import assert from "node:assert/strict";
import { prStatus, trackedFacts, inboxFacts, groupRows, mergeInbox, STUCK_MS } from "../pr-status.mjs";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const pr = (extra = {}) => ({ state: "OPEN", isDraft: false, reviewDecision: "", mergeState: "CLEAN", mergeable: "MERGEABLE", newComments: 0, unresolved: 0,
  checks: { passed: 3, pending: 0, failed: [] }, updatedAt: ago(60_000), title: "T", ...extra });
const status = (extra) => prStatus(trackedFacts(pr(extra)), NOW);

test("a draft is dim, never green, whatever its checks; failing checks stay a small red signal", () => {
  const passing = status({ isDraft: true });
  assert.deepEqual([passing.phrase, passing.tone, passing.group], ["Draft", "dim", "drafts"]);
  const failing = status({ isDraft: true, checks: { passed: 0, pending: 0, failed: [{ name: "lint" }] } });
  assert.equal(failing.tone, "dim");
  assert.deepEqual(failing.signals, [{ text: "✗ 1", tone: "fail" }]);
});

test("green is only Ready to merge; red only failing checks and changes requested", () => {
  const cases = [
    [{}, "Ready to merge", "ok", "turn"],
    [{ reviewDecision: "APPROVED" }, "Ready to merge", "ok", "turn"],
    [{ checks: { passed: 1, pending: 0, failed: [{}, {}] } }, "✗ 2 checks failing", "fail", "turn"],
    [{ reviewDecision: "CHANGES_REQUESTED" }, "Changes requested", "fail", "turn"],
    [{ mergeable: "CONFLICTING", mergeState: "DIRTY" }, "Merge conflicts", "warn", "turn"],
    [{ newComments: 2 }, "2 new comments", "fg", "turn"],
    [{ reviewDecision: "REVIEW_REQUIRED", mergeState: "BLOCKED" }, "Waiting for review", "dim", "waiting"],
    [{ reviewDecision: "APPROVED", mergeState: "BEHIND" }, "Approved", "muted", "waiting"],
    [{ checks: { passed: 1, pending: 2, failed: [] }, checksAt: ago(60_000) }, "Checks running", "muted", "waiting"],
    [{ checks: { passed: 1, pending: 2, failed: [] }, checksAt: ago(STUCK_MS + 1) }, "Checks stuck", "dim", "waiting"],
    [{ state: "MERGED" }, "Merged", "dim", "done"],
    [{ state: "CLOSED" }, "Closed", "dim", "done"],
  ];
  for (const [extra, phrase, tone, group] of cases) {
    const s = status(extra);
    assert.deepEqual([s.phrase, s.tone, s.group], [phrase, tone, group], JSON.stringify(extra));
  }
  for (const [extra] of cases) {
    const s = status(extra);
    if (s.tone === "ok") assert.equal(s.phrase, "Ready to merge");
    if (s.tone === "fail") assert.match(s.phrase, /failing|Changes requested/);
  }
});

test("the first matching rule wins: failing checks over changes requested over conflicts over comments", () => {
  const all = { checks: { passed: 0, pending: 0, failed: [{}] }, reviewDecision: "CHANGES_REQUESTED", mergeState: "DIRTY", newComments: 3 };
  assert.equal(status(all).phrase, "✗ 1 check failing");
  assert.equal(status({ ...all, checks: { passed: 1, pending: 0, failed: [] } }).phrase, "Changes requested");
  assert.equal(status({ ...all, checks: { passed: 1, pending: 0, failed: [] }, reviewDecision: "" }).phrase, "Merge conflicts");
  assert.equal(status({ newComments: 3, checks: { passed: 0, pending: 1, failed: [] } }).phrase, "3 new comments");
  assert.equal(status({ unresolved: 3, reviewDecision: "CHANGES_REQUESTED" }).signals[0].text, "3 open");
});

test("Inbox: requests are your turn, a review already given asks again, team requests come after direct ones", () => {
  const row = (extra) => ({ repo: "o/r", number: 1, updatedAt: ago(1000), ci: "success", mergeState: "BLOCKED", reviewDecision: "REVIEW_REQUIRED", ...extra });
  const rows = mergeInbox({ mine: [row({ number: 1 })], requests: [row({ number: 1 }), row({ number: 2, reviewedByMe: true }), row({ number: 3, updatedAt: ago(9e6) })], team: [row({ number: 4 })] });
  assert.deepEqual(rows.map((r) => [r.number, r.kind]), [[1, "mine"], [2, "request"], [3, "request"], [4, "request"]], "mine wins over a request of the same PR");
  const groups = groupRows(rows.map((r) => ({ key: r.number, updatedAt: r.updatedAt, status: prStatus(inboxFacts(r), NOW) })), NOW);
  assert.deepEqual(groups.turn.map((r) => [r.key, r.status.phrase]), [[3, "Review requested"], [2, "Re-review requested"], [4, "Review requested (team)"]],
    "the oldest request first; team last");
  assert.deepEqual(groups.waiting.map((r) => r.status.phrase), ["Waiting for review"]);
  assert.equal(prStatus(inboxFacts(row({ isDraft: true, ci: "success" })), NOW).tone, "dim", "a draft with passing CI is not green");
  assert.equal(prStatus(inboxFacts(row({ ci: "failure", kind: "mine" })), NOW).phrase, "✗ Checks failing");
});

test("Your turn sorts by urgency, Waiting newest first with quiet PRs last", () => {
  const r = (key, extra, updatedAt) => ({ key, updatedAt, status: status(extra) });
  const g = groupRows([r("ready", {}, ago(10)), r("fail", { checks: { passed: 0, pending: 0, failed: [{}] } }, ago(1e7)), r("old", { reviewDecision: "REVIEW_REQUIRED" }, ago(40 * 86_400_000)),
    r("new", { reviewDecision: "REVIEW_REQUIRED" }, ago(5))], NOW);
  assert.deepEqual(g.turn.map((x) => x.key), ["fail", "ready"]);
  assert.deepEqual(g.waiting.map((x) => x.key), ["new", "old"]);
});
