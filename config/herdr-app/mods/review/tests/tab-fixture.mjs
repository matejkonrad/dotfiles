// A review tab (PR, one renamed file) with its Agent panel and a two-step walkthrough, built without the host:
// the constructor needs a window, so the fields it sets are set here.
import { reset, host, textarea } from "./host.mjs";

export const { AgentPanel } = await import("../agent.js");
export const { ReviewTab } = await import("../tab.js");
/** The "review" store (shared state), as a test sets it. */
export const setStore = (patch) => host.store.set("review", JSON.stringify({ ...JSON.parse(host.store.get("review") ?? "{}"), ...patch }));

export const FILE = { path: "new.js", previous: "old.js", status: "renamed", rows: [{ k: "hunk", text: "@@" }, { k: "del", o: 8, n: null, text: "old" }, { k: "add", o: null, n: 8, text: "new" }, { k: "ctx", o: 9, n: 9, text: "same" }] };

export function fixture() {
  reset();
  setStore({ agentProviderOverride: "claude" });
  const tab = Object.create(ReviewTab.prototype);
  let focused = 0;
  Object.assign(tab, { handle: { focus() { focused++; }, is_focused: () => true }, pending: null, modal: null, version: 0, folds: new Map(), closedDirs: new Set(),
    openThreads: new Set(), meta: { sha: "a", baseSha: "b", threads: [] }, local: false, name: "repo#1", dkey: "o/r#1", p: { space: "s1", pr: "o/r#1" }, who: { local: false, pr: "o/r#1", space: "s1" }, width: 1600, focus: "diff",
    composer: textarea(), summary: textarea(), scroll: { height: 400, reveal() {}, measure() {} }, fileScroll: { reveal() {}, measure() {} },
    type: () => "pr", notes: () => [], fresh: () => [], say(text) { this.flash = text; }, load: async () => {} });
  tab.rows = []; tab.files = [];
  tab.setFiles([JSON.parse(JSON.stringify(FILE))]);
  tab.agent = new AgentPanel(tab);
  tab.agent.installed = ["claude"];
  tab.agent.snapshot();
  const step = (title, ref) => ({ title, blocks: [{ type: "text", md: "Why" }, { type: "code", ref }] });
  tab.agent.record = { v: 2, at: 1, current: "v1", threads: [], versions: [{ id: "v1", at: 1, comparisonKey: tab.agent.comparisonKey, walkthrough: { summary: "Change",
    steps: [step("One", { path: "new.js", side: "LEFT", start_line: 8, line: 8 }), step("Two", { path: "new.js", side: "RIGHT", start_line: 8, line: 9 })] } }] };
  tab.agent.focused = true; tab.focus = "agent";
  const calls = [];
  tab.agent.request = (job) => calls.push(job);
  return { tab, a: tab.agent, calls, focused: () => focused };
}
