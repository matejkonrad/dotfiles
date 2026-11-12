// The Agent panel's tabs and threads, walkthrough versions, and the jumps between the panel and the diff.
import { blocksText, excerptRows, stepRefs, unread, validReference } from "./walkthrough-model.mjs";

export class AgentThreads {
  /** Every tab of the bar: the walkthrough, then the open threads (oldest first). */
  tabs() { return ["walk", ...this.threads().filter((t) => !t.closed).map((t) => t.id)]; }

  /** A thread's number: its place among all threads of the review (closed ones keep theirs). */
  number(id) { return this.threads().findIndex((t) => t.id === id) + 1; }

  reopen(id, cx) {
    this.threadsMenu = false;
    if (this.thread(id)?.closed) this.changeThread(id, { closed: false }, cx);
    this.select(id, cx);
  }

  select(id, cx) {
    this.tab = id;
    this.entry = -1;
    this.lineSel = null;
    this.blocksKey = null;
    this.scroll.top = 0;
    const th = this.thread(id);
    if (th && unread(th)) this.changeThread(id, { readAt: Date.now() }, cx);
    if (th) this.revealBottom = true;
  }

  closeThread(id, cx) {
    const at = this.tabs().indexOf(id);
    this.drafts = this.drafts.filter((t) => t.id !== id);
    // Closed is not deleted: Threads ▾ reopens it.
    this.changeThread(id, { closed: true }, cx);
    if (this.tab === id) this.select(this.tabs().filter((x) => x !== id)[Math.max(0, at - 1)] ?? "walk", cx);
  }

  startRename() {
    const th = this.thread();
    if (!th) return;
    this.renaming = th.id;
    this.rename.set_value(th.title);
    this.rename.focus();
  }

  finishRename(cx) {
    const id = this.renaming, title = String(this.rename.value() ?? "").trim();
    this.renaming = null;
    if (title && id) {
      const draft = this.drafts.find((t) => t.id === id);
      if (draft) draft.title = title;
      else this.changeThread(id, { title }, cx);
    }
    this.owner.handle.focus();
    this.owner.redraw(cx);
  }

  flip(delta, cx) {
    const vs = this.record?.versions ?? [];
    const at = vs.findIndex((v) => v.id === this.version()?.id);
    const next = vs[at + delta];
    if (!next) return;
    this.change((r) => { r.current = next.id; }, cx);
    this.step = 0; this.link = -1; this.showAnyway = false;
  }

  /** Jumps to a ref in the diff and selects its lines. */
  navigate(ref, cx) {
    if (!this.usable() && this.tab === "walk") { this.error = "This walkthrough is out of date. Regenerate it (r), or Show anyway."; this.redraw(cx); return; }
    const o = this.owner;
    if (!validReference(ref, o.files)) { this.error = "Those lines are not in the current diff."; this.redraw(cx); return; }
    const at = o.where.get(`${ref.path}|${ref.side}|${ref.line}`);
    const from = ref.start_line != null ? o.where.get(`${ref.path}|${ref.side}|${ref.start_line}`) : undefined;
    o.unfold(ref.path);
    o.cursor = at;
    o.anchor = from !== undefined && from !== at ? from : null;
    o.side = ref.side === "LEFT" ? "left" : "right";
    for (const dir of [...o.closedDirs]) if (ref.path.startsWith(`${dir}/`)) o.closedDirs.delete(dir);
    o.reveal = { row: at, center: true };
    this.focusDiff();
    this.owner.redraw(cx);
  }

  /** c in a thread: the focused answer (else the last) becomes a draft review note on the thread's lines, in the composer. */
  noteFromAnswer(cx) {
    const th = this.thread();
    if (!th) return;
    const answers = th.entries.filter((e) => e.role === "answer");
    const e = th.entries[this.entry]?.role === "answer" ? th.entries[this.entry] : answers.at(-1);
    if (!e) { this.error = "No answer yet to turn into a note."; this.redraw(cx); return; }
    const a = th.anchor;
    if (!a.path) { this.error = "This thread is about a step, not lines. Ask about lines (i in the diff) to make a note."; this.redraw(cx); return; }
    if (this.threadStale(th)) { this.error = "The lines of this thread changed after a push."; this.redraw(cx); return; }
    const o = this.owner;
    const row = o.where.get(`${a.path}|${a.side}|${a.line}`);
    if (row === undefined) { this.error = "Those lines are not in the current diff."; this.redraw(cx); return; }
    o.unfold(a.path);
    o.cursor = row;
    o.anchor = null;
    const range = { path: a.path, side: a.side, line: a.line, snippet: a.snippet ?? [] };
    if (a.start_line != null && a.start_line !== a.line) { range.start_line = a.start_line; range.start_side = a.side; }
    o.pending = { after: row, range, edit: null };
    o.composer.set_value(blocksText(e.blocks ?? [{ type: "text", md: e.body ?? "" }]));
    this.focused = false;
    o.focus = "diff";
    o.composer.focus();
    o.reveal = { row, margin: 140, after: true };
    this.owner.redraw(cx);
  }

  /**
   * Rows of the diff with a mark: the selected step's excerpt lines ({step}), lines with a thread ({thread,
   * unread}). Built once per record, step and diff version.
   */
  marks() {
    const key = `${this.record?.at}|${this.step}|${this.version()?.id}|${this.owner.version}|${this.drafts.length}|${this.tab}|${this.showAnyway}`;
    if (this.marksKey === key) return this.markMap;
    this.marksKey = key;
    const map = new Map();
    const o = this.owner;
    const put = (ref, mark) => {
      const f = o.fileIndex?.get(ref.path) ?? o.files.findIndex((x) => x.path === ref.path);
      if (f < 0) return;
      for (const i of excerptRows(ref, o.files) ?? []) {
        const row = o.fileStart[f] + 1 + i;
        map.set(row, { ...(map.get(row) ?? {}), ...mark });
      }
    };
    if (this.usable()) for (const ref of stepRefs(this.steps()[this.step] ?? {})) put(ref, { step: this.step + 1 });
    this.snapshot();
    for (const th of this.threads()) if (th.anchor.path && th.entries.length && !this.threadStale(th)) put(th.anchor, { thread: th.id, unread: unread(th), selected: this.tab === th.id });
    this.markMap = map;
    return map;
  }

  /** Threads with lines in this diff, under the row of their last line (the diff's inline chips). */
  chips() {
    if (!this.threads().length) return [];
    this.snapshot();
    return this.threads().filter((th) => th.anchor.path && th.entries.length && !this.threadStale(th));
  }

  chipsSig() { return this.chips().map((t) => `${t.id}:${t.entries.length}:${unread(t)}:${t.title}`).join(","); }
}
