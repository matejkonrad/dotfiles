# Herdr review

The `review` mod for the Herdr app. It has three parts:

- A side panel with your tracked PRs.
- A review tab with the files, the diff, your draft notes and the GitHub threads.
- An Agent panel. It writes a walkthrough of the change and answers your questions about the PR. Only your request starts an agent.

## Open a review

`Cmd+R` runs `review.here`. It acts at once: it calls no git, gh or file before the tab switches.

- If a review tab of this space has the focus, it goes back to the tab before it.
- If this space has a review tab, it selects that tab.
- Otherwise it opens a new review tab at once. The tab shows its loading state and finds out by itself what to show. If the checkout is on the head branch of an open PR, it becomes that PR's review. Otherwise it shows the local changes. The PR the panel already knows for the branch is used as a hint, but nothing waits for it.

The panel's footer has a "Review ⌘R" button. It reads "Back ⌘R" while a review tab has the focus. When you fold the panel to its rail, the button is at the rail's foot. The ⌘⇧P palette lists "Review this space" too.

The key is in `~/.config/herdr-app/keys.json` (`"cmd-r": "review.here"`).

Limit: Herdr gives a command only to the copies of a mod that show. The panel handles `review.here`, also when it is folded to its rail. If you hide the panel's block in the layout, `Cmd+R` does nothing. Then add a block with `{ "mod": "review", "props": { "view": "launcher" } }`: it shows only the button and handles the key. If more than one copy shows, a shared time stamp lets only the first one act. Copies get a command within a few milliseconds, so a quick second press still counts.

## Install

This folder is the source. Do not edit `~/.config/herdr-app/mods/review` directly.

```sh
node config/herdr-app/install-review.mjs
herdr-app check ~/.config/herdr-app/mods/review
```

The installer makes the installed mod an exact copy of `mods/review`. It also writes the small `review-here` mod (the palette entry). It leaves out tests and editor files. It builds the new copy next to the old one. Then it swaps the two in one step. Herdr never loads a mix of old and new files. The old copy goes to `~/.config/herdr-app/data/review-install-backups/`. The last 3 backups stay. Your data in `~/.config/herdr-app/data/` is not touched.

The Agent panel needs `node`, `git`, `gh` (for PRs), a local checkout of the repository, and one agent CLI that is signed in: Claude Code (`claude`), Codex (`codex`) or OpenCode (`opencode`).

## Layout

The review tab has three columns: files, diff and the Agent panel. Drag a column border to change its width. Herdr keeps the widths. `[` folds the file list and `]` folds the Agent panel to a thin rail.

The file list has two orders. "Reading order" groups the files by walkthrough step. "Folders" shows the folder tree. `o` switches between them.

Split view needs 80 columns on each side. With less room, the diff shows unified, and the Split button shows a dot.

## Scopes

A scope says which changes the review shows. The control sits in the header, after the title.

| Segment | Local review | PR review |
| --- | --- | --- |
| `1` | Uncommitted: the working tree and untracked files vs `HEAD`. | All changes: the PR's diff. |
| `2` | Branch: the merge-base with the base branch vs the working tree. | Since review: the changes since your last review. |
| `3` | Commits: one commit or a range. | Commits: the same, for the PR's commits. |

- Branch shows its base: "Branch vs main ▾". Click the base (or press `B`) to pick another base. The choice stays for that checkout.
- `3` opens the commit picker. A click shows one commit. Shift+click, or Shift+↑/↓, makes a range. Space adds a commit to the range. Type to filter by subject or SHA. A dot marks a commit whose files you all viewed. "All commits" goes back to the whole branch.
- A range shows as one diff: from the parent of the oldest commit to the newest commit. The `×` on the segment goes back to the scope before.
- Since review starts at the head commit of your last submitted review. Without a review, it starts at the last commit you viewed. Without either, it stays off. It shows only the files the PR changes. If GitHub can't build that diff, a checkout of the repo in the space builds it.
- The review opens on the scope you most likely want. Local: Branch if the branch has commits ahead of its base, else Uncommitted. PR: Since review if new commits came after your review (a banner says how many), else All changes. Your last choice stays per repo until the head commit moves.
- The Local changes row in the panel shows two chips, `uncommitted +a −b` and `branch +c −d`. Each chip opens its scope.
- Each scope keeps its own walkthrough and threads. The tab title names the scope, for example "dotfiles · Branch".
- Drafts stay with the scope you wrote them in. GitHub takes a draft only if its line is in the PR's diff with the same text. Other drafts show "not postable in this scope" in the drawer and stay saved.
- A viewed mark belongs to the file and its content. The file stays viewed in every scope until it changes.
- In a commit scope, `e` opens the file as that commit has it, read-only.
- While a new scope loads, the old diff stays, dimmed. A load that takes longer than 150 ms also shows a thin bar over the diff's top edge.
- Back on the tab, the review checks in the background whether the diff moved: a PR reads its head and base, local changes read the diff again. Nothing dims. The diff on screen changes only when the new one differs, and the cursor stays on its line.

## Keys

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous line. |
| `J` / `K` | Next / previous file. |
| `n` / `N` | Next / previous hunk. If a step is selected, the step's code in order, then the next step. |
| `v` | Select lines. |
| `a` | Write a review note on the selection. |
| `i` | Ask about the selection in a new thread. In a thread: a follow-up. |
| `c` | In a thread: the answer becomes a draft note on the thread's lines. You can edit it before it saves. |
| `e` | Open the line in Neovim, in a new tab. |
| `O` or `Ctrl+Alt+Enter` | Open in…: the file at the cursor in an editor (the top bar's Open in… button too). See [Open in…](#open-in). |
| `s` | Unified / split. |
| `o` | File order: reading order / folders. |
| `w` | Show the Agent panel and give it the keyboard. |
| `Tab` | Move the keyboard: files, diff, Agent panel. |
| `[` / `]` | Fold the files / the Agent panel. In the Agent panel: previous / next tab. |
| `1` / `2` / `3` | Scope: Uncommitted or All changes / Branch or Since review / Commits. In the Agent panel: select a tab (`1` to `9`). |
| `B` | Local review: the base branch. |
| `x` or `Ctrl+W` | Close the thread. The Threads menu opens it again. |
| `F2` | Rename the thread. |
| `r` | Regenerate the walkthrough. It makes a new version and asks nothing. |
| `u` / `U` | Previous / next walkthrough version. |
| `Esc` | Cancel the running agent. Again: back to the diff. |
| `S` | The review drawer: your drafts by file, the verdict, the summary. In agent review it sends the notes to an agent. |
| `m` | PR review / agent review. |
| `?` | All keys. |
| `Cmd+K` | Every action by name, with its key. |
| `Cmd+R` | Review this space, or go back from the review (works anywhere in Herdr). |

You can also click every control. A row shows `+` under the pointer: click it to write a note there.

## Open in…

`O` in the review tab, `O` on a row of the panel, the tab's "Open in…" button, and the folder icon of a panel row under the pointer open the open-with picker on the code. `e` (Neovim) finds the code the same way (`checkout.js`).

- Local changes open their own checkout.
- A PR opens a checkout of its repository that has the PR's head branch checked out. Herdr looks in this order: the folders of the review's space, the folders of every other space and the clones under `~/.herdr/worktrees`, then `git worktree list` of every clone of that repository it found. The repository is matched by its GitHub remote. Folder facts are kept for 15 seconds.
- If no checkout has the head branch, a small choice shows: open one of the clones as it is, or make a new worktree for the head branch in `~/.herdr/worktrees/<clone>/<branch>` (`git fetch origin <head>`, or `pull/<n>/head` for a fork, then `git worktree add`). Without any clone it offers `gh repo clone` into the same place. Nothing switches the branch of an existing folder.

## The Agent panel

The first tab is the walkthrough. It is a short story of the change in reading order, with the real lines of the diff between the paragraphs. An excerpt shows the referenced lines at full contrast, with dim lines around them for context. The context comes from the hunk, and from the file itself when the hunk ends. Click a code excerpt (or press `Enter`) to open those lines in the diff. Drag over lines in an excerpt (or press `v`, then `j` / `k`) and press `i` to ask about only those lines.

Each question opens a thread tab. A thread is about the PR's code. It is tied to lines, to a walkthrough step, or to the whole PR. Its tab shows a number and a short title. A thread is one agent session: a follow-up continues the same session, so the agent keeps its context. If the session is gone, a new session gets the whole thread as context.

The diff shows a thread as a one-line chip under its lines. A dot in the gutter marks its lines. The dot uses the accent color until you read the answer. `Enter` on the line opens the thread.

The header shows the agent ("Claude ▾") and its model. Click it to switch. The panel offers only installed CLIs.

## How the agents run

Every agent runs read-only in your checkout. It can read files and search. It can also run these `git` commands: `show`, `log`, `diff`, `blame`, `grep`, `ls-files`, `cat-file` and `rev-parse`. A small `git` wrapper refuses options that write files or run programs, such as `--output` and `grep -O`. For a PR, the runner fetches the head and base commits first, because the agents have no network.

- Claude Code: `claude -p` with `--safe-mode` and `--restricted`. These turn off CLAUDE.md, skills, plugins, hooks, MCP servers and your settings files. Only `Read`, `Grep`, `Glob` and the read-only `git` commands are allowed. Everything else is denied, without a prompt.
- Codex: `codex exec` with `--ignore-user-config`, `--ignore-rules` and the read-only sandbox. Your `config.toml` is not loaded, except the model and the reasoning effort. MCP, plugins, memories, hooks and other features are off.
- OpenCode: `opencode run` with the read-only `plan` agent, and edits and web access denied. OpenCode still loads its own plugins and global `AGENTS.md`, so the panel marks it "not isolated". It is never the default. Pick it in the menu to use it.

The agent's own instructions are in `mods/review/agent-skill/SKILL.md`. It is a plain file. Edit it to change how walkthroughs and answers read. PR text is never treated as instructions.

Closing the tab or the app cancels a running agent and its whole process group.

## The panel

The panel has two tabs:

- **Space**: the Local changes row, then the PRs this space tracks: its branch's PR first, then the PRs added by hand (`+` or `i`).
- **Inbox**: your open PRs and the PRs that ask your review, in one list, grouped by what must happen next: "Your turn", "Waiting", then "Drafts" (folded). The tab's number counts only "Your turn".

Each row has two lines. Line 1: the PR's state (draft, open, merged, closed), its title, a dot for new activity, and its age. Line 2: the short name and one phrase that says what must happen next, for example "✗ 2 checks failing", "Changes requested", "Review requested", "Ready to merge", "Waiting for review" or "Draft". Only "Ready to merge" is green. Only failing checks and requested changes are red. A draft is always dim. `pr-status.mjs` holds these rules.

- A click opens the review. `space`, ⌥-click or the chevron at the left shows more: failing checks, open threads, and the buttons (Review, Fix, Auto-fix, Re-run, Seen, Untrack). The `↗` at the right opens the PR on GitHub.
- While the pointer is over the panel, no row moves: new data changes the rows in place, and they sort again when the pointer leaves.
- `?` lists the keys. `review.tab:mine` and `review.tab:requests` open the Inbox.

## Fixing a PR from the panel

A tracked PR's card has Fix (`f`) and Auto-fix (`a`). Both send the PR's failing checks and review comments to the space's agent.

- Fix shows the whole prompt in the panel first. Only Send (`Enter`) sends it. `Esc` cancels.
- Auto-fix sends new failing checks and new comments by itself, but only comments from the repo's owners, members and collaborators, and from known review bots. A comment from anyone else waits: the card says "N new from outside the repo", and Fix shows it to you before it goes.
- The prompt quotes every check name and comment as data, with a line that tells the agent they are not instructions.
- Links open in the browser only when they are `https://` links.

## Data

Everything lives in `~/.config/herdr-app/data/walkthrough/`:

- `reviews/`: one file per review. It has the walkthrough versions (the last 10) and the threads with their session ids. Two windows that save at once merge their versions, threads and answers.
- `requests/`: one file per running request. At the end of the request, the file goes. After a crash, it goes after an hour. When Herdr stops waiting (10 minutes), the runner stops its agent: it has its own deadline before that, and it stops when its request file goes.
- The records of commit scopes that nobody opened for 14 days go. Of the debug reports, the newest 20 stay.
- A record that can't be read is never overwritten silently: a copy goes next to it (`*.corrupt-<time>`), and the panel says where.

Draft notes and viewed marks are in Herdr's shared state (`review.drafts`). A review with no notes that nobody touched for 30 days goes. Each review keeps its newest 1000 viewed marks.
- `debug/`: runner errors. If an agent fails, its own log is here too.

A walkthrough is tied to the exact diff it explains. When the PR or your local changes move on, the panel says "New commits since this walkthrough". `r` regenerates. "Show anyway" shows the old one. A thread whose lines changed after a push says so. It never generates by itself.

## Files

| File | What it holds |
| --- | --- |
| `main.js` | The mod's view: picks the panel, the review tab or the launcher, and reports errors. |
| `panel.js`, `panel-view.js`, `pr-status.mjs` | The side panel: its data and commands, its view, and the rules for a row's status phrase. |
| `launcher.js`, `here.js` | The "Review ⌘R" button, and `review.here`. |
| `tab.js` | The review tab: its fields, the columns and the frame. The rest of its class is split by topic: |
| `tab-load.js` | Loading a scope's diff (local or PR), the scope switch, the background check. |
| `tab-diff.js`, `diff-model.mjs` | Rows, folds, the split view, the display list, moving the cursor. |
| `tab-drafts.js` | Drafts, viewed marks, the GitHub review and the paste into an agent. |
| `tab-keys.js`, `tab-editor.js` | Keys, commands, ⌘K actions, the pointer; Neovim and Open in…. |
| `checkout.js`, `open-in.js` | Where a PR's code is on this computer, the new worktree, and the Open in… choice. |
| `diff-view.js`, `files-view.js`, `scope-ui.js`, `tab-chrome.js` | The diff column, the file list, the scope control, and the header, footer, drawer and dialogs. |
| `agent.js` | The Agent panel. Its class is split the same way: `agent-record.js` (saved record), `agent-request.js` (asking the agent), `agent-threads.js`, `agent-keys.js`, `excerpt.js`, `agent-view.js`. |
| `agent-runner.mjs`, `providers.mjs`, `walkthrough-model.mjs` | The runner process, the agent CLIs, and the record's data rules. |
| `store.js` | Shared state. Inside one frame, each key is read once (`inFrame`, `read`): reading shared state copies all of it. |
| `ui.js`, `util.mjs`, `style.js`, `tab-metrics.js` | Shared UI pieces, helpers, the radius scale and the tab's sizes. |
| `gh.js`, `diff.js`, `scopes.mjs`, `highlight.js`, `hl.lua` | GitHub, git diffs, scopes, and syntax colors. |

## Tests and errors

```sh
node --test config/herdr-app/mods/review/tests/*.test.mjs
node config/herdr-app/mods/review/tests/native-check.mjs
node config/herdr-app/mods/review/tests/scroll-bench.mjs
```

The node tests load the mod's real files: `tests/host.mjs` maps `herdr`, `gpui-kit`, `gpui-base` and `fs/promises` to fakes in `tests/fakes/`, which record what a render drew, so a test can click it. Import `tests/host.mjs` first, then the mod with `await import(...)`.

`native-check.mjs` renders every view from fixtures with the real renderer, including large diffs. `tests/fixture-app.mjs <home>` makes a home for a second Herdr window that shows only the fixtures, for screenshots.

A hot reload must never fail. The mod's start (`init`) never throws: if something fails, the copy shows the error instead. A host call can fail with `null`. Herdr shows that as `Null"null"` and keeps the old copy running. So the code turns every thrown value into an `Error` first (`errors.mjs`). `tests/null-safety.test.mjs` checks this.

The look uses one radius scale (`style.js`): 0 for rows, lists and the diff; 3 for chips, keycaps and small buttons; 4 for fields, segmented controls and code excerpts; 6 only for menus, popovers and the drawer.

Errors go to `~/.config/herdr-app/data/review-debug/` with their stack trace and some counts, never code or conversation text. `herdr-app do review.debug` writes the current state. `node config/herdr-app/debug-review.mjs` prints the latest reports.
