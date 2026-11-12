// The Agent panel's keys: the walkthrough (steps, excerpts, picked lines) and a thread (answers).
import { excerptsOf } from "./walkthrough-model.mjs";

export class AgentKeys {
  key(e, cx) {
    const mods = e.modifiers ?? {};
    const k = mods.shift && /^[a-z]$/.test(e.key) ? e.key.toUpperCase() : mods.shift && e.key === "/" ? "?" : e.key;
    if (this.renaming) { if (k === "escape") { this.renaming = null; this.owner.handle.focus(); return true; } return false; }
    if (this.typing) {
      if (k === "escape") { if (this.running) this.cancel(cx); this.typing = false; this.owner.handle.focus(); return true; }
      return false;
    }
    if (mods.control && k === "c") { this.cancel(cx); return true; }
    if (mods.control && k === "w") { if (this.tab !== "walk") this.closeThread(this.tab, cx); return true; }
    if (mods.control || mods.alt || mods.platform) return false;
    // An error never swallows a key: any key clears it, and Esc only clears it.
    if (this.error) { this.error = null; if (k === "escape") return true; }
    const tabs = this.tabs();
    if (/^[1-9]$/.test(k)) { const id = tabs[Number(k) - 1]; if (id) this.select(id, cx); return true; }
    switch (k) {
      case "escape":
        if (this.running) this.cancel(cx);
        else if (this.lineSel) this.lineSel = null;
        else this.focusDiff();
        return true;
      case "[": case "]": { const at = tabs.indexOf(this.tab); this.select(tabs[(at + (k === "]" ? 1 : tabs.length - 1)) % tabs.length], cx); return true; }
      case "tab": this.owner.cycleFocus(); return true;
      case "w": this.focusDiff(); return true;
      case "r": this.regenerate(cx); return true;
      case "x": if (this.tab !== "walk") this.closeThread(this.tab, cx); return true;
      case "f2": this.startRename(); return true;
      case "?": this.owner.modal = { kind: "keys" }; return true;
      case "S": case "m": case "o": case "s": return this.owner.key(e, cx, { fromAgent: true });
    }
    return this.tab === "walk" ? this.walkKey(k, cx) : this.threadKey(k, cx);
  }

  walkKey(k, cx) {
    const steps = this.steps();
    const refs = excerptsOf(steps[this.step] ?? {});
    const ls = this.lineSel;
    switch (k) {
      case "j": case "down": case "k": case "up": {
        const d = k === "j" || k === "down" ? 1 : -1;
        if (ls) { ls.b = Math.max(0, Math.min(ls.nums.length - 1, ls.b + d)); this.owner.dirty = ["agent"]; break; }
        this.step = Math.max(0, Math.min(steps.length - 1, this.step + d));
        this.picked = true;
        this.link = -1;
        this.revealStep = true;
        break;
      }
      case "h": case "left": case "l": case "right":
        this.lineSel = null;
        this.link = Math.max(-1, Math.min(refs.length - 1, this.link + (k === "l" || k === "right" ? 1 : -1)));
        this.revealLink = true;
        this.owner.dirty = ["agent"];
        break;
      case "v": {
        // Lines inside the focused excerpt: v starts, j/k extend, i asks about them.
        if (ls) { this.lineSel = null; break; }
        const ref = refs[this.link];
        const view = ref && this.planOf(ref.refs, `s${this.step}-e${this.link}`);
        if (view) { const first = view.plan.items.findIndex((x) => x.hot); this.lineSel = { key: `s${this.step}-e${this.link}`, ref, nums: view.nums, a: Math.max(0, first), b: Math.max(0, first) }; }
        break;
      }
      case "enter": {
        if (!this.version()) { this.regenerate(cx); break; }
        if (this.stale() && !this.showAnyway) { this.showAnyway = true; break; }
        const ref = refs[Math.max(0, this.link)];
        if (ref) this.navigate(ref, cx);
        break;
      }
      case "i": this.askHere(cx); break;
      case "t": { const th = this.threads().find((t) => t.anchor.step === this.step); if (th) this.select(th.id, cx); break; }
      case "u": this.flip(-1, cx); break;
      case "U": this.flip(1, cx); break;
      case "space": case "pagedown": this.scroll.top += this.scroll.height * 0.8; this.scroll.clamp(); break;
      case "pageup": this.scroll.top -= this.scroll.height * 0.8; this.scroll.clamp(); break;
      case "g": case "home": this.scroll.top = 0; break;
      case "G": case "end": this.scroll.top = this.scroll.total(); this.scroll.clamp(); break;
      default: return true; // letters here must not turn into review comments or submissions
    }
    return true;
  }

  threadKey(k, cx) {
    const th = this.thread();
    if (!th) return true;
    switch (k) {
      case "j": case "down": case "k": case "up": {
        const answers = th.entries.map((e, i) => (e.role === "answer" ? i : -1)).filter((i) => i >= 0);
        if (!answers.length) break;
        const at = answers.indexOf(this.entry);
        const next = at < 0 ? (k === "k" || k === "up" ? answers.at(-1) : answers[0]) : answers[Math.max(0, Math.min(answers.length - 1, at + (k === "j" || k === "down" ? 1 : -1)))];
        this.entry = next;
        this.revealEntry = true;
        this.owner.dirty = ["agent"];
        break;
      }
      case "i": this.input.focus(); break;
      case "c": this.noteFromAnswer(cx); break;
      case "enter": if (th.anchor.path) this.navigate(th.anchor, cx); else if (th.anchor.step != null) { this.select("walk", cx); this.step = th.anchor.step; this.revealStep = true; } break;
      case "space": case "pagedown": this.scroll.top += this.scroll.height * 0.8; this.scroll.clamp(); break;
      case "pageup": this.scroll.top -= this.scroll.height * 0.8; this.scroll.clamp(); break;
      case "g": case "home": this.scroll.top = 0; break;
      case "G": case "end": this.scroll.top = this.scroll.total(); this.scroll.clamp(); break;
      default: return true;
    }
    return true;
  }
}
