# herdr-automatic-rename (github:qu8n/herdr-automatic-rename) — symlinked to
# ~/.config/herdr-automatic-rename/config.sh (see dotfiles.toml).
# Full option list: config.example.sh in the installed plugin.

# No "[1] " jump-key prefixes on workspaces, tabs, or agents. Setting each kind
# to 0 explicitly also strips prefixes the plugin already wrote.
AUTO_INDEX=0
AUTO_INDEX_WORKSPACES=0
AUTO_INDEX_TABS=0
AUTO_INDEX_AGENTS=0

# Name tabs by program or agent task only. The default context prefix
# ("fix-framer › remove-site › nvim") repeats the worktree, which the sidebar
# already shows.
TAB_CONTEXT=0

# Agent tabs show the program ("claude"), not the task title or transcript.
AGENT_TITLES=1
AGENT_TRANSCRIPT=0
