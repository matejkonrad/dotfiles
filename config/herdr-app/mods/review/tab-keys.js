// The review tab's keys, commands (`review.<name>`), the ⌘K palette's actions and the pointer in the diff.
import { TextareaState } from "gpui-base";
import { focused, run } from "herdr";
import * as sc from "./scopes.mjs";
import { openUrl } from "./ui.js";
import { edit, editDrafts, store } from "./store.js";
import { EVENTS } from "./tab-drafts.js";
import { panelJustFocused } from "./here.js";
import { choiceKey } from "./open-in.js";

export class TabKeys {
  command(command, cx) {
    // Only what this copy owns; track/open/toggle belong to the panel. Script keys act on the shown review tab.
    const shown = focused()?.tab === (this.myPane() ? this.myTab : null);
    if (/^(key|note|goto|paste|ask):|^forget$/.test(command) && !shown) return;
    // `review.ask:<text>`: asks about the PR in a new thread (for scripts and tests).
    if (command.startsWith("ask:")) { this.agent.select("walk", cx); this.agent.input.set_value(command.slice(4)); this.agent.send(cx); return; }
    // `review.forget`: this review's drafts, type and viewed marks go (for scripts and tests).
    if (command === "forget") return editDrafts(this.dkey, (d) => { d.notes = []; d.viewed = []; d.type = null; });
    // `review.scope:{"key": "<review>", "scope": "branch"}`: the panel's chips (and scripts) pick a scope.
    if (command.startsWith("scope:")) {
      let args = null;
      try { args = JSON.parse(command.slice(6)); } catch { /* not JSON */ }
      if (args?.key === this.dkey) this.setScope(sc.parseScopeKey(args.scope), cx);
      return;
    }
    if (command === "focus") {
      // pane.go into this tab, or ⌘⌥G while it shows: then the panel takes the keyboard, not this tab.
      const pane = this.myPane();
      if (pane && focused()?.pane === pane && !panelJustFocused()) this.takeKeys(cx);
      // Back on the tab: one cheap check whether the PR moved on (nothing is generated).
      this.refreshIfMoved(cx);
    } else if (command.startsWith("dryrun")) {
      edit((s) => { s.dryRun = command !== "dryrun:off"; });
    } else if (command.startsWith("key:")) {
      // `key:j`, `key:J`, `key:ctrl-alt-enter`.
      const parts = command.slice(4).split(/-(?=.)/);
      const k = parts.pop();
      const one = k.length === 1;
      const mods = { shift: one && k !== k.toLowerCase(), control: parts.includes("ctrl"), alt: parts.includes("alt") };
      this.key({ key: one ? k.toLowerCase() : k, modifiers: mods }, cx);
    } else if (command.startsWith("note:") && this.rows.length) {
      // `review.note:<text>` writes a note at the cursor, for scripts and tests.
      this.annotate();
      if (this.pending) { this.composer.set_value(command.slice(5)); this.saveNote(cx); }
    } else if (command.startsWith("paste:")) {
      // `review.paste:<terminal>` pastes the notes there without Enter (Agent review), as the picker does.
      if (this.type() !== "agent") return this.say("PR review: m switches to Agent review");
      if (!this.notes().length) return this.say("No notes yet");
      const address = command.slice(6);
      this.pasteTo({ address, program: { name: address } }, cx);
    } else if (command.startsWith("goto:")) {
      // `review.goto:<path>:<line>` puts the cursor on a new-side line.
      const [path, line] = command.slice(5).split(/:(?=\d+$)/);
      const at = this.where?.get(`${path}|RIGHT|${Number(line)}`);
      if (at !== undefined) { this.cursor = at; this.reveal = { row: at, center: true }; } else this.say(`No line ${path}:${line} in this diff`);
    }
  }

  modalKey(k, mods, cx) {
    const m = this.modal;
    if (this.summaryTyping) {
      // The summary box types; esc gives the keys back to the drawer.
      if (k !== "escape") return false;
      this.summaryTyping = false;
      this.handle.focus();
      return true;
    }
    if (m.kind === "palette") {
      if (k === "escape") { this.modal = null; this.handle.focus(); return true; }
      const list = this.paletteList();
      if (k === "down" || (mods.control && k === "n")) m.at = Math.min(list.length - 1, m.at + 1);
      else if (k === "up" || (mods.control && k === "p")) m.at = Math.max(0, m.at - 1);
      else if (k === "enter") { const a = list[m.at]; this.modal = null; this.handle.focus(); this.dirty = null; if (a) a.run(cx); }
      else return false; // typing goes to the filter
      return true;
    }
    if (k === "escape") { this.modal = null; this.handle.focus(); return true; }
    if (m.kind === "drawer") {
      if (k === "S") { this.modal = null; return true; }
      if (this.type() === "pr") {
        const i = EVENTS.findIndex((e) => e[0] === m.event);
        if (["1", "2", "3"].includes(k)) m.event = EVENTS[Number(k) - 1][0];
        else if (k === "j" || k === "down" || k === "tab") m.event = EVENTS[(i + 1) % EVENTS.length][0];
        else if (k === "k" || k === "up") m.event = EVENTS[(i + EVENTS.length - 1) % EVENTS.length][0];
        else if (k === "i" || k === "e") cx.timer.after(0, () => this.summary.focus());
        else if (k === "enter") this.submit(cx);
      } else {
        const list = this.agentList();
        if (k === "j" || k === "down") m.at = Math.min(list.length - 1, m.at + 1);
        else if (k === "k" || k === "up") m.at = Math.max(0, m.at - 1);
        else if (k === "enter") this.pasteTo(list[m.at], cx);
        else if (k === "a" && this.otherAgents()) { m.allSpaces = !m.allSpaces; m.at = Math.min(m.at, Math.max(0, this.agentList().length - 1)); }
      }
      if (k === "m") this.setType(this.type() === "pr" ? "agent" : "pr");
      return true;
    }
    if (m.kind === "keys") { if (k === "?" || k === "q" || k === "enter") this.modal = null; return true; }
    if (m.kind === "close") {
      if (k === "y" || k === "enter") { this.modal = null; this.closeTab(); }
      else if (k === "n") this.modal = null;
      return true;
    }
    return false;
  }

  /** Tab: files → diff → agent → files (a folded column is skipped). */
  cycleFocus() {
    const order = ["files", "diff", "agent"].filter((c) => !(c === "files" && store().filesFolded) && !(c === "agent" && this.agent.folded()));
    const next = order[(order.indexOf(this.focus) + 1) % order.length];
    this.focus = next;
    this.agent.focused = next === "agent";
    this.agent.typing = false;
    if (next === "files") { const list = this.fileRows(); this.fileCursor = Math.max(0, list.findIndex((n) => !n.dir && !n.group && n.index === this.fileAt(this.cursor))); }
    this.handle.focus();
  }

  /** The drawer: drafts, verdict or agent, summary. S opens it in both review types. */
  openDrawer() {
    this.modal = { kind: "drawer", event: this.fresh().length ? "COMMENT" : "APPROVE", at: 0 };
  }

  /** Every action by name, with its key (⌘K). */
  actions() {
    const a = this.agent, pr = this.type() === "pr";
    const act = (name, key, run) => ({ name, key, run });
    return [
      act("Ask about the selected lines", "i", (cx) => a.askLines(this.rangeOf(...(this.selection() ?? [this.cursor, this.cursor])), cx)),
      act("Write a review note", "a", () => this.annotate()),
      act(pr ? "Review drawer: submit to GitHub" : "Review drawer: send to an agent", "S", () => this.openDrawer()),
      act("Switch PR review / agent review", "m", () => this.setType(pr ? "agent" : "pr")),
      act("Regenerate the walkthrough", "r", (cx) => a.regenerate(cx)),
      act("Previous walkthrough version", "u", (cx) => a.flip(-1, cx)),
      act("Next walkthrough version", "U", (cx) => a.flip(1, cx)),
      act("Next hunk", "n", (cx) => this.nextHunk(1, cx)),
      act("Previous hunk", "N", (cx) => this.nextHunk(-1, cx)),
      act("Next file", "J", () => this.nextFile(1)),
      act("Previous file", "K", () => this.nextFile(-1)),
      act("Unified / split diff", "s", () => this.toggleSplit()),
      act("File order: reading order / folders", "o", () => this.toggleOrder()),
      act("Agent panel: show or focus", "w", (cx) => a.show(cx)),
      act("Fold the file list", "[", () => this.foldFiles()),
      act("Fold the Agent panel", "]", () => a.fold()),
      act("Open the line in Neovim", "e", (cx) => this.edit(cx)),
      act("Open in…: the file at the cursor in an editor", "O", (cx) => this.openWith(this.fileAt(this.cursor), cx)),
      act("Mark the file viewed", "V", () => this.toggleViewed(this.fileAt(this.cursor))),
      act("Drop stale drafts", "X", () => this.dropStale()),
      act("Reload", "R", (cx) => { this.load(cx); run("review.refresh"); }),
      ...(this.meta?.url ? [act("Open the PR in the browser", "", () => openUrl(this.meta.url))] : []),
      ...this.scopeActions(act),
      ...this.agent.installed?.map((id) => act(`Agent: use ${id === "claude" ? "Claude" : id === "codex" ? "Codex" : "OpenCode"}`, "", () => a.setProvider(id))) ?? [],
      act("Key sheet", "?", () => { this.modal = { kind: "keys" }; }),
      act("Close the review", "q", () => { if (this.notes().length) this.modal = { kind: "close" }; else this.closeTab(); }),
    ];
  }

  paletteList() {
    const q = String(this.palette?.value() ?? "").trim().toLowerCase();
    const all = this.actions();
    if (!q) return all;
    const words = q.split(/\s+/);
    return all.filter((x) => words.every((w) => x.name.toLowerCase().includes(w) || x.key.toLowerCase() === w));
  }

  openPalette(cx) {
    if (!this.palette) {
      this.palette = TextareaState.new({ placeholder: "Type an action…", rows: 1 });
      this.palette.on("change", (_e, cx) => { if (this.modal?.kind === "palette") this.modal.at = 0; this.redraw(cx, []); });
      this.palette.on("submit", (_e, cx) => { const a = this.paletteList()[this.modal?.at ?? 0]; this.modal = null; this.handle.focus(); if (a) a.run(cx); this.redraw(cx); });
    }
    this.palette.set_value("");
    this.modal = { kind: "palette", at: 0 };
    cx.timer.after(0, () => this.palette.focus());
  }

  foldFiles() { edit((st) => { st.filesFolded = !st.filesFolded; }); if (store().filesFolded && this.focus === "files") this.focus = "diff"; }

  toggleOrder() { edit((st) => { st.fileOrder = st.fileOrder === "folders" ? "reading" : "folders"; }); this.fileScroll.top = 0; this.treeKey = null; }

  filesKey(k, cx) {
    const list = this.fileRows();
    switch (k) {
      case "j": case "down": case "k": case "up": {
        const d = k === "j" || k === "down" ? 1 : -1;
        let at = this.fileCursor;
        do at += d; while (at >= 0 && at < list.length && list[at].group);
        if (at >= 0 && at < list.length) this.fileCursor = at;
        this.followed = null;
        this.dirty = ["files"];
        return true;
      }
      case "enter": case "l": case "right": {
        const n = list[this.fileCursor];
        if (!n || n.group) return true;
        if (n.dir) { if (this.closedDirs.has(n.path)) this.closedDirs.delete(n.path); else this.closedDirs.add(n.path); this.fileRowsKey = null; return true; }
        this.goFile(n.index);
        if (k === "enter") { this.focus = "diff"; }
        return true;
      }
      case "escape": this.focus = "diff"; return true;
    }
    return null;
  }

  key(e, cx, { fromAgent = false } = {}) {
    const mods = e.modifiers ?? {};
    const a = this.agent;
    if (mods.platform && e.key === "k" && !this.pending) { this.openPalette(cx); return true; }
    if (!fromAgent && (a.typing || a.renaming) && !this.modal && !this.pending) return a.key(e, cx);
    if (!fromAgent && this.focus === "agent" && !a.folded() && !this.modal && !this.pending) return a.key(e, cx);
    if (mods.control && mods.alt && !mods.platform && e.key === "enter" && !this.modal && !this.pending) {
      this.openWith(this.fileAt(this.cursor), cx);
      return true;
    }
    // The palette, the picker and the base menu are the tab's own: their keys redraw no column.
    if (this.modal?.kind === "palette") { this.dirty = []; return this.modalKey(e.key, mods, cx); }
    if (this.openChoice && !this.modal) { this.dirty = []; return choiceKey(this, e, cx); }
    if (this.picker) { this.dirty = []; return this.pickerKey(e, cx); }
    if (this.baseMenu) { this.dirty = []; return this.baseKey(e, cx); }
    if (mods.platform || mods.control || mods.alt) return false;
    let k = e.key;
    if (mods.shift && /^[a-z]$/.test(k)) k = k.toUpperCase();
    if (mods.shift && k === "/") k = "?";
    if (this.modal) return this.modalKey(k, mods, cx);
    if (this.pending) {
      if (k === "escape") { this.cancelNote(cx); return true; }
      return false;
    }
    this.flash = null;
    if (this.focus === "files") { const r = this.filesKey(k, cx); if (r !== null) return r; }
    const fileBefore = this.fileAt(this.cursor);
    const motion = () => { this.dirty = this.movedCols(fileBefore); };
    switch (k) {
      case "w": a.show(cx); break;
      case "i": a.askLines(this.rangeOf(...(this.selection() ?? [this.cursor, this.cursor])), cx); this.anchor = null; break;
      case "tab": this.cycleFocus(); break;
      case "[": this.foldFiles(); break;
      case "]": a.fold(); break;
      case "r": a.regenerate(cx); break;
      case "n": this.nextHunk(1, cx); break;
      case "N": this.nextHunk(-1, cx); break;
      case "o": this.toggleOrder(); break;
      case "O": this.openWith(this.fileAt(this.cursor), cx); break;
      case "j": case "down": this.move(1); motion(); break;
      case "k": case "up": this.move(-1); motion(); break;
      case "J": this.nextFile(1); motion(); break;
      case "K": this.nextFile(-1); motion(); break;
      case "pagedown": case "space": this.move(this.page()); motion(); break;
      case "pageup": this.move(-this.page()); motion(); break;
      case "g": case "home": this.move(-Infinity); motion(); break;
      case "G": case "end": this.move(Infinity); motion(); break;
      case "v": this.anchor = this.anchor === null ? this.cursor : null; motion(); break;
      case "a": this.annotate(); break;
      case "d": { const n = this.notesAtCursor().at(-1); if (n) this.deleteNote(n); else this.say("No draft on this line"); break; }
      case "enter": {
        const n = this.notesAtCursor().at(-1), th = this.threadsAtCursor()[0];
        const chip = a.chips().find((x) => this.rowFor(x.anchor.path, x.anchor.side, x.anchor.line) === this.cursor);
        if (n) this.editNote(n);
        else if (chip) { a.select(chip.id, cx); a.show(cx); }
        else if (th) this.toggleThread(th);
        else if (this.rows[this.cursor]?.k === "file") this.toggleFold(this.fileAt(this.cursor));
        else this.annotate();
        break;
      }
      case "s": this.toggleSplit(); break;
      case "X": this.dropStale(); break;
      case "?": this.modal = { kind: "keys" }; break;
      case "1": case "2": this.pickSegment(Number(k), cx); break;
      case "3": this.openPicker(cx); break;
      case "B": this.openBaseMenu(cx); break;
      case "h": case "left": case "l": case "right": {
        if (!this.split()) { this.say("h/l pick a side in the split view (s)"); break; }
        this.side = k === "h" || k === "left" ? "left" : "right";
        const sr = this.splitRows()[this.srowOf[this.cursor]];
        if (sr && sr.only === undefined) this.cursor = this.pick(this.srowOf[this.cursor]);
        motion();
        break;
      }
      case "V": this.toggleViewed(this.fileAt(this.cursor)); break;
      case "e": this.edit(cx); break;
      case "m": this.setType(this.type() === "pr" ? "agent" : "pr"); break;
      case "S": this.openDrawer(); break;
      case "R": this.load(cx); run("review.refresh"); break;
      case "q": if (this.notes().length) this.modal = { kind: "close" }; else this.closeTab(); break;
      case "escape": if (this.anchor !== null) this.anchor = null; else run("pane.go", { direction: "left" }); break;
      default: return k.length === 1;
    }
    return true;
  }

  down(i, e, cx) {
    const fileBefore = this.fileAt(this.cursor), extra = this.agent.focused || this.focus === "agent" ? ["agent"] : [];
    this.agent.focused = false;
    this.focus = "diff";
    if (e.modifiers?.control && e.modifiers?.alt) {
      this.cursor = i;
      this.openWith(this.fileAt(i), cx);
      return this.redraw(cx);
    }
    this.handle.focus();
    this.flash = null;
    if (this.pending) return;
    this.cursor = i;
    if (e.click_count >= 2) {
      // A double click writes a note on the line; only e opens Neovim.
      this.anchor = null;
      this.dragging = false;
      this.annotate();
      return this.redraw(cx);
    }
    if (!e.modifiers?.shift || this.anchor === null) this.anchor = i;
    this.dragging = true;
    this.redraw(cx, this.movedCols(fileBefore, extra));
  }

  over(i, cx) {
    if (!this.dragging || this.cursor === i || this.fileAt(i) !== this.fileAt(this.anchor ?? i)) return;
    this.cursor = i;
    this.redrawCol("diff", cx);
  }

  up(cx) {
    this.agent.dragEnd();
    if (this.filesDrag) { this.filesDrag = null; const w = Math.round(this.filesDragWidth ?? this.filesWidth()); this.filesDragWidth = null; edit((st) => { st.filesWidth = w; }); }
    if (!this.dragging) return;
    this.dragging = false;
    if (this.anchor === this.cursor) this.anchor = null;
    this.redrawCol("diff", cx);
  }
}
