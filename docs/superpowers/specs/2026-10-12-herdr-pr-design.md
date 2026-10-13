# herdr-pr: pull request status and auto-fix for herdr

Date: 2026-10-12. Status: draft for review.

## Goal

herdr-pr is a herdr plugin. It shows the pull request (PR) state of each herdr workspace and fixes failed checks and review comments through the agent in that workspace. It replaces the Claude Code `/pr-watch` mod (`~/.claude/plugins/cache/matej-mods/pr-watch/0.2.0`).

Success means:

- Each Space row in the sidebar shows the PR state of its workspace, without opening anything.
- A popup board shows the stack, the checks, and the unresolved comments of the focused workspace.
- An auto-fix loop sends fixes to an agent until the PR is green, and it stops by itself.
- The plugin runs as one background process. It does not poll herdr, and it sends one GitHub request per tick for all workspaces.

## Decisions

These come from the design discussion on 2026-10-12.

| Topic | Decision |
| --- | --- |
| Role | herdr-pr replaces `/pr-watch`. The mod is retired. |
| PR source | Automatic from the branch and its stack. You can also add and remove PRs by hand. Merged and closed PRs disappear. |
| Stack tool | `gh stack` (github/gh-stack) first. |
| Services | Generic from the start: a `Forge` trait and a `Stack` trait. GitHub and `gh stack` are the first implementations. |
| Loop autonomy | The agent fixes, commits, and pushes. A round cap stops the loop. |
| Fix scope | Failed checks first, then unresolved review threads. Bot noise is ignored. |
| Fix agent | You pick the agent pane once for each PR. |
| UI | A `$pr` token on the Space row, and a popup board on `prefix+P`. |
| Language | Rust, one binary. |
| Location | `config/herdr/plugins/herdr-pr` in this repo, linked with `herdr plugin link`. It can move to its own repo later. |

## Architecture

The plugin is one binary, `herdr-pr`, with four modes. The manifest `herdr-plugin.toml` declares each mode.

| Mode | Manifest entry | Job |
| --- | --- | --- |
| `herdr-pr daemon` | `[[startup]]` | Forks into the background and holds a lock on `daemon.pid`. If another daemon holds the lock, it exits at once. It owns all state. It is the only process that calls the forge or the herdr socket. |
| `herdr-pr action <name>` | `[[actions]]` | Sends one JSON line to the daemon socket, then exits. Names: `watch`, `unwatch`, `fix`, `auto`, `seen`, `refresh`, `board`. |
| `herdr-pr board` | `[[panes]]`, placement `popup` | Connects to the daemon socket and draws the board with `ratatui`. It reads data only from the daemon. |
| `herdr-pr link` | `[[link_handlers]]` | Adds a Ctrl-clicked PR URL to the watch list of the workspace. |

The daemon socket is `pr.sock` in `HERDR_PLUGIN_STATE_DIR`. The protocol is newline-delimited JSON. A client sends a request with a `workspace_id`. The daemon sends one reply. A board client can also subscribe. If its workspace changes, the daemon sends it a new snapshot.

### Daemon modules

Each module has one job. The other modules use only its public interface.

| Module | Job |
| --- | --- |
| `herdr` | Socket client for `HERDR_SOCKET_PATH`: `events.subscribe`, `session.snapshot`, `workspace.report_metadata`, `agent.prompt` with wait, notifications. |
| `forge` | The `Forge` trait and the shared PR model. `forge::github` implements it with `gh api graphql`. |
| `stack` | The `Stack` trait. `stack::gh_stack` implements it with `gh stack view --json`. |
| `model` | Pure functions: stack order, comment collection, noise filter, merge readiness, fix prompts, `$pr` token text. Ported from `pr-watch` with its tests. |
| `store` | Watch lists for each workspace, seen times, auto-fix state, the chosen agent for each PR, and handled items. One JSON file in `HERDR_PLUGIN_STATE_DIR`, written atomically. |
| `scheduler` | Tick timing and immediate refresh triggers. |
| `fixloop` | One task for each PR with auto-fix on. |

## Generic seams

### Forge

A forge is the service that hosts PRs (GitHub, GitLab).

```rust
trait Forge {
    /// Which forge handles this remote URL, if any.
    fn matches(remote_url: &str) -> bool where Self: Sized;
    /// The open PR whose head is `branch`, if any.
    async fn pr_for_branch(&self, repo: &RepoRef, branch: &str) -> Result<Option<PrRef>>;
    /// Status of many PRs in one request.
    async fn fetch(&self, prs: &[PrRef]) -> Result<Vec<PrStatus>>;
    /// The log of a failed check, shortened for a prompt.
    async fn check_log(&self, check: &CheckRef) -> Result<String>;
}
```

The shared model:

- `PrRef`: forge id, repository, number.
- `PrStatus`: state (open, merged, closed), draft, base and head branch, head commit, mergeability, review decision, checks, threads, URL.
- `Check`: name, state (pending, success, failure, skipped), run reference.
- `Thread`: id, author, path and line, body, resolved, created time, URL.

GitLab maps onto the same model: merge requests, pipeline jobs, and discussions. A forge that has no "resolved" state on threads reports every thread as unresolved after its last reply from you.

### Stack

A stack tool manages chains of dependent branches.

```rust
trait Stack {
    /// Whether this tool manages the checkout.
    fn detect(checkout: &Path) -> bool where Self: Sized;
    /// The branches of the stack that contains `branch`, from bottom to top.
    async fn stack_of(&self, checkout: &Path, branch: &str) -> Result<Option<Vec<String>>>;
    /// The command the agent runs to push the stack after a fix.
    fn push_command(&self) -> &str;
}
```

`gh stack` returns `gh stack push`. A fallback `stack::plain` follows PR base branches and returns `git push`.

### Selection

The daemon picks the forge for each workspace from the `origin` remote URL. It picks the stack tool with the first `detect` that matches, then falls back to `stack::plain`. `config.toml` in `HERDR_PLUGIN_CONFIG_DIR` can override both for a repository.

## Data flow

### PR discovery

1. If a workspace appears, or its branch changes, the daemon asks the stack tool for the stack of the branch.
2. If the branch is in a stack, the daemon watches the PR of each branch in the stack. If not, it watches the PR whose head is the branch.
3. PRs that you add by hand stay next to the discovered ones. A PR that you remove by hand is hidden from discovery for that workspace.
4. If a PR is merged or closed, the daemon removes it on the next tick and does not show it again.

### Ticks

- One tick sends one `Forge::fetch` call for each forge, with all watched PRs of all workspaces.
- The interval is 20 s while a check is pending or a fix loop runs, and 2 min while PRs are open and quiet. Ticks stop while no workspace has an open PR.
- These herdr events start an immediate tick:
  - `workspace.created`.
  - `workspace.focused`, if the data is older than 30 s.
  - `pane.agent_status_changed` to idle, for an agent in a fix loop.
- The daemon subscribes to herdr events. It does not poll herdr.

### Sidebar token

- The daemon writes `$pr` with `workspace.report_metadata` on the socket it already holds. If the text does not change, it does not write.
- Examples:
  - `#5037 ✓`: checks pass.
  - `#5037 ✗ 2💬`: checks fail, two new comments.
  - `#5037 ⟳ auto`: a fix loop runs.
  - `#5037 2/3 ✓`: second PR of a stack of three.
  - `#5037 ?`: the data is stale.
- If a workspace has no PR, the daemon clears the token and the row does not change.
- `config/herdr/config.toml` adds `$pr` to the Space row: `rows = [["state_icon", "workspace", "$pr"]]`.

### Board

- `prefix+P` opens the board as a popup for the focused workspace. The popup is modal, so its keys do not reach panes.
- It lists the stack from bottom to top, with CI, review, mergeability, and the count of new comments for each PR.
- Enter expands a PR to show failed checks and unresolved threads.
- Keys:
  - `f`: fix now. `a`: auto-fix on or off. `c`: fix this comment.
  - `o`: open in the browser. `s`: mark as seen. `r`: refresh.
  - `w`: watch a PR. `u`: unwatch a PR. `q` or Esc: close.
- The mouse also works: click a row to expand it, click `[fix]` or `[auto]`.

## Fix loop

1. If you turn auto-fix on for a PR, the board asks for the agent pane in that workspace. The daemon stores the choice for that PR. The manual `f` and `c` keys use the same choice, and ask for it if none exists.
2. A round starts only if all of these are true:
   - The PR is open.
   - The agent is `idle` or `done`.
   - The PR has a failed check or an unresolved thread that is not noise.
3. Failed checks come first. The prompt contains the check names and the shortened logs from `Forge::check_log`. Unresolved threads come next.
4. The daemon sends the prompt with `agent.prompt` and waits for the agent to settle. The prompt tells the agent to commit and run `Stack::push_command`. The daemon does not push.
5. If the agent becomes `blocked`, the loop pauses and herdr shows a notification.
6. After a round, the loop waits until the checks of the new head commit finish, then evaluates again.
7. The loop stops in these conditions. Each stop shows a notification.
   - The PR is green and has no unresolved threads.
   - 5 rounds are complete.
   - The same failure comes back twice.
   - You turn auto-fix off.

Each check run and each thread is handled once for each head commit. The store records this, so a round never sends the same item twice. The daemon is the only writer, so the mod's lease is not necessary.

## Errors

| Condition | Behavior |
| --- | --- |
| Forge not logged in, network down, rate limit | Back off exponentially. Show `?` in `$pr`. Write the reason to the herdr plugin log. |
| Herdr socket drops, or `events_lost` | Reconnect, take a new `session.snapshot`, subscribe again. |
| Agent pane closed | Turn auto-fix off for that PR and show a notification. |
| Second daemon starts | It finds the lock and exits with status 0. |
| An action runs, but the daemon socket is missing | The action shows a herdr notification "herdr-pr daemon is not running" and exits with status 1. |

## Testing

- `model`: unit tests ported from `pr-watch.test.ts`.
- `forge::github`: tests against recorded GraphQL responses in `tests/fixtures`.
- `stack::gh_stack`: tests against recorded `gh stack view --json` output.
- `fixloop`: tests with a fake `Forge` and a fake herdr client.
- End to end: one test against a throwaway herdr session. The test removes every `HERDR_*` variable from the environment first, so it cannot reach the live session.

## Out of scope for the first version

- Forges other than GitHub and stack tools other than `gh stack` and `plain`. The traits are ready for them.
- Merging PRs from the board.
- Starting a new agent for the fix loop.

## Migration

1. Install and link herdr-pr. Add `prefix+P` and the `$pr` token to `config/herdr/config.toml`.
2. Import the watch lists from `~/.claude/plugins/store/pr-watch_inline-*.json` once, matched to workspaces by worktree path.
3. Disable the `/pr-watch` mod in Claude Code.
