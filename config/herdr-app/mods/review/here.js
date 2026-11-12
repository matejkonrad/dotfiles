// `review.here` (⌘R, the panel's Review button, "Review this space" in the palette): the review of the shown space.
//   A review tab of this space is focused: back to the tab before it (a toggle).
//   A review tab of this space exists: select it.
//   Else a new review tab, made at once: it finds out itself whether it is the branch's PR or the local changes.
// Everything here is synchronous: no git, gh or file call before the tab switches.
// Every shown copy gets the command (the panel, the launcher if the layout has one): a shared stamp lets only the
// first act, and the window is short enough that a quick second press still counts.
import { focused, panes, run, setShared, shared, spaces } from "herdr";
import { whereOf } from "./store.js";

const STAMP = "review.here.at";
const BACK = "review.back"; // {spaceId: the tab to go back to}
export const BRANCH_PRS = "review.branchPrs"; // {spaceId: {sig, pr}}: the open PR of the space's checkout (the panel's poll)
// The copies get one command within a few ms of each other; a person can't press twice that fast.
export const SAME_COMMAND_MS = 120;

/** True for the first copy that handles this command; the other copies leave it alone. */
export function claim(now = Date.now()) {
  const last = shared(STAMP);
  if (typeof last === "number" && now - last >= 0 && now - last < SAME_COMMAND_MS) return false;
  setShared(STAMP, now);
  return true;
}

// `review.focus` (⌘⌥G) reaches every copy, pane.go's "focus" only its target. The panel stamps the time it took
// the keyboard; a review tab that gets "focus" within the same window leaves it with the panel.
const PANEL_FOCUS = "review.panelFocus.at";
export function markPanelFocus(now = Date.now()) { setShared(PANEL_FOCUS, now); }
export function panelJustFocused(now = Date.now()) {
  const at = shared(PANEL_FOCUS);
  return typeof at === "number" && now - at >= 0 && now - at < SAME_COMMAND_MS;
}

/** The space's tabs that show a review tab (not the panel). */
export function reviewTabsOf(space) {
  const withReview = new Set(panes().filter((p) => p.mod === "review" && p.tab).map((p) => p.tab));
  return (space?.tabs ?? []).filter((t) => withReview.has(t.id));
}

/** Whether the focused tab is a review tab of the shown space (the button then reads "Back"). */
export function reviewFocused() {
  const space = spaces().find((s) => s.active);
  const f = focused();
  return Boolean(space && f?.tab && reviewTabsOf(space).some((t) => t.id === f.tab));
}

/**
 * The branch's PR from what the panel already knows (its last poll in "review.branchPrs": per space, the PR of
 * the repo and branch it found there), as a hint for the new tab. Never waited for: without a hint the tab
 * finds out itself. A branch name alone is not enough: two repos can both have a branch "fix".
 */
export function prHint(space) {
  const where = whereOf(space);
  if (!where?.branch) return null;
  const known = (shared(BRANCH_PRS) ?? {})[space.id];
  return known && known.sig === where.sig && known.pr ? known.pr : null;
}

/** The whole command, synchronous: back, select, or a new tab. Returns what it did (for tests and timing). */
export function reviewHere() {
  const space = spaces().find((s) => s.active);
  if (!space) return "none";
  const here = focused()?.tab ?? null;
  const mine = reviewTabsOf(space);
  const isReview = (id) => mine.some((t) => t.id === id);
  if (here && isReview(here)) {
    const back = (shared(BACK) ?? {})[space.id];
    const to = space.tabs.find((t) => t.id === back && !isReview(t.id)) ?? space.tabs.find((t) => !isReview(t.id));
    if (to) run("tab.select", { id: to.id });
    return "back";
  }
  setShared(BACK, { ...(shared(BACK) ?? {}), [space.id]: here });
  if (mine.length) { run("tab.select", { id: mine[0].id }); return "select"; }
  const hint = prHint(space);
  run("tab.new", { space: space.id, name: "review", mod: "review",
    props: { view: "review", space: space.id, smart: true, ...(hint ? { pr: hint } : { local: true }) } });
  return "open";
}

/** A command or a click: once across copies, never a throw. */
export function runHere() {
  if (!claim()) return null;
  try { return reviewHere(); } catch (e) { console.error(`review.here: ${e?.stack ?? e}`); return "error"; }
}
