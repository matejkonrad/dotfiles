#!/bin/bash

# Dotfiles deployment script
# Deploys: zed, kitty, git, nvim configs + .zshrc + Brewfile

set -e

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$HOME/.dotfiles-backup"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Specific configs to deploy
CONFIGS=("zed" "kitty" "git" "nvim" "zellij" "ghostty" "cursor")

echo "🚀 Deploying dotfiles..."
echo "Source directory: $DOTFILES_DIR"
echo "Target directory: $HOME"

# Create directories if they don't exist
mkdir -p "$BACKUP_DIR/$TIMESTAMP"
mkdir -p "$HOME/.config"

# Function to deploy file with backup
deploy_file() {
  local src="$1"
  local dest="$2"
  local name="$(basename "$dest")"

  if [[ -e "$src" ]]; then
    # Backup existing destination if it exists
    if [[ -e "$dest" ]]; then
      cp "$dest" "$BACKUP_DIR/$TIMESTAMP/$name"
      echo "  📦 Backed up existing $name"
    fi

    cp "$src" "$dest"
    echo "  ✅ Deployed $name"
  else
    echo "  ⚠️  Source not found: $src"
  fi
}

# Function to deploy config with backup
deploy_config() {
  local name="$1"
  local src="$DOTFILES_DIR/config/$name"
  local dest="$HOME/.config/$name"

  if [[ -e "$src" ]]; then
    # Backup existing destination if it exists
    if [[ -e "$dest" ]]; then
      cp -r "$dest" "$BACKUP_DIR/$TIMESTAMP/$name"
      echo "  📦 Backed up existing $name"
    fi

    # Remove destination and copy fresh
    rm -rf "$dest"
    cp -r "$src" "$dest"
    echo "  ✅ Deployed $name"
  else
    echo "  ⚠️  Source not found: $src"
  fi
}

# Deploy .zshrc
echo ""
echo "📁 Deploying .zshrc..."
deploy_file "$DOTFILES_DIR/.zshrc" "$HOME/.zshrc"

# Install from Brewfile
echo ""
echo "📁 Installing from Brewfile..."
if [[ -e "$DOTFILES_DIR/Brewfile" ]]; then
  if command -v brew &>/dev/null; then
    brew bundle install --file="$DOTFILES_DIR/Brewfile"
    echo "  ✅ Installed from Brewfile"
  else
    echo "  ⚠️  Homebrew not found, skipping Brewfile installation"
  fi
else
  echo "  ⚠️  Brewfile not found in dotfiles"
fi

# Deploy specified config folders
echo ""
echo "📁 Deploying config folders..."
for config in "${CONFIGS[@]}"; do
  deploy_config "$config"
done

echo ""
echo "✨ Dotfiles deployment complete!"
echo "📍 Configs deployed to: $HOME/.config"
echo "📍 .zshrc deployed to: $HOME/.zshrc"
if [[ -n "$(ls -A "$BACKUP_DIR/$TIMESTAMP" 2>/dev/null)" ]]; then
  echo "🗄️  Backups stored in: $BACKUP_DIR/$TIMESTAMP"
fi
