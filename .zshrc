# Path to your Oh My Zsh installation.
export ZSH="$HOME/.oh-my-zsh"

ZSH_THEME="lambda"

plugins=(git)

source $ZSH/oh-my-zsh.sh

# ---------------------------------------------------------------------
# Tab / window title = git repo name (falls back to the folder name).
# Re-asserted on every prompt AND before every command, so it overrides
# Oh My Zsh's default of showing the running command — tabs stop saying
# "nvim", "claude", etc. To use just the folder name instead of the repo
# name, replace the function body with:  print -n "\e]1;%1~\a\e]2;%1~\a"
# (and drop the git lookup).
# ---------------------------------------------------------------------
DISABLE_AUTO_TITLE="true"
autoload -Uz add-zsh-hook

function _tab_title {
	local root name
	root=$(command git rev-parse --show-toplevel 2>/dev/null)
	if [[ -n $root ]]; then
		name=${root:t}    # git repo name
	else
		name=${PWD:t}     # current folder name
	fi
	print -n "\e]1;${name}\a\e]2;${name}\a"
}
add-zsh-hook precmd _tab_title
add-zsh-hook preexec _tab_title

# Stop Claude Code from overriding the tab title with "claude code".
export CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1


# CFG_PATH is exported from .zshenv (per-OS) so non-interactive shells see it too.

# Aliases
alias cfg="cd $CFG_PATH && nvim"
alias config_zsh="nvim ~/.zshrc"
alias config_kitty="nvim ~/.config/kitty/kitty.conf"
alias config_nvim="nvim ~/.config/nvim/"
alias rshell="exec $SHELL"
alias nvim-reset="rm -rf ~/.local/share/nvim/site/queries ~/.local/state/nvim/lazy && echo 'Cleaned nvim cache'"

# Git worktree helpers (worktree new|install|switch|delete) — see config/zsh/worktree.zsh
source "$CFG_PATH/config/zsh/worktree.zsh"

# Yazi wrapper — cd to last dir on quit (q), stay on Q
function y() {
	local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
	command yazi "$@" --cwd-file="$tmp"
	IFS= read -r -d '' cwd < "$tmp"
	[ "$cwd" != "$PWD" ] && [ -d "$cwd" ] && builtin cd -- "$cwd"
	rm -f -- "$tmp"
}

# Go
export GOPATH=$HOME/go
export PATH=$PATH:$GOPATH/bin

# Editor
export GIT_EDITOR=nvim
export EDITOR=nvim
export VISUAL=nvim

# Volta
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"

# Local binaries
export PATH="$HOME/.local/bin:$PATH"

# Source OS-specific config, then hostname-specific config
_os="$(uname -s | tr '[:upper:]' '[:lower:]')"
_host="$(uname -n | tr '[:upper:]' '[:lower:]')"
[[ -f "$HOME/.zshrc.${_os}" ]] && source "$HOME/.zshrc.${_os}"
[[ -f "$HOME/.zshrc.${_host}" ]] && source "$HOME/.zshrc.${_host}"
unset _os _host
export NPM_TOKEN=$(sed -nE "s/\/\/registry.(yarnpkg.com|npmjs.org)\/:_authToken=//p" $HOME/.npmrc)
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
