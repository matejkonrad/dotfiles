// The review tab's diff as rows: indexing, folds, the split view's pairs, the display list and moving the cursor.
import { edit, store } from "./store.js";
import { stepRefs } from "./walkthrough-model.mjs";
import { fileTree, isGenerated, isLine } from "./diff-model.mjs";
import { M } from "./tab-metrics.js";

export class TabDiff {
  setFiles(files) {
    // The cursor stays on its line (path, side, number) when the new diff has it; else on its file.
    const old = this.rows[this.cursor], oldFile = old ? this.files[old.f] : null;
    const keep = oldFile && old.k !== "file" ? `${oldFile.path}|${old.k === "del" ? "LEFT" : "RIGHT"}|${old.k === "del" ? old.o : old.n}` : null;
    this.files = files;
    this.rows = [];
    this.fileStart = [];
    this.where = new Map();
    this.fileIndex = new Map();
    files.forEach((file, f) => {
      this.fileIndex.set(file.path, f);
      this.fileStart[f] = this.rows.length;
      this.rows.push({ k: "file", f });
      for (const r of file.rows) {
        const i = this.rows.length;
        // The diff's own row objects, tagged with their file (no copy per row).
        r.f = f;
        this.rows.push(r);
        if (r.n != null && r.k !== "del") this.where.set(`${file.path}|RIGHT|${r.n}`, i);
        if (r.o != null && r.k !== "add") this.where.set(`${file.path}|LEFT|${r.o}`, i);
      }
    });
    // Word diff pairs: each removed line with the added line in the same place (the split view's pairs).
    // The diff itself runs lazily, for rows on screen (codeEl).
    for (let i = 0; i < this.rows.length;) {
      if (this.rows[i].k !== "del") { i++; continue; }
      const dels = [], adds = [];
      while (i < this.rows.length && this.rows[i].k === "del") dels.push(i++);
      while (i < this.rows.length && this.rows[i].k === "add") adds.push(i++);
      for (let j = 0; j < Math.min(dels.length, adds.length); j++) { this.rows[dels[j]].mate = this.rows[adds[j]]; this.rows[adds[j]].mate = this.rows[dels[j]]; }
    }
    this.tree = fileTree(files);
    this.hunks = null;
    this.srowsOf = null;
    const same = keep ? this.where.get(keep) : undefined;
    if (same !== undefined) { this.cursor = same; this.anchor = null; return; }
    const back = oldFile ? this.fileIndex.get(oldFile.path) ?? -1 : -1;
    this.cursor = back >= 0 ? this.fileStart[back] : Math.max(0, this.rows.findIndex((r) => r.k === "add" || r.k === "del"));
    this.anchor = null;
    this.reveal = { row: this.cursor, center: true };
  }

  /** Where a note or thread sits: the row of its (path, side, line), else its file's header. */
  rowFor(path, side, line) {
    const at = line != null ? this.where.get(`${path}|${side}|${line}`) : undefined;
    if (at !== undefined) return at;
    const f = this.fileIndex?.get(path) ?? -1;
    return f >= 0 ? this.fileStart[f] : -1;
  }

  threadOpen(th) {
    return th.resolved ? this.openThreads.has(th.id) : !this.openThreads.has(th.id);
  }

  /** Deleted and generated files start folded; ⏎ on the file's header (or its folded row) opens and folds. */
  folded(f) {
    const file = this.files[f];
    if (!file) return false;
    if (this.folds.has(file.path)) return this.folds.get(file.path);
    return file.status === "removed" || isGenerated(file);
  }

  /** Opens a folded file; true when it was folded (only then the display changes). */
  unfold(path) {
    const f = this.fileIndex?.get(path) ?? -1;
    if (f < 0 || !this.folded(f)) return false;
    this.folds.set(path, false);
    this.version++;
    return true;
  }

  toggleFold(f) {
    const file = this.files[f];
    if (!file) return;
    this.folds.set(file.path, !this.folded(f));
    this.cursor = this.fileStart[f];
    this.version++;
    this.reveal = { row: this.cursor, margin: M.ROW * 2 };
  }

  /** Rows, threads, drafts and the composer in display order, with their heights. */
  split() {
    return Boolean(store().split) && this.splitFits();
  }

  toggleSplit() {
    edit((st) => { st.split = !st.split; });
    this.reveal = { row: this.cursor, center: true };
  }

  /**
   * The split view's rows: a context line is one row (both sides), a run of removed lines then added lines
   * is paired row by row (removed[i] with added[i]), file headers, hunks and folds stay one row.
   * Each entry: {left, right} unified row indexes (null: a filler) or {only} for full-width rows.
   * Kept per version of the rows; srowOf maps a unified row to its split row.
   */
  splitRows() {
    if (this.srowsOf === this.rows) return this.srows;
    const out = [], of = new Array(this.rows.length);
    const rows = this.rows;
    for (let i = 0; i < rows.length;) {
      const r = rows[i];
      if (r.k === "del" || r.k === "add") {
        const dels = [], adds = [];
        while (i < rows.length && rows[i].k === "del") dels.push(i++);
        while (i < rows.length && rows[i].k === "add") adds.push(i++);
        for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
          const pair = { left: dels[j] ?? null, right: adds[j] ?? null };
          if (pair.left !== null) of[pair.left] = out.length;
          if (pair.right !== null) of[pair.right] = out.length;
          out.push(pair);
        }
        continue;
      }
      of[i] = out.length;
      out.push(r.k === "ctx" ? { left: i, right: i } : { only: i });
      i++;
    }
    this.srows = out;
    this.srowOf = of;
    this.srowsOf = rows;
    return out;
  }

  /** The unified row of split row s on the cursor's side (the other side when that one is a filler). */
  pick(s) {
    const sr = this.srows[s];
    if (sr.only !== undefined) return sr.only;
    return this.side === "left" ? sr.left ?? sr.right : sr.right ?? sr.left;
  }

  /**
   * The display list: diff units (row indexes, or split-row indexes in the split view) as plain numbers, with
   * inserts under them (threads, drafts, thread chips, the composer, a folded file's row). One pass, no object
   * per diff row, so it stays fast for very large diffs. Kept until something it shows changes.
   */
  buildDisplay() {
    const split = this.split();
    const notes = this.notesHere();
    const chips = this.agent.chips();
    const sig = `${split}|${M.ROW}|${M.LINE}|${this.version}|${this.notesSig()}|${this.pending?.after ?? -1}|${this.pending?.edit ?? ""}|${[...this.openThreads].join()}|${this.agent.chipsSig()}|${this.width > 0}`;
    if (sig === this.dispSig && this.scroll.sizes?.length === this.display?.length) return;
    const rows = this.rows;
    const srows = split ? this.splitRows() : null;
    const unitOf = (i) => (split ? this.srowOf[i] : i);
    const under = new Map();
    const put = (i, item) => { if (i >= 0) { const k = unitOf(i); (under.get(k) ?? under.set(k, []).get(k)).push(item); } };
    for (const th of this.threadsHere()) put(this.rowFor(th.path, th.side, th.line), { thread: th });
    for (const n of notes) if (n.id !== this.pending?.edit) put(this.rowFor(n.path, n.side, n.line), { note: n });
    for (const th of chips) put(this.rowFor(th.anchor.path, th.anchor.side, th.anchor.line), { chip: th });
    const composerAt = this.pending ? unitOf(this.pending.after) : -1;
    const foldedFiles = this.files.map((_, f) => this.folded(f));
    const n = split ? srows.length : rows.length;
    const out = [], sizes = [], stops = [];
    const dispOf = new Int32Array(rows.length);
    const stopAt = new Int32Array(n).fill(-1);
    const firstOf = (k) => { const sr = srows[k]; return sr.only ?? sr.left ?? sr.right; };
    for (let k = 0; k < n; k++) {
      const first = split ? firstOf(k) : k;
      const row = rows[first];
      const head = row.k === "file";
      if (foldedFiles[row.f] && !head) {
        const at = dispOf[this.fileStart[row.f]];
        if (split) { const sr = srows[k]; for (const i of [sr.only, sr.left, sr.right]) if (i != null) dispOf[i] = at; } else dispOf[k] = at;
        continue;
      }
      const at = out.length;
      if (split) { const sr = srows[k]; for (const i of [sr.only, sr.left, sr.right]) if (i != null) dispOf[i] = at; } else dispOf[k] = at;
      stopAt[k] = stops.length;
      stops.push(k);
      out.push(k);
      sizes.push(head ? M.FILE_ROW : M.ROW);
      if (head && foldedFiles[row.f]) { out.push({ folded: row.f }); sizes.push(M.ROW); continue; }
      const items = under.get(k);
      if (items) for (const item of items) { out.push(item); sizes.push(this.sizeOf(item)); }
      if (composerAt === k) { out.push({ composer: true }); sizes.push(M.COMPOSER); }
    }
    this.display = out;
    this.dispOf = dispOf;
    this.stops = stops;
    this.stopAt = { get: (k) => (stopAt[k] >= 0 ? stopAt[k] : undefined) };
    this.scroll.measure(sizes);
    this.dispSig = sig;
  }

  fileAt(i) {
    return this.rows[i]?.f ?? 0;
  }

  /** The new-side line at row i (a deleted line: the next line that's there). */
  lineAt(i) {
    for (let j = i; j < this.rows.length && this.rows[j].f === this.fileAt(i); j++) if (this.rows[j].n) return this.rows[j].n;
    for (let j = i; j >= 0 && this.rows[j].f === this.fileAt(i); j--) if (this.rows[j].n) return this.rows[j].n;
    return 1;
  }

  selection() {
    return this.anchor === null ? null : [Math.min(this.anchor, this.cursor), Math.max(this.anchor, this.cursor)];
  }

  /** j/k and paging move over the rows on screen (folded files are one row), in either view. */
  move(delta) {
    if (!this.rows.length) return;
    this.buildDisplay();
    const stops = this.stops ?? [];
    if (!stops.length) return;
    const split = this.split();
    const here = split ? this.srowOf[this.cursor] : this.cursor;
    let pos = this.stopAt.get(here);
    if (pos === undefined) {
      // The cursor is inside a folded file: start from its header.
      const head = this.fileStart[this.fileAt(this.cursor)];
      pos = this.stopAt.get(split ? this.srowOf[head] : head) ?? 0;
    }
    const step = Number.isFinite(delta) ? delta : delta > 0 ? stops.length : -stops.length;
    const at = stops[Math.min(stops.length - 1, Math.max(0, pos + step))];
    this.cursor = split ? this.pick(at) : at;
    this.reveal = { row: this.cursor, margin: M.ROW * 2 };
  }

  nextFile(delta) {
    if (!this.files.length) return;
    const f = Math.min(this.files.length - 1, Math.max(0, this.fileAt(this.cursor) + delta));
    this.goFile(f);
  }

  goFile(f) {
    const start = this.fileStart[f];
    let first = -1;
    for (let i = start + 1; i < this.rows.length && this.rows[i].f === f; i++) if (this.rows[i].k === "add" || this.rows[i].k === "del") { first = i; break; }
    this.cursor = first >= 0 ? first : start;
    this.anchor = null;
    this.reveal = { row: start, top: true };
  }

  page() {
    return Math.max(1, Math.floor((this.scroll.height || 400) / M.ROW) - 2);
  }

  /** Hunk starts in diff order: the first changed row of each hunk (rows). Kept per diff. */
  hunkStarts() {
    if (this.hunks?.rows === this.rows) return this.hunks.list;
    const list = [];
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if ((r.k === "add" || r.k === "del") && !(this.rows[i - 1]?.k === "add" || this.rows[i - 1]?.k === "del")) list.push(i);
    }
    this.hunks = { rows: this.rows, list };
    return list;
  }

  /**
   * n / N: the next hunk. With a walkthrough step selected: the step's excerpts in order, then the next step's
   * first excerpt (the panel follows). Else the next hunk in the diff.
   */
  nextHunk(d, cx) {
    const a = this.agent;
    const steps = a.usable() ? a.steps() : [];
    if (steps.length) {
      const stops = (si) => stepRefs(steps[si]).map((ref) => this.where.get(`${ref.path}|${ref.side}|${ref.start_line ?? ref.line}`) ?? this.where.get(`${ref.path}|${ref.side}|${ref.line}`)).filter((x) => x !== undefined);
      let si = a.step;
      const here = stops(si);
      let at = here.indexOf(this.cursor);
      if (at < 0) at = d > 0 ? -1 : here.length;
      let next = at + d;
      while (next < 0 || next >= stops(si).length) {
        si += d;
        if (si < 0 || si >= steps.length) return this.say(d > 0 ? "End of the walkthrough" : "Start of the walkthrough");
        next = d > 0 ? 0 : stops(si).length - 1;
      }
      const row = stops(si)[next];
      a.step = si; a.link = stepRefs(steps[si]).length > next ? next : -1; a.revealStep = true; a.marksKey = null;
      const ref = stepRefs(steps[si])[next];
      const end = this.where.get(`${ref.path}|${ref.side}|${ref.line}`);
      this.unfold(ref.path);
      this.cursor = row; this.anchor = end !== undefined && end !== row ? end : null;
      this.reveal = { row, center: true };
      return;
    }
    const list = this.hunkStarts();
    if (!list.length) return;
    const next = d > 0 ? list.find((i) => i > this.cursor) : [...list].reverse().find((i) => i < this.cursor);
    if (next === undefined) return this.say(d > 0 ? "Last hunk" : "First hunk");
    this.unfold(this.files[this.rows[next].f].path);
    this.cursor = next; this.anchor = null;
    this.reveal = { row: next, margin: M.ROW * 4 };
  }

  /** The noted range of rows a..b: path, sides, lines and the lines' text. */
  rangeOf(a, b) {
    const f = this.fileAt(b);
    // GitHub takes a range inside one hunk only: a selection starts at the hunk of its last line.
    for (let h = b; h >= a; h--) if (this.rows[h].k === "hunk" || this.rows[h].k === "fold" || this.rows[h].k === "file") { a = h + 1; break; }
    const lines = [];
    // In the split view a selection is on one side: removed lines on the left, added on the right.
    const keep = !this.split() ? () => true : this.side === "left" ? (r) => r.k !== "add" : (r) => r.k !== "del";
    for (let i = a; i <= b; i++) if (this.rows[i].f === f && isLine(this.rows[i]) && keep(this.rows[i])) lines.push(this.rows[i]);
    if (!lines.length) return null;
    const side = (r) => (r.k === "del" ? "LEFT" : "RIGHT");
    const num = (r) => (r.k === "del" ? r.o : r.n);
    const first = lines[0], last = lines.at(-1);
    const range = { path: this.files[f].path, side: side(last), line: num(last), snippet: lines.map((r) => r.text) };
    if (lines.length > 1) { range.start_side = side(first); range.start_line = num(first); }
    return range;
  }
}
