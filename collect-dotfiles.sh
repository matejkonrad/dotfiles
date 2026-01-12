#!/bin/bash

# Dotfiles collection script
# Collects: zed, kitty, git, nvim configs + .zshrc + Brewfile

set -e

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$DOTFILES_DIR/backup"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Specific configs to collect
CONFIGS=("zed" "kitty" "git" "nvim" "zellij" "ghostty" "cursor")

echo "🔍 Collecting dotfiles..."
echo "Dotfiles directory: $DOTFILES_DIR"
echo "Backup directoaury: $BACKUP_DIR"

# Create directories if they don't exist
mkdir -p "$BACKUP_DIR"
mkdir -p "$DOTFILES_DIR/config"

# Function to copy file with backup
copy_file() {
  local src="$1"
  local dest="$2"
  local name="$(basename "$dest")"

  if [[ -e "$src" ]]; then
    # Backup existing destination if it exists
    if [[ -e "$dest" ]]; then
      cp "$dest" "$BACKUP_DIR/$name.$TIMESTAMP.bak"
      echo "  📦 Backed up existing $name"
    fi

    cp "$src" "$dest"
    echo "  ✅ Copied $name"
  else
    echo "  ⚠️  Source not found: $src"
  fi
}

# Function to copy directory with backup
copy_config() {
  local name="$1"
  local src="$HOME/.config/$name"
  local dest="$DOTFILES_DIR/config/$name"

  if [[ -e "$src" ]]; then
    # Backup existing destination if it exists
    if [[ -e "$dest" ]]; then
      cp -r "$dest" "$BACKUP_DIR/$name.$TIMESTAMP.bak"
      echo "  📦 Backed up existing $name"
    fi

    # Remove destination and copy fresh
    rm -rf "$dest"
    cp -r "$src" "$dest"
    echo "  ✅ Copied $name"
  else
    echo "  ⚠️  Source not found: $src"
  fi
}

# Collect .zshrc
echo ""
echo "📁 Collecting .zshrc..."
copy_file "$HOME/.zshrc" "$DOTFILES_DIR/.zshrc"

# Collect Brewfile
echo ""
echo "📁 Generating Brewfile..."
if command -v brew &>/dev/null; then
  if [[ -e "$DOTFILES_DIR/Brewfile" ]]; then
    cp "$DOTFILES_DIR/Brewfile" "$BACKUP_DIR/Brewfile.$TIMESTAMP.bak"
    echo "  📦 Backed up existing Brewfile"
  fi
  brew bundle dump --file="$DOTFILES_DIR/Brewfile" --force
  echo "  ✅ Generated Brewfile"
else
  echo "  ⚠️  Homebrew not found, skipping Brewfile"
fi

# Collect specified config folders
echo ""
echo "📁 Collecting config folders..."
for config in "${CONFIGS[@]}"; do
  copy_config "$config"
done

echo ""
echo "✨ Dotfiles collection complete!"
echo "📍 All files collected in: $DOTFILES_DIR"
if [[ -n "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
  echo "🗄️  Backups stored in: $BACKUP_DIR"
fi
