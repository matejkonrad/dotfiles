// review: tracked PRs and code review. One mod, three views:
//   the panel (layout block, no props): the space's tracked PRs, Mine and Requests (panel.js);
//   the review tab (props.view === "review"): a PR's or the local branch's diff with notes and the Agent panel (tab.js, agent.js);
//   the launcher (props.view === "launcher"): a small "Review ⌘R" button in a floating block (launcher.js).
// Commands (`herdr-app do 'review.<name>:<json>'`): track, untrack, open (the panel handles them),
// here (the launcher or the panel: here.js), toggle, focus, refresh, dryrun; key:<k>, note:<text>,
// goto:<path>:<line>, scope:<json> (the review tab); debug.
import { View, div } from "gpui-kit";
import { appHome, nextCommand, props, theme } from "herdr";
import * as fs from "fs/promises";
import { Panel } from "./panel.js";
import { ReviewTab } from "./tab.js";
import { Launcher } from "./launcher.js";
import { asError } from "./errors.mjs";
import { inFrame } from "./store.js";

export default class Review extends View {
  init(_props, cx) {
    // init never throws: a throw here (even a host call failing with null) stops a hot reload, and the old
    // build keeps running. The copy shows the error instead and reports it.
    try {
      const p = props() ?? {};
      this.impl = p.view === "review" ? new ReviewTab(this, cx) : p.view === "launcher" ? new Launcher(this, cx) : new Panel(this, cx);
    } catch (e) {
      this.impl = null;
      this.initError = asError(e, "start");
      this.report("init", this.initError, cx);
    }
    cx.spawn(async (cx) => {
      for (;;) {
        let command;
        // After a reload the old build's loop ends here (the host may reject with null).
        try { command = await nextCommand(); } catch { return; }
        try {
          if (command === "debug") this.report("debug", null, cx);
          else this.impl?.command(command, cx);
        } catch (e) {
          this.report(`command:${String(command).split(":")[0]}`, e, cx);
        }
        try { cx.notify(); } catch { return; }
      }
    });
  }

  render(cx) {
    if (!this.impl) {
      const t = theme();
      return div().size_full().p(12).bg(t.background).text_size(12).text_color(t.muted).child(`Review couldn't start: ${this.initError?.message ?? "unknown error"}`);
    }
    try { return inFrame(() => this.impl.render(cx)); }
    catch (e) { const err = asError(e, "render"); this.report("render", err, cx); throw err; }
  }

  /** The tab goes (or the app quits): a running agent request is cancelled. */
  async close(cx) {
    try { await this.impl?.close?.(cx); } catch (e) { console.error(`review close: ${asError(e, "close").message}`); }
  }

  /**
   * An error (or `review.debug`) as a small JSON file under data/review-debug: the stack, the phase and
   * counts. Never code, comments, conversations or agent output.
   */
  report(phase, error, cx) {
    try {
      const v = this.impl;
      const failed = phase !== "debug";
      const stack = failed ? String(error?.stack ?? error ?? "Native runtime threw null") : null;
      if (stack && stack === this.lastReportedStack) return;
      if (stack) this.lastReportedStack = stack;
      const record = { at: new Date().toISOString(), phase, stack,
        message: failed ? String(error?.message ?? error ?? "").split("\n")[0].slice(0, 200) : null,
        review: v?.dkey ?? null, tab: v?.myTab ?? null,
        state: { loading: v?.loading, rows: v?.rows?.length, files: v?.files?.length, display: v?.display?.length,
          measuredRows: v?.scroll?.sizes?.length ?? null, cursor: v?.cursor, version: v?.version,
          renderPhase: v?.renderPhase, loadPhase: v?.loadPhase, scope: v?.scopeKey?.() ?? null,
          agent: v?.agent ? { tab: v.agent.tab === "walk" ? "walk" : "thread", focus: v.focus, typing: v.agent.typing,
            running: v.agent.running?.action ?? null, step: v.agent.step, versions: v.agent.record?.versions?.length ?? 0, threads: v.agent.record?.threads?.length ?? 0 } : null } };
      if (stack) console.error(`review ${phase}: ${stack}`);
      const file = `${appHome()}/data/review-debug/${encodeURIComponent(v?.myTab ?? v?.dkey ?? (v ? "panel" : "init"))}-${failed ? "error" : "state"}.json`;
      cx.spawn(async () => {
        try { await fs.mkdir(`${appHome()}/data/review-debug`, { recursive: true }); await fs.writeFile(file, JSON.stringify(record, null, 2)); }
        catch (e) { console.error(`review diagnostics: ${e?.stack ?? e}`); }
      });
    } catch (e) { console.error(`review report: ${e?.stack ?? e}`); }
  }
}
