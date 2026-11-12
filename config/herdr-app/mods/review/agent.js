// The Agent panel beside the diff: a Walkthrough tab (a narrative with real code excerpts, in versions) and one
// tab per thread (questions about the PR, tied to lines, a step or the whole PR). Agents run only when asked
// (agent-runner.mjs), read-only, each thread in its own agent session. The class is split by topic over the
// files mixed in at the end.
import { TextareaState } from "gpui-base";
import * as fs from "fs/promises";
import { mixin } from "./util.mjs";
import { Scroller } from "./scroller.js";
import { edit, store } from "./store.js";
import { AgentRecord, upgrade } from "./agent-record.js";
import { AgentRequests } from "./agent-request.js";
import { AgentThreads } from "./agent-threads.js";
import { AgentKeys } from "./agent-keys.js";
import { Excerpts } from "./excerpt.js";
import { AgentView } from "./agent-view.js";

let swept = false;

export class AgentPanel {
  constructor(owner) {
    this.owner = owner;
    this.focused = false;
    this.typing = false;
    this.tab = "walk"; // "walk" or a thread id
    this.step = 0;
    this.link = -1; // the focused excerpt of the selected step (-1: the step itself)
    this.entry = -1; // the focused answer of a thread
    this.record = null;
    this.recordText = null; // the file as last read or written: saves compare against it
    this.running = null; // {tab, action, startedAt, question}
    this.error = null;
    this.loaded = false;
    this.drafts = []; // threads made by i, saved with their first question
    this.heights = new Map();
    this.hover = null; // the hovered control's key (for Ask buttons and the diff gutter)
    this.lineSel = null; // lines picked inside an excerpt: {key, ref, nums: [line per shown item], a, b, dragging}
    this.lineCache = new Map(); // "rev|path" → the file's lines (context beyond a hunk), null while unknown
    this.lineWants = new Set();
    this.expanded = new Set(); // excerpts showing all their lines
    this.installed = null;
    this.models = {};
    this.scroll = new Scroller("agent-content", { pad: 8 });
    // Two inputs, so each says what it does: the walkthrough's asks about the PR, a thread's asks a follow-up.
    // Enter sends; Shift+Enter is a new line (the textarea's own behavior).
    this.walkInput = TextareaState.new({ placeholder: "Ask about this PR…   ↵ sends", rows: 1 });
    this.threadInput = TextareaState.new({ placeholder: "Ask a follow-up…   ↵ sends", rows: 1 });
    for (const input of [this.walkInput, this.threadInput]) {
      input.set_auto_grow(1, 5);
      input.on("focus", (_e, cx) => { this.typing = true; this.focused = true; this.owner.focus = "agent"; this.redraw(cx); });
      input.on("blur", (_e, cx) => { this.typing = false; this.redraw(cx); });
      input.on("submit", (_e, cx) => this.send(cx));
    }
    this.rename = TextareaState.new({ placeholder: "Thread title", rows: 1 });
    this.rename.on("submit", (_e, cx) => this.finishRename(cx));
    this.rename.on("blur", (_e, cx) => { if (this.renaming) this.finishRename(cx); });
    if (!swept) { swept = true; this.sweep(); }
  }

  get input() { return this.tab === "walk" ? this.walkInput : this.threadInput; }

  /** Redraws this panel (and the tab's chrome); `withDiff`: the diff too, for what its gutter and chips show. */
  redraw(cx, withDiff = false) { this.owner.redraw(cx, withDiff ? ["agent", "diff", "files"] : ["agent"]); }

  static upgrade(saved) { return upgrade(saved); }

  folded() { return Boolean(store().agentFolded); }

  /** w: unfolds the panel and gives it the keyboard. Never runs an agent. */
  show(cx) {
    if (this.folded()) edit((st) => { st.agentFolded = false; });
    this.focused = true;
    this.typing = false;
    this.owner.focus = "agent";
    this.owner.handle.focus();
    this.owner.redraw(cx);
  }

  fold() {
    edit((st) => { st.agentFolded = !st.agentFolded; });
    if (this.folded()) this.focusDiff();
  }

  /** The tab or the app closes: a running request stops, and its request file goes. */
  async close() {
    this.cancelled = true;
    this.closed = true;
    const file = this.requestFile;
    if (file) await fs.writeFile(`${file}.cancel`, "cancel").catch(() => {});
  }

  focusDiff() {
    this.focused = false;
    this.typing = false;
    this.owner.focus = "diff";
    this.owner.handle.focus();
  }
}

mixin(AgentPanel, AgentRecord, AgentRequests, AgentThreads, AgentKeys, Excerpts, AgentView);
