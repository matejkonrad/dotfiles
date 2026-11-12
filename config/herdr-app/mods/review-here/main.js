// "Review this space" in the ⌘⇧P palette: an invisible overlay that runs `review.here` (the review mod opens the
// space's PR or local review, or goes back) and closes itself. Installed by install-review.mjs.
import { View, div } from "gpui-kit";
import { closeOverlay, props, run } from "herdr";

export default class ReviewHere extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      try { run("review.here"); } catch (e) { console.error(`review-here: ${e?.message ?? e}`); }
      await cx.sleep(50);
      try { closeOverlay(props()?.overlay); } catch { /* closed */ }
    });
  }

  render() { return div(); }
}
