// Draft notes and viewed marks of a review, and where they go: one GitHub review, or an agent's input box.
import { agents, appHome, exec, notify } from "herdr";
import * as fs from "fs/promises";
import * as gh from "./gh.js";
import * as sc from "./scopes.mjs";
import { asError } from "./errors.mjs";
import { draftsOf, editDrafts, store } from "./store.js";
import { M } from "./tab-metrics.js";

export const EVENTS = [["COMMENT", "Comment"], ["APPROVE", "Approve"], ["REQUEST_CHANGES", "Request changes"]];
// herdr-nvim's app-send pastes without Enter (hc send always presses it).
const SEND = () => `${appHome()}/mods/herdr-nvim/bin/herdr-nvim`;

export class TabDrafts {
  type() {
    if (this.local) return "agent";
    return draftsOf(this.dkey).type ?? "pr";
  }

  notes() {
    return draftsOf(this.dkey).notes ?? [];
  }

  /** The drafts written in this scope: only these show in the diff (their lines are this scope's lines). */
  notesHere() {
    const notes = this.notes(), here = this.scopeKey();
    if (this.hereOf?.notes === notes && this.hereOf.scope === here) return this.hereOf.list;
    const def = this.local ? "branch" : "all";
    const list = notes.filter((n) => (n.scope ?? def) === here);
    this.hereOf = { notes, scope: here, list, sig: list.map((n) => `${n.id}:${n.line}:${n.body.length}:${n.sha}`).join() };
    return list;
  }

  /** What the shown drafts look like to the display: their ids, lines, sizes and commits. */
  notesSig() { this.notesHere(); return this.hereOf.sig; }

  /** A draft written on an older head commit: its lines may have moved, so it is not sent until re-anchored. */
  stale(n) {
    return !this.local && Boolean(n.sha) && Boolean(this.headSha()) && n.sha !== this.headSha();
  }

  /** GitHub takes the draft as a line comment: its line is in the PR head's diff (scopes.postable). */
  postable(n) { return this.local || sc.postable(n, this.headIndex); }

  /** The drafts a submit sends: not stale, and postable. */
  fresh() {
    return this.notes().filter((n) => !this.stale(n) && this.postable(n));
  }

  /** GitHub's review threads that sit on this scope's lines: All changes; Since review on the new side. */
  threadsHere() {
    const all = this.meta?.threads ?? [];
    const k = this.scopeKey();
    return k === "all" ? all : k === "since" ? all.filter((th) => th.side === "RIGHT") : [];
  }

  /** The viewed marks ("path@blob"); a mark holds in every scope until the file's content changes. */
  viewedMarks() {
    const list = draftsOf(this.dkey).viewed ?? [];
    if (this.marksOf !== list) { this.marksOf = list; this.marksSet = new Set(list); }
    return this.marksSet;
  }

  fileViewed(file) { return Boolean(file) && sc.isViewed(this.viewedMarks(), file); }

  pathViewed(path) { return this.fileViewed(this.files[this.fileIndex?.get(path) ?? -1]); }

  viewedCount() { return this.files.filter((f) => this.fileViewed(f)).length; }

  annotate() {
    const [a, b] = this.selection() ?? [this.cursor, this.cursor];
    const range = this.rangeOf(a, b);
    if (!range) return this.say("Put the cursor on a line (or select lines with v or a drag), then a");
    this.pending = { after: b, range, edit: null };
    this.composer.set_value("");
    this.composer.focus();
    this.reveal = { row: b, margin: M.COMPOSER + 8, after: true };
  }

  editNote(note) {
    const at = this.rowFor(note.path, note.side, note.line);
    this.pending = { after: at, range: { path: note.path, side: note.side, line: note.line, start_side: note.start_side, start_line: note.start_line, snippet: note.snippet }, edit: note.id };
    this.composer.set_value(note.body);
    this.composer.focus();
    this.reveal = { row: at, margin: M.COMPOSER + 8, after: true };
  }

  saveNote(cx) {
    const body = String(this.composer.value() ?? "").trim();
    const p = this.pending;
    const sha = this.headSha();
    const scope = sc.isDefault(this.scope, this.local) ? {} : { scope: this.scopeKey() };
    // An edited stale draft is anchored again when its line is still in this diff.
    // Still there: the same line, with the same text (a push can put other code on the same number).
    const there = (r) => {
      const at = this.where.get(`${r.path}|${r.side}|${r.line}`);
      return at !== undefined && (!r.snippet?.length || this.rows[at].text === r.snippet.at(-1));
    };
    if (p && body) editDrafts(this.dkey, (d) => {
      if (p.edit) {
        const n = d.notes.find((x) => x.id === p.edit);
        if (n) {
          n.body = body;
          if (this.stale(n) && there(n)) n.sha = sha;
          else if (this.stale(n)) this.say("Still stale: its line is not in this diff any more (d deletes it)");
        }
      } else d.notes.push({ id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ...p.range, body, sha, ...scope });
    });
    this.cancelNote(cx);
  }

  cancelNote(cx) {
    this.pending = null;
    this.anchor = null;
    this.handle.focus();
    this.redraw(cx);
  }

  /** The drafts on the cursor's row (the last first). */
  notesAtCursor() {
    return this.notesHere().filter((n) => this.rowFor(n.path, n.side, n.line) === this.cursor);
  }

  threadsAtCursor() {
    return this.threadsHere().filter((th) => this.rowFor(th.path, th.side, th.line) === this.cursor);
  }

  deleteNote(note) {
    editDrafts(this.dkey, (d) => { d.notes = d.notes.filter((n) => n.id !== note.id); });
  }

  dropStale() {
    const gone = this.notes().filter((n) => this.stale(n)).map((n) => n.id);
    if (!gone.length) return this.say("No stale drafts");
    editDrafts(this.dkey, (d) => { d.notes = d.notes.filter((n) => !gone.includes(n.id)); });
    this.say(`Dropped ${gone.length} stale draft${gone.length === 1 ? "" : "s"}`);
  }

  toggleThread(th) {
    if (this.openThreads.has(th.id)) this.openThreads.delete(th.id);
    else this.openThreads.add(th.id);
  }

  /** V: the file's viewed mark, for its path and content (a bare path from older versions goes too). */
  toggleViewed(f) {
    const file = this.files[f];
    if (!file) return;
    const on = this.fileViewed(file), key = sc.viewedKey(file);
    editDrafts(this.dkey, (d) => { d.viewed = on ? d.viewed.filter((p) => p !== key && p !== file.path) : [...d.viewed, key]; });
  }

  setType(type) {
    if (this.local && type === "pr") return this.say("A local diff has no GitHub PR: Agent review only");
    editDrafts(this.dkey, (d) => { d.type = type; });
  }

  /** The notes as the agent reads them. */
  agentText() {
    const m = this.meta ?? {};
    const what = this.local ? `local changes on ${m.head}` : `#${this.ref.number} ${m.title ?? ""}`.trim();
    const lines = [`Review notes for ${what} (${m.head ?? "?"} → ${m.base ?? "?"}):`, ""];
    for (const n of this.notes()) {
      const at = n.start_line && n.start_line !== n.line ? `${n.start_line}-${n.line}` : `${n.line}`;
      const [first, ...rest] = n.body.split("\n");
      lines.push(`- ${n.path}:${at}${n.side === "LEFT" ? " (old)" : ""}: ${first}`);
      for (const r of rest) lines.push(`  ${r}`);
      for (const s of (n.snippet ?? []).slice(0, 20)) lines.push(`  > ${s}`);
    }
    return lines.join("\n");
  }

  /** Agents in this tab's space first. Agents in other spaces only after "Show all workspaces" (a). */
  agentList() {
    const all = agents();
    const here = all.filter((a) => a.space === this.p.space);
    return this.modal?.allSpaces ? [...here, ...all.filter((a) => a.space !== this.p.space)] : here;
  }

  otherAgents() {
    return agents().filter((a) => a.space !== this.p.space).length;
  }

  pasteTo(agent, cx) {
    if (!agent || this.busy) return;
    this.busy = true;
    const text = this.agentText(), ids = this.notes().map((n) => n.id);
    cx.spawn(async (cx) => {
      try {
        // herdr-nvim's app-send pastes without Enter (hc send always presses it).
        const r = await exec(SEND(), ["app-send", agent.address, text], { timeout: 20_000 });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.code}`).trim());
        // Only the notes that went out go; notes written meanwhile stay.
        editDrafts(this.dkey, (d) => { d.notes = d.notes.filter((n) => !ids.includes(n.id)); });
        this.modal = null;
        notify({ title: "Review notes pasted", body: `Into ${agent.program?.name ?? agent.address} (${agent.address}); press Enter there to send.`, level: "success", action: { name: "agent.focus", args: { terminal: agent.address } } });
        this.handle.focus();
      } catch (e) {
        this.say(`Paste failed: ${e.message ?? e}`);
      } finally {
        this.busy = false;
        this.redraw(cx);
      }
    });
  }

  /** The review GitHub gets: one review, every draft a line comment. */
  payload(event) {
    return {
      commit_id: this.headSha(),
      event,
      body: String(this.summary.value() ?? "").trim(),
      comments: this.fresh().map((n) => ({
        path: n.path, line: n.line, side: n.side,
        ...(n.start_line && n.start_line !== n.line ? { start_line: n.start_line, start_side: n.start_side } : {}),
        body: n.body,
      })),
    };
  }

  /** The payload file of this PR (one per PR, so two tabs never write the same file). */
  payloadFile(dry) {
    return `${appHome()}/data/review-${dry ? "dry-run" : "payload"}-${this.ref.repo.replace(/\//g, "_")}-${this.ref.number}.json`;
  }

  submit(cx) {
    const event = this.modal?.event ?? "COMMENT";
    const body = this.payload(event);
    const ids = this.fresh().map((n) => n.id);
    if (!body.comments.length && !body.body && event !== "APPROVE") return this.say("Nothing to send: write a note (a) or a summary");
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const dry = Boolean(store().dryRun);
        const file = this.payloadFile(dry);
        // A submit that got no answer may have been posted: look before posting again.
        const last = draftsOf(this.dkey).inflight;
        if (!dry && last && !this.meta?.viewer) throw new Error("Couldn't check whether the last review was posted. Reload (R) and try again");
        if (!dry && last) {
          // Only a review with this submit's summary counts: another review of yours in the window does not.
          const posted = (await gh.reviewsSince(this.ref, this.meta.viewer, last.at)).filter((x) => (x.body ?? "").trim() === (last.body ?? "").trim());
          editDrafts(this.dkey, (d) => {
            delete d.inflight;
            if (posted.length) d.notes = d.notes.filter((n) => !last.ids.includes(n.id));
          });
          if (posted.length) {
            notify({ title: `The last review on #${this.ref.number} was posted`, body: "Its notes are gone from the drafts; nothing was sent again.", level: "info" });
            this.modal = null;
            this.reloadThreads(cx);
            return;
          }
        }
        if (dry) {
          await fs.writeFile(file, JSON.stringify({ repo: this.ref.repo, number: this.ref.number, ...body }, null, 2));
          notify({ title: "review dry run", body: `Not posted. Payload: ${file}`, level: "info" });
        } else {
          await fs.writeFile(file, JSON.stringify(body));
          editDrafts(this.dkey, (d) => { d.inflight = { ids, body: body.body, at: new Date(Date.now() - 60_000).toISOString() }; });
          try {
            await gh.postReview(this.ref, file);
          } catch (e) {
            // GitHub answered with an error: nothing was posted, so no check is needed before a retry.
            if (!e?.uncertain) editDrafts(this.dkey, (d) => { delete d.inflight; });
            throw asError(e, "submit");
          }
          await fs.unlink(file).catch(() => {});
          notify({ title: `Review sent on #${this.ref.number}`, body: `${EVENTS.find((e) => e[0] === event)[1]}, ${body.comments.length} comment${body.comments.length === 1 ? "" : "s"}`, level: "success" });
          // Only the notes that went out go; notes written meanwhile stay.
          editDrafts(this.dkey, (d) => { d.notes = d.notes.filter((n) => !ids.includes(n.id)); delete d.inflight; });
          this.summary.set_value("");
          this.reloadThreads(cx);
        }
        this.modal = null;
        this.handle.focus();
      } catch (e) {
        this.say(`Submit failed: ${e.message ?? e}${e.uncertain ? " (no answer: S checks GitHub before sending again)" : ""}`);
      } finally {
        this.busy = false;
        this.redraw(cx);
      }
    });
  }

  /** "4 drafts · 1 stale (not sent) · 1 not postable". */
  draftCounts(notes, pr) {
    const stale = notes.filter((x) => this.stale(x)).length;
    const off = pr ? notes.filter((x) => !this.stale(x) && !this.postable(x)).length : 0;
    return [`${notes.length} draft${notes.length === 1 ? "" : "s"}`, stale ? `${stale} stale (not sent)` : "", off ? `${off} not postable in this scope` : ""].filter(Boolean).join(" · ");
  }
}
