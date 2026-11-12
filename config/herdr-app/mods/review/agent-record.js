// The Agent panel's saved record: one file per review and scope, compare-and-swap saves that merge, and the
// comparison key that tells whether a walkthrough still explains the diff.
import { appHome, exec, readTextFile, setShared, writeTextFile } from "herdr";
import * as fs from "fs/promises";
import { anchorStale, capThreads, comparison, currentVersion, mergeRecords, upgradeRecord } from "./walkthrough-model.mjs";

export const DATA = () => `${appHome()}/data/walkthrough`;
// Request files older than this are left from a crash or a closed app.
const REQUEST_MAX_AGE = 3_600_000;
export const emptyRecord = () => ({ v: 2, at: 0, versions: [], current: null, threads: [] });
/** A saved record as the panel uses it: older shapes upgraded, malformed parts left out. */
export const upgrade = (saved) => upgradeRecord(saved, comparisonKey);

/** A comparison as a short key: records keep this, not the whole diff. */
export function comparisonKey(snapshot) {
  const h = hashInto({ a: 5381, b: 52711, n: 0 }, JSON.stringify(snapshot));
  return `${h.n.toString(36)}-${h.a.toString(36)}-${h.b.toString(36)}`;
}

export function hashInto(h, text) {
  let { a, b } = h;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = ((a * 33) ^ c) >>> 0; b = ((b * 31) + c) >>> 0; }
  return { a, b, n: h.n + text.length };
}

export class AgentRecord {
  /**
   * Leftovers, once per app start: request files from runs that never finished (a crash, a closed app) after
   * an hour; records of commit scopes nobody opened for two weeks; all but the newest debug reports.
   */
  async sweep() {
    try {
      const dir = `${DATA()}/requests`;
      for (const name of await fs.readdir(dir)) {
        const at = Number(/^(\d+)-/.exec(name)?.[1]);
        if (at && Date.now() - at > REQUEST_MAX_AGE) await fs.unlink(`${dir}/${name}`).catch(() => {});
      }
    } catch { /* no requests folder yet */ }
    // A record's file name ends in its scope: "~c%3A<sha>" is a commit or a range.
    exec("find", [`${DATA()}/reviews`, "-name", "*~c%3A*.json", "-mtime", "+14", "-delete"]).catch(() => {});
    for (const dir of [`${DATA()}/debug`, `${appHome()}/data/review-debug`]) {
      exec("sh", ["-c", 'cd "$1" 2>/dev/null && ls -t | tail -n +21 | while IFS= read -r f; do rm -f -- "$f"; done', "sh", dir]).catch(() => {});
    }
  }

  /**
   * The comparison's identity, cheap enough for every render: a PR's diff is fixed by its head and base, so its
   * key is ready at once. A local diff's key hashes its content in a task (keyOf); until then nothing is stale.
   */
  snapshot() {
    const o = this.owner, m = o.meta;
    const metaKey = JSON.stringify([o.local, m?.sha, m?.baseSha, m?.root, m?.scope, m?.from]);
    if (this.snapshotFiles !== o.files || this.snapshotMetaKey !== metaKey) {
      this.snapshotFiles = o.files;
      this.snapshotMetaKey = metaKey;
      this.comparison = null;
      this.comparisonKey = o.local ? null
        : comparisonKey({ head: metaKey, files: o.files.map((f) => [f.path, f.previous ?? null, f.status, f.rows.length]) });
    }
    return this.comparisonKey;
  }

  /** The whole comparison (what the agent gets), built in slices so a large diff never blocks the app. */
  async fullComparison(cx) {
    this.snapshot();
    if (this.comparison) return this.comparison;
    const files = this.owner.files, meta = this.owner.meta;
    const out = comparison(meta, [], this.owner.local);
    let started = Date.now();
    for (const f of files) {
      const rows = [];
      for (let i = 0; i < f.rows.length; i++) {
        const r = f.rows[i];
        rows.push({ k: r.k, o: r.o ?? null, n: r.n ?? null, text: r.text ?? "", count: r.count ?? null });
        if ((i & 127) === 0 && Date.now() - started > 6) { await cx.sleep(0); started = Date.now(); if (this.snapshotFiles !== files) return this.fullComparison(cx); }
      }
      out.files.push({ path: f.path, previous: f.previous ?? null, status: f.status, rows });
    }
    if (this.snapshotFiles === files) this.comparison = out;
    return out;
  }

  /** The comparison's key; for a local diff, its content hashed in slices. */
  async keyOf(cx) {
    this.snapshot();
    if (this.comparisonKey) return this.comparisonKey;
    const files = this.snapshotFiles;
    const c = await this.fullComparison(cx);
    let h = hashInto({ a: 5381, b: 52711, n: 0 }, JSON.stringify({ ...c, files: null }));
    let started = Date.now();
    for (const f of c.files) {
      h = hashInto(h, `${f.path}|${f.previous}|${f.status}`);
      for (let i = 0; i < f.rows.length; i++) {
        const r = f.rows[i];
        h = hashInto(h, `${r.k}|${r.o}|${r.n}|${r.text}\n`);
        if ((i & 127) === 0 && Date.now() - started > 6) { await cx.sleep(0); started = Date.now(); if (this.snapshotFiles !== files) return this.keyOf(cx); }
      }
    }
    if (this.snapshotFiles !== files) return this.keyOf(cx);
    this.comparisonKey = `l-${h.n.toString(36)}-${h.a.toString(36)}-${h.b.toString(36)}`;
    this.blocksKey = null; this.marksKey = null;
    return this.comparisonKey;
  }

  version() { return currentVersion(this.record); }

  walk() { return this.version()?.walkthrough ?? null; }

  steps() { return this.walk()?.steps ?? []; }

  /** The shown version explains another diff (a push since). */
  stale() {
    const v = this.version();
    if (!v) return false;
    this.snapshot();
    return Boolean(this.comparisonKey) && v.comparisonKey !== this.comparisonKey;
  }

  /** Code of a stale version can still be opened after "Show anyway"; every ref is checked against the diff. */
  usable() { return !this.stale() || this.showAnyway; }

  threads() { return [...(this.record?.threads ?? []), ...this.drafts]; }

  thread(id = this.tab) { return this.threads().find((t) => t.id === id) ?? null; }

  threadStale(th) { this.snapshot(); return Boolean(this.comparisonKey) && anchorStale(th.anchor, this.owner.files, this.comparisonKey); }

  /** The record of the shown scope: each scope keeps its own walkthrough and threads. */
  rkey() { return this.owner.akey?.() ?? this.owner.dkey; }

  file() { return `${DATA()}/reviews/${encodeURIComponent(this.rkey())}.json`; }

  /** Another scope: its record is read on the next render; what this one showed stays saved. */
  resetRecord() {
    // Saves, loads and follows still running belong to the old scope: the new generation drops what they bring.
    this.recordGen = (this.recordGen ?? 0) + 1;
    this.record = null; this.recordText = null; this.loaded = false; this.drafts = [];
    this.tab = "walk"; this.step = 0; this.link = -1; this.entry = -1; this.lineSel = null;
    this.showAnyway = false; this.error = null; this.blocksKey = null; this.marksKey = null; this.scroll.top = 0;
    // "Show more" and measured heights belong to the record shown; the checkout may be another one now.
    this.expanded = new Set(); this.heights = new Map(); this.prRoot = null;
  }

  /** The scope's record file, and the generation a scope switch ends: async work checks it before applying. */
  target() { return { file: this.file(), gen: this.recordGen ?? 0 }; }

  isCurrent(at) { return at.gen === (this.recordGen ?? 0); }

  /**
   * Saves with compare-and-swap to the file of the scope that made the change (`at`): another tab or window
   * that saved meanwhile makes the write fail, and the two copies merge before trying again.
   */
  async save(record, at = this.target(), expected = this.recordText) {
    await fs.mkdir(`${DATA()}/reviews`, { recursive: true });
    for (let i = 0; i < 4; i++) {
      capThreads(record);
      let text = JSON.stringify(record);
      // The file stays under the reader's 1 MiB limit: the oldest closed threads, then the oldest versions go.
      while (text.length > 900_000 && (record.threads.some((t) => t.closed) || record.versions.length > 1)) {
        const closed = record.threads.findIndex((t) => t.closed);
        if (closed >= 0) record.threads.splice(closed, 1); else record.versions.shift();
        text = JSON.stringify(record);
      }
      try {
        await writeTextFile(at.file, text, expected);
        if (this.isCurrent(at)) { this.recordText = text; this.record = record; }
        return record;
      } catch (e) {
        const theirs = await readTextFile(at.file).catch(() => null);
        // Nobody else wrote it: the write itself failed (disk, permissions), not a conflict.
        if (theirs === expected) throw new Error(`Couldn't save the review's agent data: ${e?.message ?? e}`);
        expected = theirs;
        if (theirs) { try { record = mergeRecords(record, upgrade(JSON.parse(theirs))); } catch { /* unreadable: replace it */ } }
      }
    }
    throw new Error("Couldn't save the review's agent data: another window keeps changing it. Try again.");
  }

  /**
   * Changes the record and saves it; the panel shows the change at once. `fn` gets a shallow copy: it replaces
   * what it changes (changeThread does), so a click never clones a record of many versions.
   */
  change(fn, cx) {
    const record = { ...(this.record ?? emptyRecord()) };
    record.threads = [...(record.threads ?? [])];
    fn(record);
    record.at = Date.now();
    this.record = record;
    const at = this.target(), expected = this.recordText;
    cx.spawn(async (cx) => {
      let saved = false;
      try { await this.save(record, at, expected); saved = true; } catch (e) { if (this.isCurrent(at)) this.error = String(e?.message ?? e); }
      this.kick(cx, { announce: saved });
    });
  }

  /** Changes one saved thread's fields. */
  changeThread(id, patch, cx) {
    if (!this.record?.threads.some((t) => t.id === id)) return;
    this.change((r) => { r.threads = r.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)); }, cx);
  }

  loadRecord(cx) {
    this.loaded = true;
    const at = this.target();
    cx.spawn(async (cx) => {
      let text = null;
      try { text = await readTextFile(at.file); } catch { /* no saved data yet */ }
      if (text && !this.running && this.isCurrent(at)) {
        // The next save compares against this text, readable or not.
        this.recordText = text;
        try { this.record = upgrade(JSON.parse(text)); } catch {
          // Unreadable: a copy stays next to it before the next save replaces it.
          const copy = `${at.file}.corrupt-${Date.now()}`;
          await fs.writeFile(copy, text).catch(() => {});
          if (this.isCurrent(at)) this.error = `The saved agent data was unreadable. A copy is at ${copy}.`;
        }
      }
      this.kick(cx);
    });
  }

  /**
   * Redraws after work that finished in a task: this copy's cx, and a shared tick so the copy that shows
   * the tab redraws too, whichever copy started the work.
   */
  kick(cx, { announce = false } = {}) {
    this.blocksKey = null;
    this.marksKey = null;
    try { this.owner.redraw(cx); } catch { /* the copy that started it is gone */ }
    // Only a saved change concerns other windows; each setShared re-renders every mod in this one.
    if (!announce) return;
    this.tickAt = Date.now();
    setShared("review.walkthrough", { at: this.tickAt, review: this.rkey() });
  }

  /** Another copy (another window) saved this review's record: read it again. */
  follow(tick, cx) {
    if (!tick || tick.review !== this.rkey() || tick.at === this.tickAt || this.running || this.following) return;
    this.tickAt = tick.at;
    this.following = true;
    const at = this.target();
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(at.file);
        if (text && text !== this.recordText && this.isCurrent(at)) { this.recordText = text; this.record = upgrade(JSON.parse(text)); this.blocksKey = null; this.marksKey = null; }
      } catch { /* keep what is shown */ }
      this.following = false;
      this.owner.redraw(cx);
    });
  }
}
