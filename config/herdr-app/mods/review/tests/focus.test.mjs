// Keyboard hand-off between the PR panel and a review tab: pane.go's "focus" and ⌘⌥G's `review.focus`.
import test from "node:test";
import assert from "node:assert/strict";
import { host, cx } from "./host.mjs";
import { fixture } from "./tab-fixture.mjs";

const { Panel } = await import("../panel.js");

// A review tab opened by `review.here`: named "review", not registered, and not focused when its copy started.
function smartTab() {
  const { tab, focused } = fixture();
  host.spaces = [{ id: "s1", name: "work", active: true, tabs: [{ id: "t1", name: "1" }, { id: "t2", name: "review" }] }];
  host.panes = [{ pane: "p1", tab: "t1", mod: null }, { pane: "p2", tab: "t2", mod: "review" }];
  Object.assign(tab, { local: true, dkey: "local:s1", who: { local: true, pr: null, space: "s1" }, myTab: null, refreshIfMoved() {} });
  host.focused = { tab: "t2", pane: "p2" };
  return { tab, focused };
}

test("pane.go into a review tab nobody registered yet gives it the keyboard", () => {
  const { tab, focused } = smartTab();
  tab.command("focus", cx);
  assert.equal(focused(), 1, "the tab took the keyboard");
  assert.equal(tab.myTab, "t2", "the focused unclaimed review tab is this copy's");
  assert.deepEqual(JSON.parse(host.store.get("review.tabs")).t2, { pr: null, local: true, space: "s1" });
});

test("⌘⌥G (review.focus reaches every copy): the panel keeps the keyboard, the tab does not take it back", () => {
  const { tab, focused } = smartTab();
  host.store.set("review", JSON.stringify({ migrated: null, spaces: {}, seen: {}, tab: "space" }));
  const panel = new Panel({}, cx);
  let panelFocused = 0;
  panel.handle = { focus() { panelFocused++; }, is_focused: () => false };
  panel.command("focus", cx);
  tab.command("focus", cx);
  assert.equal(panelFocused, 1);
  assert.equal(focused(), 0, "the tab left the keyboard with the panel");
});

test("a later pane.go back into the tab takes the keyboard again", () => {
  const { tab, focused } = smartTab();
  host.store.set("review.panelFocus.at", JSON.stringify(Date.now() - 5_000));
  tab.command("focus", cx);
  assert.equal(focused(), 1);
});

test("a review tab that is not the focused pane leaves the keyboard alone", () => {
  const { tab, focused } = smartTab();
  host.focused = { tab: "t1", pane: "p1" };
  tab.command("focus", cx);
  assert.equal(focused(), 0);
  assert.equal(tab.myTab, null, "an unfocused tab is never claimed");
});
