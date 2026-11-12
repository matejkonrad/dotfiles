// Opening the diff's files elsewhere: Neovim at the line, a commit's version read-only, Open in… (the open-with picker).
import { exec, run } from "herdr";
import * as sc from "./scopes.mjs";
import { resolveCheckout } from "./checkout.js";
import { openFolder, withCheckout } from "./open-in.js";

export class TabEditor {
  /**
   * Calls `then({root, on})` with the checkout that has this diff's code: the local diff's root, or a checkout
   * of the PR's repo on its head branch (this space first, then every other space and worktree). With none on
   * the branch, the tab shows the Open in choice (clones, a new worktree) and `then` runs once one is picked.
   */
  withCode(then, cx) {
    const space = this.space();
    if (!space) return this.say("This tab's space is gone");
    if (this.local) {
      if (!this.meta?.root) return this.say(`No checkout in ${space.name}`);
      return then({ root: this.meta.root, on: space.machine ?? null });
    }
    cx.spawn(async (cx) => {
      try {
        await withCheckout(this, { space, repo: this.ref.repo, head: this.meta?.head ?? null, number: this.ref.number }, (at) => then(at), (cx) => this.redraw(cx), cx);
      } catch (e) {
        this.say(`Open: ${e?.message ?? e}`);
      }
      this.redraw(cx);
    });
  }

  /** e: the file at the cursor line in Neovim, in a new tab of this space. */
  edit(cx) {
    const row = this.rows[this.cursor];
    const file = row && this.files[row.f];
    if (!file) return;
    const line = row.k === "file" ? 1 : this.lineAt(this.cursor);
    if (sc.isCommits(this.scope)) return this.showPast(file, line, cx);
    if (file.status === "removed") return this.say(`${file.path} is deleted in this diff`);
    this.withCode((at) => run("tab.new", { space: this.p.space, folder: at.root, argv: ["nvim", `+${line}`, "--", file.path], name: file.path.split("/").pop() }), cx);
  }

  /**
   * e in a commits scope: the file as the newest commit has it, read-only in Neovim (`git show <sha>:<path>`):
   * the working tree may hold other code, so any clone of the repo does.
   */
  showPast(file, line, cx) {
    if (file.status === "removed") return this.say(`${file.path} is deleted in this commit`);
    const sha = this.scope.to;
    cx.spawn(async (cx) => {
      const space = this.space();
      const at = this.local ? (this.meta?.root ? { root: this.meta.root, on: this.info?.on ?? null } : null)
        : space && (await resolveCheckout({ space, repo: this.ref.repo }).catch(() => null))?.exact;
      if (!at) this.say(`No clone of ${this.local ? "this repository" : this.ref.repo} on this computer`);
      else if ((await exec("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: at.root, on: at.on }).catch(() => ({ code: 1 }))).code !== 0) this.say(`${sha.slice(0, 7)} is not in your checkout: git fetch, then e again`);
      else {
        run("tab.new", { space: this.p.space, folder: at.root, argv: sc.showArgv(sha, file.path, line), name: `${file.path.split("/").pop()} @ ${sha.slice(0, 7)}` });
        this.say(`Read-only: ${file.path} as ${sha.slice(0, 7)} has it. Your working tree may differ.`);
      }
      this.redraw(cx);
    });
  }

  /**
   * O, the top bar's Open in…, Ctrl+Alt+Enter, Ctrl+Alt+click: the open-with picker for file f, or for the
   * checkout's folder (f null, or a deleted file).
   */
  openWith(f, cx) {
    const file = f === null || f === undefined ? null : this.files[f];
    if (sc.isCommits(this.scope)) return this.say("Open in opens the working tree: e shows this commit's version read-only");
    const path = file && file.status !== "removed" ? file.path : null;
    this.withCode((at) => openFolder(at, path), cx);
  }
}
