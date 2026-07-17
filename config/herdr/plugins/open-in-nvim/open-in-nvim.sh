#!/usr/bin/env bash
# open-in-nvim (herdr) — click a file path in any pane to open it in the sibling
# Neovim of the same herdr workspace, at the right line. The herdr port of
# scripts/tmux-open-in-nvim.
#
# Wired from herdr-plugin.toml: a [[link_handlers]] pattern makes repo-relative
# paths (optionally with :line[:col]) clickable in every pane's output. On click,
# herdr runs this script with:
#   HERDR_PLUGIN_CLICKED_URL = the clicked path
#   HERDR_PANE_ID            = the pane that was clicked (for cwd resolution)
#   HERDR_WORKSPACE_ID       = its workspace (for socket keying)
#
# It reaches nvim over a per-(workspace, worktree) server socket that nvim opens
# at startup (see config/nvim/lua/config/autocmds.lua). The socket name MUST
# match the one built there:
#   /tmp/nvim-herdr-<sha256(workspace_id ":" worktree_root)[:16]>.sock
# nvim also records its own pane id at the sibling ".pane" path so we can focus it.
#
# The clicked path is handed to nvim as a literal command-line file argument via
# --remote-silent (NOT :edit), so Next.js routes such as
# app/(marketing)/[id]/page.tsx open as real files instead of :edit glob patterns.

set -euo pipefail

herdr="${HERDR_BIN_PATH:-herdr}"
word="${HERDR_PLUGIN_CLICKED_URL:-}"
ws="${HERDR_WORKSPACE_ID:-}"
pane="${HERDR_PANE_ID:-}"

[ -n "$word" ] || exit 0

# Strip trailing sentence punctuation (a path never ends in . or ,), but leave
# brackets/parens intact — they're part of Next.js route segments.
word="${word%[.,]}"

# Split off a trailing :line[:col].
file="${word%%:*}"
rest="${word#"$file"}"                        # ":42" or ":42:8" or ""
line="${rest#:}"; line="${line%%:*}"          # "42"
case "$line" in ''|*[!0-9]*) line="" ;; esac  # keep only if purely numeric
[ -n "$file" ] || exit 0

# cwd of the clicked pane (for resolving relative paths). Prefer the foreground
# process cwd (e.g. the agent's), fall back to the pane cwd, then $HOME.
cwd=""
if [ -n "$pane" ]; then
  info=$("$herdr" pane get "$pane" 2>/dev/null || true)
  cwd=$(printf '%s' "$info" | sed -n 's/.*"foreground_cwd":"\([^"]*\)".*/\1/p')
  [ -n "$cwd" ] || cwd=$(printf '%s' "$info" | sed -n 's/.*"cwd":"\([^"]*\)".*/\1/p')
fi
[ -d "$cwd" ] || cwd="$HOME"

# Worktree root of the clicked pane (falls back to cwd for non-git dirs).
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$root" ] || root="$cwd"

# Resolve to an absolute, existing file: try the pane cwd first, then the
# worktree root (agents often print repo-root-relative paths).
abs=""
for base in "$cwd" "$root"; do
  case "$file" in
    /*) cand="$file" ;;
    *)  cand="$base/$file" ;;
  esac
  if [ -e "$cand" ]; then abs="$cand"; break; fi
done
[ -n "$abs" ] || exit 0

# Per-(workspace, worktree) nvim server socket. MUST match autocmds.lua.
key=$(printf '%s' "${ws}:${root}" | shasum -a 256 | cut -c1-16)
sock="/tmp/nvim-herdr-${key}.sock"
[ -S "$sock" ] || exit 0                      # no matching nvim → silently do nothing

# Open the file as a literal command-line argument (no :edit globbing).
# --remote-silent does NOT honor a leading "+{line}", so jump separately.
nvim --server "$sock" --remote-silent "$abs"
if [ -n "$line" ]; then
  nvim --server "$sock" --remote-send "<C-\\><C-n>:${line}<CR>"
fi

# Best-effort: focus the nvim pane (id recorded by autocmds.lua next to the socket).
pane_file="/tmp/nvim-herdr-${key}.pane"
if [ -r "$pane_file" ]; then
  npane=$(cat "$pane_file" 2>/dev/null || true)
  [ -n "$npane" ] && "$herdr" agent focus "$npane" >/dev/null 2>&1 || true
fi
