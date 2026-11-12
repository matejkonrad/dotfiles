// Asking the agent: which CLI, new threads, and one read-only request at a time through agent-runner.mjs.
import { appHome, exec, home, readTextFile } from "herdr";
import * as fs from "fs/promises";
import { clone } from "./util.mjs";
import { checkoutOf, edit, store } from "./store.js";
import { MAX_ENTRIES, MAX_VERSIONS, excerptRows, excerptsOf, newId, recentEntries, threadTitle, validateWalkthrough } from "./walkthrough-model.mjs";
import { PROVIDERS, codexDefaults, pickProvider, providerOf } from "./providers.mjs";
import { DATA, emptyRecord } from "./agent-record.js";

const RUNNER = () => `${appHome()}/mods/review/agent-runner.mjs`;
// exec's cap is 600 s; the runner gets a deadline before it, so it stops its agent itself and answers.
const HOST_TIMEOUT = 600_000;
const RUN_BUDGET = 570_000;

export class AgentRequests {
  /** Which agent CLIs are installed (once per panel), and Codex's model from its config. */
  detect(cx) {
    if (this.detecting) return;
    this.detecting = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("/bin/sh", ["-lc", `for p in ${PROVIDERS.map((p) => p.bin).join(" ")}; do command -v "$p" >/dev/null 2>&1 && echo "$p"; done`]);
        this.installed = PROVIDERS.filter((p) => r.stdout.split("\n").includes(p.bin)).map((p) => p.id);
      } catch { this.installed = []; }
      try { this.models.codex = codexDefaults(await readTextFile(`${home()}/.codex/config.toml`)).model ?? null; } catch { /* no config */ }
      this.kick(cx);
    });
  }

  provider() {
    if (store().agentProviderOverride) return store().agentProviderOverride; // tests and fixtures
    return this.installed ? pickProvider(store().agentProvider ?? null, this.installed) : null;
  }

  providerName() { return providerOf(this.provider())?.name ?? "No agent"; }

  model() {
    const id = this.provider();
    return store().agentModel?.[id] ?? (id === "codex" ? this.models.codex : null) ?? null;
  }

  setProvider(id) { edit((st) => { st.agentProvider = id; }); this.providerMenu = false; }

  /**
   * i: a new thread tab tied to `anchor` (lines: {path, side, start_line, line}; or a step: {step}), and the
   * keyboard in its input. Nothing runs before a question is sent.
   */
  ask(anchor, cx) {
    if (!anchor) return;
    this.snapshot();
    if (!this.comparisonKey) cx.spawn(async (cx) => { const key = await this.keyOf(cx); for (const t of this.drafts) t.anchor.comparisonKey ??= key; });
    if (anchor.path) {
      const f = this.owner.files.find((x) => x.path === anchor.path);
      const rows = excerptRows(anchor, this.owner.files) ?? [];
      anchor = { ...anchor, snippet: rows.map((i) => f.rows[i].text ?? "") };
    }
    const th = { id: newId("t"), title: "New question", at: Date.now(), readAt: Date.now(), entries: [], anchor: { ...anchor, comparisonKey: this.comparisonKey } };
    this.drafts.push(th);
    if (this.folded()) edit((st) => { st.agentFolded = false; });
    this.select(th.id, cx);
    this.focused = true;
    this.owner.focus = "agent";
    this.input.set_value("");
    this.input.focus();
    this.owner.redraw(cx);
  }

  /** i from the diff: the selection (or the cursor line). */
  askLines(range, cx) {
    if (!range) return this.owner.say("Put the cursor on a line (or select lines with v), then i");
    this.ask({ path: range.path, side: range.side, start_line: range.start_line ?? range.line, line: range.line }, cx);
  }

  /** i in the walkthrough: the picked lines of an excerpt, the focused excerpt, the picked step, else the PR. */
  askHere(cx) {
    if (this.lineSel && !this.lineSel.dragging) {
      const s = this.lineSel;
      const [a, b] = [Math.min(s.a, s.b), Math.max(s.a, s.b)];
      const nums = s.nums.slice(a, b + 1).filter((n) => n != null);
      if (nums.length) return this.ask({ path: s.ref.path, side: s.ref.side, start_line: nums[0], line: nums.at(-1) }, cx);
    }
    const ref = this.link >= 0 ? excerptsOf(this.steps()[this.step] ?? {})[this.link] : null;
    if (ref) return this.ask({ ...ref }, cx);
    if (this.steps().length && this.picked) return this.ask({ step: this.step }, cx);
    return this.ask({ pr: true }, cx);
  }

  send(cx) {
    const question = String(this.input.value() ?? "").trim();
    if (!question || this.running) return;
    if (this.tab === "walk") {
      // The walkthrough tab's input asks about the PR (the picked step or excerpt, if any), in a new thread.
      this.walkInput.set_value("");
      this.askHere(cx);
      this.input.set_value(question);
    }
    const th = this.thread();
    if (!th) return;
    if (this.threadStale(th)) { this.error = "The lines of this thread changed after a push. Start a new thread on the new lines."; this.redraw(cx); return; }
    this.request({ action: "ask", thread: th.id, question }, cx);
  }

  regenerate(cx) {
    if (this.running) return;
    this.error = null;
    this.showAnyway = false;
    this.request({ action: "generate" }, cx);
    this.redraw(cx);
  }

  /** One agent request at a time; its tab shows the progress line, and Esc cancels it. */
  request(job, cx) {
    if (this.running || this.owner.pending || this.owner.modal) return;
    const provider = this.provider();
    if (!provider) { this.error = this.installed ? "No agent CLI found. Install Claude Code, Codex or OpenCode." : "Looking for agent CLIs. Try again in a moment."; this.redraw(cx); return; }
    this.running = { ...job, tab: job.thread ?? "walk", provider, startedAt: Date.now() };
    this.error = null;
    this.cancelled = false;
    this.typing = false;
    this.owner.handle.focus();
    if (job.question) { this.input.set_value(""); this.revealBottom = true; }
    // The elapsed time and what the agent does now (the runner's .progress file): one redraw a second.
    const running = this.running;
    cx.spawn(async (cx) => {
      while (this.running === running && !this.closed) {
        await cx.sleep(1000);
        if (this.running !== running) break;
        if (this.requestFile) running.doing = (await readTextFile(`${this.requestFile}.progress`).catch(() => null))?.trim() || running.doing;
        // Only the panel shows the time: it alone redraws.
        this.owner.redrawCol("agent", cx);
      }
    });
    const at = this.target();
    cx.spawn(async (cx) => {
      let requestFile, saved = false, answered = false;
      try {
        // Fresh refs and diff before every request; an old comparison is never reused silently.
        await this.owner.load(cx);
        if (this.owner.error) throw new Error(this.owner.error);
        if (this.cancelled) throw new Error("Cancelled");
        if (!this.owner.files.length) throw new Error("There are no changes to explain.");
        const space = this.owner.space();
        if (!space) throw new Error("This tab's space is gone.");
        const where = await checkoutOf(space, this.owner.local ? {} : { repo: this.owner.ref.repo });
        if (this.cancelled) throw new Error("Cancelled");
        if (!where || where.on) throw new Error("The agent needs a local checkout of this repository on this computer.");
        const key = await this.keyOf(cx), snap = await this.fullComparison(cx);
        if (this.cancelled) throw new Error("Cancelled");
        const th = job.thread ? clone(this.thread(job.thread)) : null;
        if (th && this.threadStale(th)) throw new Error("The lines of this thread changed after a push.");
        const question = job.question ? { id: newId("e"), role: "question", body: job.question, at: Date.now() } : null;
        const walk = this.walk();
        const session = th?.sessions?.[provider] ? { provider, id: th.sessions[provider] } : null;
        const thread = th ? { title: th.title, anchor: { ...th.anchor, ...(th.anchor.step != null && walk ? { stepContent: walk.steps[th.anchor.step] ?? null } : {}) },
          ...recentEntries([...th.entries, question]) } : null;
        const request = { action: job.action, provider, model: store().agentModel?.[provider] ?? null, root: where.root, data: DATA(), comparison: snap,
          title: this.owner.meta.title, description: this.owner.meta.description ?? "", pr: this.owner.ref ?? null,
          walkthrough: walk, thread, session, message: job.question ?? "", deadline: Date.now() + RUN_BUDGET };
        await fs.mkdir(`${DATA()}/requests`, { recursive: true });
        requestFile = `${DATA()}/requests/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
        this.requestFile = requestFile;
        await fs.writeFile(requestFile, JSON.stringify(request));
        if (this.cancelled) throw new Error("Cancelled");
        const r = await exec("node", [RUNNER(), requestFile], { timeout: HOST_TIMEOUT });
        answered = true;
        let result;
        try { result = JSON.parse(r.stdout); } catch { throw new Error("The agent runner returned no answer."); }
        if (result.error || r.code) throw new Error(result.error || `The agent runner stopped (exit ${r.code}).`);
        // Read the diff again before applying: a push meanwhile must not attach old answers to new code.
        await this.owner.load(cx);
        if (this.owner.error) throw new Error(`Couldn't check the diff after the answer: ${this.owner.error}`);
        if (this.cancelled) throw new Error("Cancelled");
        if (await this.keyOf(cx) !== key) throw new Error("The diff changed while the agent was working. Ask again for the new diff.");
        if (!this.isCurrent(at)) throw new Error("The review switched to another scope while the agent was working. Ask again.");
        const record = clone(this.record ?? emptyRecord());
        if (result.walkthrough) {
          const v = { id: newId("v"), at: Date.now(), comparisonKey: key, provider, walkthrough: validateWalkthrough(result.walkthrough, this.owner.files) };
          record.versions = [...record.versions, v].slice(-MAX_VERSIONS);
          record.current = v.id;
        }
        if (th) {
          const answer = { id: newId("e"), role: "answer", blocks: result.answer ?? [], at: Date.now(), provider };
          const shown = this.tab === th.id && !this.folded();
          let saved = record.threads.find((t) => t.id === th.id);
          if (!saved) { saved = { ...th, entries: [], title: threadTitle(job.question) }; record.threads.push(saved); this.drafts = this.drafts.filter((t) => t.id !== th.id); }
          saved.entries = [...saved.entries, question, answer].filter(Boolean).slice(-MAX_ENTRIES);
          if (result.session?.id) saved.sessions = { ...(saved.sessions ?? {}), [provider]: result.session.id };
          if (shown) saved.readAt = Date.now() + 1;
        }
        record.at = Date.now();
        await this.save(record, at);
        if (job.action === "generate") { this.step = 0; this.link = -1; }
        this.revealBottom = Boolean(th);
        saved = true;
      } catch (e) {
        this.error = String(e?.message ?? e);
        if (job.question && !String(this.input.value() ?? "").trim()) this.input.set_value(job.question); // nothing typed is lost
      } finally {
        this.running = null;
        this.requestFile = null;
        // No answer (the exec timed out or failed): the runner may still run, so it is told to stop.
        if (requestFile && !answered) await fs.writeFile(`${requestFile}.cancel`, "cancel").catch(() => {});
        if (requestFile) await fs.unlink(requestFile).catch(() => {});
        this.kick(cx, { announce: saved });
      }
    });
    this.owner.redraw(cx);
  }

  cancel(cx) {
    if (!this.running) return;
    this.cancelled = true;
    const file = this.requestFile;
    if (file) cx.spawn(async (cx) => { await fs.writeFile(`${file}.cancel`, "cancel").catch(() => {}); this.redraw(cx); });
    this.redraw(cx);
  }
}
