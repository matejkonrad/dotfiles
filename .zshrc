# Path to your Oh My Zsh installation.
export ZSH="$HOME/.oh-my-zsh"

ZSH_THEME="lambda"

plugins=(git)

source $ZSH/oh-my-zsh.sh


# CFG_PATH is exported from .zshenv (per-OS) so non-interactive shells see it too.

# Aliases
alias cfg="cd $CFG_PATH && nvim"
alias config_zsh="nvim ~/.zshrc"
alias config_kitty="nvim ~/.config/kitty/kitty.conf"
alias config_nvim="nvim ~/.config/nvim/"
alias rshell="exec $SHELL"
alias nvim-reset="rm -rf ~/.local/share/nvim/site/queries ~/.local/state/nvim/lazy && echo 'Cleaned nvim cache'"

# Git worktree helpers
#   worktree new <branch>         — create worktree, copy .env files, install deps
#   worktree install              — fix up current worktree (copy .env files, install deps)
#   worktree switch               — fzf-pick a worktree to cd into
#   worktree delete [--force|-f]  — fzf-pick worktrees to remove (Tab to multi-select)
function worktree() {
	case "$1" in
	new)
		if [ -z "$2" ]; then
			echo "Usage: worktree new <branch-name>"
			return 1
		fi

		local branch="$2"
		local base_dir
		base_dir="$(git rev-parse --show-toplevel)"
		local worktree_dir="../$(basename "$base_dir")-worktree/$branch"

		git worktree add -b "$branch" "$worktree_dir"
		cd "$worktree_dir"
		worktree install
		echo "Worktree ready at $worktree_dir"
		;;
	install)
		local base_dir
		base_dir="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
		local here
		here="$(pwd)"

		if [ "$base_dir" = "$here" ]; then
			echo "Already in the main worktree, nothing to fix up."
			return 1
		fi

		# Copy all dotenv files from main worktree
		for f in "$base_dir"/.env*; do
			[ -f "$f" ] || continue
			local name="$(basename "$f")"
			[ ! -f "$name" ] && cp "$f" "$name"
		done

		# Install deps
		if [ -f "pnpm-lock.yaml" ]; then
			pnpm install
		elif [ -f "yarn.lock" ]; then
			yarn install
		elif [ -f "package-lock.json" ]; then
			npm install
		fi
		;;
	switch)
		local selection
		selection=$(git worktree list | fzf \
			--prompt="Switch to> " \
			--header="↑↓ navigate · Enter: switch" \
			--height=40% --reverse --border)
		[ -z "$selection" ] && return 1
		cd "${selection%% *}"
		;;
	delete)
		local force=""
		if [ "$2" = "--force" ] || [ "$2" = "-f" ]; then
			force="--force"
		fi

		local base_dir
		base_dir="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"

		local selection
		selection=$(git worktree list | awk -v base="$base_dir" '$1 != base' | fzf \
			--multi \
			--prompt="Delete> " \
			--header="↑↓ navigate · Tab: multi-select · Enter: confirm" \
			--height=40% --reverse --border)
		[ -z "$selection" ] && return 1

		local paths=()
		while IFS= read -r line; do
			paths+=("${line%% *}")
		done <<< "$selection"

		echo "Will remove${force:+ (forced)}:"
		for p in "${paths[@]}"; do
			echo "  $p"
		done
		if read -q "?Proceed? [y/N] "; then
			echo
			local failed=0
			for p in "${paths[@]}"; do
				echo "→ Removing $p..."
				if git worktree remove $force "$p"; then
					echo "  ✓ Removed"
				else
					echo "  ✗ Failed (try with --force if dirty or locked)"
					((failed++))
				fi
			done
			echo "Done. ${#paths[@]} selected, $((${#paths[@]} - failed)) removed, $failed failed."
		else
			echo
			echo "Cancelled."
		fi
		;;
	*)
		echo "Usage: worktree <new|install|switch|delete>"
		return 1
		;;
	esac
}

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
