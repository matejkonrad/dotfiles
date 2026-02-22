# dotfiles

Symlink-based dotfiles manager with OS and hostname filtering. One branch, multiple machines.

## Setup

```bash
git clone <repo-url> ~/Projects/self/dotfiles
cd ~/Projects/self/dotfiles
./dotfiles.sh install
```

On macOS, install packages first:

```bash
brew bundle --file=~/Projects/self/dotfiles/Brewfile
```

## Usage

```bash
./dotfiles.sh install     # Create symlinks for all tracked dotfiles
./dotfiles.sh status      # Show the state of all tracked dotfiles
./dotfiles.sh add <name> <path>  # Import a file/dir and start tracking it
./dotfiles.sh uninstall   # Remove all symlinks (copies files back)
```

## How it works

All configs are declared in `dotfiles.toml`. Each entry maps a repo path to a target path on the system:

```toml
[nvim]
source = "config/nvim"
target = "~/.config/nvim"
```

Running `install` creates symlinks from the target to the repo. If both a local file and a repo file exist, you're prompted to pick which to keep.

### OS and hostname filtering

Entries can be restricted to a specific OS or hostname:

```toml
[hypr]
source = "config/hypr"
target = "~/.config/hypr"
os = "linux"

[qmk_udev]
source = "config/udev/50-qmk.rules"
target = "/etc/udev/rules.d/50-qmk.rules"
postinstall = "sudo udevadm control --reload-rules && sudo udevadm trigger"
os = "linux"
```

- `os` matches against `uname -s` (lowercase) — `linux` or `darwin`
- `hostname` matches against `uname -n` (lowercase)
- Entries without these fields install everywhere

### Shell config layering

`.zshrc` sources additional files in order:

1. `~/.zshrc` — shared config (oh-my-zsh, aliases, PATH, editor)
2. `~/.zshrc.<os>` — OS-specific (e.g. `.zshrc.linux`, `.zshrc.darwin`)
3. `~/.zshrc.<hostname>` — machine-specific overrides

To add overrides for a specific machine, create `.zshrc.<hostname>` in the repo and add it to `dotfiles.toml`:

```toml
[zshrc_mymachine]
source = ".zshrc.mymachine"
target = "~/.zshrc.mymachine"
hostname = "mymachine"
```

## What's tracked

| Name | Target | OS |
|------|--------|----|
| zshrc | `~/.zshrc` | all |
| nvim | `~/.config/nvim` | all |
| kitty | `~/.config/kitty` | all |
| zed | `~/.config/zed` | all |
| git | `~/.config/git` | all |
| ghostty | `~/.config/ghostty` | all |
| zellij | `~/.config/zellij` | all |
| claude | `~/.claude/settings.json` | all |
| cursor | `~/.cursor/mcp.json` | all |
| hypr | `~/.config/hypr` | linux |
| qmk_udev | `/etc/udev/rules.d/50-qmk.rules` | linux |
