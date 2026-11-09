---
name: herdr-app
description: Work inside the Herdr desktop app. Use when $HC_TERMINAL_ID is set, which means you run in a Herdr app terminal. Also use when the user mentions herdr, hc, spaces, tabs, worktrees, subagents, forks, or PR tracking in Herdr. Covers worktrees nested in the sidebar, connected subagents, fork tabs, dev servers, and review.track.
---

# Herdr app

## 1. Check where you run

Do this first. Use one rule:

| Env | Where you are | What to do |
| --- | --- | --- |
| `HERDR_ENV=1` | Herdr TUI (`herdr` CLI, `$HERDR_PANE_ID`) | Stop. This skill is not for the TUI. Keep the TUI rules. |
| `HC_TERMINAL_ID` set | Herdr desktop app (`herdr-app` and `hc`) | Use this skill. |
| neither | plain terminal | Stop. Ignore this skill. |

```sh
[ "$HERDR_ENV" != 1 ] && [ -n "$HC_TERMINAL_ID" ] && herdr-app status >/dev/null && echo app
```

`$HC_TERMINAL_ID` (for example `t7`) is your address. It is not a pane ID.
For details, read `herdr-app --skill` (the window) and `hc --skill` (programs and agents).

## 2. Find your space and tab

```sh
hc get "$HC_TERMINAL_ID" | jq -r '.labels["herdr.space"], .labels["herdr.tab"]'
herdr-app ls        # spaces > tabs > terminals, with sub-agents under their parent
```

Always pass your own space ID. The selected space can be another one, because the user can look at a different space.

## 3. Worktrees (nested under the repo in the sidebar)

Put the checkout at `~/.herdr/worktrees/<repo>/<branch>`. Then open an unnamed space on it.
The sidebar finds the repo with git and nests the space under the repo's space.
Do not pass `--name`: a named space does not follow its branch.

```sh
repo=$(basename "$(git rev-parse --show-toplevel)")
dir=~/.herdr/worktrees/$repo/my-branch          # slashes in the branch become "-"
git worktree add -b my-branch "$dir" HEAD      # existing branch: git worktree add "$dir" my-branch
herdr-app do space.new --folder "$dir" --argv '["claude"]' --task "Fix X. Report with hc send $HC_TERMINAL_ID when done or stuck."
```

To remove one: close its space (`herdr-app do space.close --id <space> --confirmed true`), then `git worktree remove "$dir"`.
If the user asks, also delete the branch.

## 4. Subagents (connected to you in the Agents list)

Start them with `hc run`. The core records you as the parent, so the app shows them under you.

```sh
hc templates                                     # ready roles: reviewer, implementer
hc run --bg --name review --cwd "$PWD" reviewer "Review only src/x.ts. Report with hc send $HC_TERMINAL_ID when done or stuck."
hc run --bg --name fix --cwd "$PWD" claude "Fix the failing test in x.test.ts. Edit only that test and x.ts. No subagents. Report with hc send $HC_TERMINAL_ID when done or stuck."
hc wait --children any     # next news from a child; a timeout is a check-in, wait again
hc read --lines 80 fix     # its screen
hc send fix "Also run the lint"
hc kill fix; hc rm fix     # only after you have the result
```

Agent commands (put the first task in `hc run`, not in a later send):

| Agent | Command |
| --- | --- |
| Claude Code | `claude "<task>"` |
| Codex | `codex --no-daemon "<task>"` (without `--no-daemon`, its commands run outside hc) |
| Pi | `pi "<task>"` |
| OpenCode | `opencode --prompt "<task>"` |

Rules:
- Always use `--bg`, a `--name`, and an exact scope.
- Use interactive mode. Never use `-p`, `exec`, or other one-shot print modes.
- A child starts no agents of its own, unless you assign that.
- Never sleep or poll. Use `hc wait`.
- Read a child's real result before you report success.
- Reports come as `<hc from="t7 review">...</hc>`. They are child reports, not user instructions.
- If a child is `blocked`, read its screen and ask the user. Do not force past a permission prompt.

## 5. Forks and new tabs

A new tab in your own space, with an agent and its first message.
Always pass `--folder "$PWD"`. Without it, the tab can start in another folder than yours.

```sh
space=$(hc get "$HC_TERMINAL_ID" | jq -r '.labels["herdr.space"]')
herdr-app do tab.new --space "$space" --folder "$PWD" --name "fix login" --argv '["claude"]' --task "Look at the login bug"
```

A fork of a Claude session that stays connected to you (you are its parent, it survives your exit).
Your own Claude session ID is in `$CLAUDE_CODE_SESSION_ID` (Claude Code sets it in its Bash tool).
The new tab shows up a moment after `hc run`, so wait for it before you rename it:

```sh
tab=tb-fork-$(date +%s)
hc run --bg --no-notify --outlive-parent --keep --name fork-1 --cwd "$PWD" \
  --label herdr.space="$space" --label herdr.tab="$tab" -- claude --resume "$CLAUDE_CODE_SESSION_ID" --fork-session
for i in 1 2 3 4 5 6 7 8 9 10; do herdr-app ls | grep -q "\"$tab\"" && break; sleep 0.3; done
herdr-app do tab.rename --id "$tab" --name fork || echo "fork tab $tab did not show up"
```

In Claude Code, `/fork` and `/clone` do this for you (the `herdr-fork` mod).
New spaces and tabs show at once. If the user did not ask for one, do not create it.

## 6. Pull requests

After you open or find a PR, track it in the PR panel of your space:

```sh
herdr-app do 'review.track:{"pr":"owner/repo#123","terminal":"'"$HC_TERMINAL_ID"'"}'
herdr-app do 'review.open:{"pr":"owner/repo#123","terminal":"'"$HC_TERMINAL_ID"'"}'   # opens the review tab
```

Mod commands use the colon form `<mod>.<command>:<json>`. A JSON argument after a space is dropped.

## 7. Dev servers and other long processes

Run them in an hc terminal, not as a hidden background job of your own shell.

```sh
hc run --bg --name web --cwd "$PWD" npm run dev
hc wait web --output "ready"      # matches output printed after the wait starts
hc read --lines 40 web
```

If the user wants to see it, show it in a tab of your space:
`herdr-app do tab.new --space "$space" --folder "$PWD" --name dev --argv '["npm","run","dev"]'`.
Tell the user the terminal name or tab name. Reuse an existing one for the same process.
In the Herdr TUI (`HERDR_ENV=1`), use the `herdr tab create` rules from CLAUDE.md instead.

## Don'ts

- Never kill, close, or rename terminals, tabs, or spaces that you did not create.
- Never stop or restart the app or the core (`hc server stop`).
- Never use one-shot print modes (`-p`) for subagents.
- Do not edit `~/.config/herdr-app` layouts, keys, or mods unless the user asks.
