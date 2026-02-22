# Path to your Oh My Zsh installation.
export ZSH="$HOME/.oh-my-zsh"

ZSH_THEME="lambda"

plugins=(git)

source $ZSH/oh-my-zsh.sh

# Aliases
alias cfg="cd ~/Projects/self/dotfiles && nvim"
alias config_zsh="nvim ~/.zshrc"
alias config_kitty="nvim ~/.config/kitty/kitty.conf"
alias config_nvim="nvim ~/.config/nvim/"
alias rshell="exec $SHELL"

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
