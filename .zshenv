# .zshenv — sourced by ALL zsh invocations (interactive, non-interactive,
# scripts, tmux, cron). Env set here is available everywhere, unlike .zshrc
# which is interactive-only.

# Dotfiles location (per-OS)
case "$(uname -s)" in
    Darwin) export CFG_PATH="$HOME/Project/self/dotfiles" ;;
    Linux)  export CFG_PATH="$HOME/Projects/self/dotfiles" ;;
esac

# Cargo (sourced if installed)
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
