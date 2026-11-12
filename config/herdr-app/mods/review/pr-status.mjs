// What a PR row says, with no UI or herdr dependencies: one status phrase that names the next step, its tone,
// the group it sorts into, and at most two signals. The panel's Space and Inbox tabs both use it.
//
// Facts (`prFacts` builds them from a tracked PR's status or an Inbox row):
//   {state: "OPEN" | "MERGED" | "CLOSED", draft, mine, requested, team, reviewedBefore, failing (count, or true when
//    only the rollup says so), pending, decision, conflicts, mergeClean, unread, openThreads, outside, updatedAt,
//    checksAt}
// Tones are theme roles, not colors: fail (ansi1), warn (ansi3), ok (ansi2), fg (foreground), muted, dim.

export const GROUPS = ["turn", "waiting", "drafts", "done"];
// Pending checks this long after their start count as stuck: nothing will change by itself.
export const STUCK_MS = 2 * 3_600_000;
// A waiting PR with no activity for this long sinks to the end of its group.
export const OLD_MS = 30 * 86_400_000;

/** A tracked PR's status (gh.toStatus) as facts. Tracked PRs follow the "mine" rules: they are watched. */
export function trackedFacts(pr) {
  return {
    state: pr.state, draft: Boolean(pr.isDraft), mine: true, requested: false, team: false, reviewedBefore: false,
    failing: pr.checks?.failed?.length ?? 0, pending: (pr.checks?.pending ?? 0) > 0, decision: pr.reviewDecision ?? "",
    conflicts: pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY", mergeClean: ["CLEAN", "HAS_HOOKS"].includes(pr.mergeState),
    unread: pr.newComments ?? 0, openThreads: pr.unresolved ?? 0, outside: 0,
    updatedAt: pr.updatedAt ?? null, checksAt: pr.checksAt ?? pr.updatedAt ?? null, error: pr.error && !pr.title ? pr.error : null,
  };
}

/** An Inbox row (gh.fetchLists) as facts. */
export function inboxFacts(row, { unread = false } = {}) {
  const ci = row.ci ?? "";
  return {
    state: "OPEN", draft: Boolean(row.isDraft), mine: row.kind === "mine", requested: row.kind === "request", team: Boolean(row.team),
    reviewedBefore: Boolean(row.reviewedByMe), failing: ci === "failure" || ci === "error", pending: ci === "pending" || ci === "expected",
    decision: row.reviewDecision ?? "", conflicts: row.mergeable === "CONFLICTING" || row.mergeState === "DIRTY",
    mergeClean: ["CLEAN", "HAS_HOOKS"].includes(row.mergeState), unread: Boolean(unread), openThreads: row.openThreads ?? 0, outside: 0,
    updatedAt: row.updatedAt ?? null, checksAt: row.committedDate ?? row.updatedAt ?? null, error: null,
  };
}

const failText = (n) => (n === true || !Number.isFinite(n) ? "✗ Checks failing" : `✗ ${n} check${n === 1 ? "" : "s"} failing`);
const ms = (iso) => (iso ? Date.parse(iso) : NaN);

/**
 * The row's status: {phrase, tone, group, rank, spin, signals: [{text, tone}]}. The first rule that matches wins
 * (the order is the priority). Green ("ok") is only "Ready to merge"; red ("fail") only failing checks and
 * changes requested.
 */
export function prStatus(f, now = Date.now()) {
  const signals = [];
  const s = (phrase, tone, group, rank, extra = {}) => ({ phrase, tone, group, rank, spin: false, signals, ...extra });
  if (f.error) return s(`✗ Could not read: ${f.error}`, "muted", "waiting", 90);
  if (f.state === "MERGED") return s("Merged", "dim", "done", 100);
  if (f.state === "CLOSED") return s("Closed", "dim", "done", 100);
  if (f.draft) {
    // Failing CI is a fact for the author, kept small: the draft itself stays dim.
    if (f.failing) signals.push({ text: f.failing === true ? "✗" : `✗ ${f.failing}`, tone: "fail" });
    return s("Draft", "dim", "drafts", 80);
  }
  if (f.openThreads && f.mine) signals.push({ text: `${f.openThreads} open`, tone: "muted" });
  if (f.outside) signals.push({ text: "outside", tone: "warn" });
  if (f.requested) {
    const team = f.team ? " (team)" : "";
    return s(f.reviewedBefore ? `Re-review requested${team}` : `Review requested${team}`, "fg", "turn", f.team ? 6 : 5);
  }
  if (f.mine) {
    if (f.failing) return s(failText(f.failing), "fail", "turn", 1);
    if (f.decision === "CHANGES_REQUESTED") return s("Changes requested", "fail", "turn", 2);
    if (f.conflicts) return s("Merge conflicts", "warn", "turn", 3);
    if (f.unread) return s(f.unread === true ? "New comments" : `${f.unread} new comment${f.unread === 1 ? "" : "s"}`, "fg", "turn", 4);
    if (f.decision !== "REVIEW_REQUIRED" && f.decision !== "CHANGES_REQUESTED" && !f.pending && f.mergeClean) return s("Ready to merge", "ok", "turn", 7);
    if (f.pending) {
      const stuck = now - ms(f.checksAt) >= STUCK_MS;
      return stuck ? s("Checks stuck", "dim", "waiting", 20) : s("Checks running", "muted", "waiting", 20, { spin: true });
    }
    if (f.decision === "APPROVED") return s("Approved", "muted", "waiting", 21);
    return s("Waiting for review", "dim", "waiting", 22);
  }
  return s("Waiting on author", "dim", "waiting", 23);
}

/**
 * Rows in groups, each sorted: Your turn by rank then newest (review requests oldest first: the longer one
 * waits, the more urgent); Waiting and Drafts newest first, with PRs quiet for OLD_MS at the end of Waiting.
 * rows: [{key, status, updatedAt}]. Returns {turn: [...], waiting: [...], drafts: [...], done: [...]}.
 */
export function groupRows(rows, now = Date.now()) {
  const out = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const r of rows) out[r.status.group]?.push(r);
  const time = (r) => ms(r.updatedAt) || 0;
  const newest = (a, b) => time(b) - time(a);
  out.turn.sort((a, b) => a.status.rank - b.status.rank || (a.status.rank === 5 || a.status.rank === 6 ? time(a) - time(b) : newest(a, b)));
  const old = (r) => now - time(r) > OLD_MS;
  out.waiting.sort((a, b) => Number(old(a)) - Number(old(b)) || newest(a, b));
  out.drafts.sort(newest);
  out.done.sort(newest);
  return out;
}

/** Inbox rows from the three searches: a PR that is mine and also requested of me shows once, as mine. */
export function mergeInbox({ mine = [], requests = [], team = [] }) {
  const seen = new Set(), out = [];
  const add = (row, kind, isTeam = false) => {
    const key = `${row.repo}#${row.number}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...row, kind, team: isTeam });
  };
  for (const r of mine) add(r, "mine");
  for (const r of requests) add(r, "request");
  for (const r of team) add(r, "request", true);
  return out;
}

/** The Inbox's count: the rows where it is your turn. */
export const turnCount = (groups) => groups.turn.length;
