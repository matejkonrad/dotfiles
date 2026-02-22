#!/bin/bash
set -e

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$DOTFILES_DIR/dotfiles.toml"
CURRENT_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
CURRENT_HOST="$(uname -n | tr '[:upper:]' '[:lower:]')"

# --- TOML parser (handles simple [section] / key = "value" format) ---
parse_config() {
  local current_name=""
  while IFS= read -r line; do
    line="${line##"${line%%[![:space:]]*}"}" # trim leading whitespace
    line="${line%%"${line##*[![:space:]]}"}" # trim trailing whitespace
    [[ -z "$line" || "$line" == \#* ]] && continue

    if [[ "$line" =~ ^\[([^]]+)\]$ ]]; then
      current_name="${BASH_REMATCH[1]}"
    elif [[ -n "$current_name" && "$line" =~ ^(source|target|postinstall|os|hostname)[[:space:]]*=[[:space:]]*\"(.+)\"$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
      eval "cfg_${current_name}_${key}=\"${val}\""
      if [[ "$key" == "target" ]]; then
        cfg_names+=("$current_name")
      fi
    fi
  done < "$CONFIG"
}

get_source() { eval "echo \"\$cfg_${1}_source\""; }
get_target() { eval "echo \"\$cfg_${1}_target\""; }
get_postinstall() { eval "echo \"\$cfg_${1}_postinstall\""; }
get_os() { eval "echo \"\$cfg_${1}_os\""; }
get_hostname() { eval "echo \"\$cfg_${1}_hostname\""; }

# Check if a config entry should be skipped on this machine
skip_for_machine() {
  local entry_os entry_host
  entry_os="$(get_os "$1")"
  entry_host="$(get_hostname "$1")"
  if [[ -n "$entry_os" && "$entry_os" != "$CURRENT_OS" ]]; then
    return 0
  fi
  if [[ -n "$entry_host" && "$entry_host" != "$CURRENT_HOST" ]]; then
    return 0
  fi
  return 1
}

skip_reason() {
  local entry_os entry_host
  entry_os="$(get_os "$1")"
  entry_host="$(get_hostname "$1")"
  local reasons=()
  if [[ -n "$entry_os" && "$entry_os" != "$CURRENT_OS" ]]; then
    reasons+=("os=$entry_os")
  fi
  if [[ -n "$entry_host" && "$entry_host" != "$CURRENT_HOST" ]]; then
    reasons+=("host=$entry_host")
  fi
  echo "${reasons[*]}"
}

resolve() { echo "${1/#\~/$HOME}"; }

# Run a command with sudo if the target's parent directory isn't writable
maybe_sudo() {
  local target="$1"; shift
  local target_dir
  target_dir="$(dirname "$target")"
  if [[ -w "$target_dir" ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# --- Commands ---

cmd_install() {
  echo "Installing dotfiles..."

  for name in "${cfg_names[@]}"; do
    if skip_for_machine "$name"; then
      echo "  [skip]   $name — $(skip_reason "$name")"
      continue
    fi

    local source="$DOTFILES_DIR/$(get_source "$name")"
    local target
    target="$(resolve "$(get_target "$name")")"

    # Already correctly linked — nothing to do
    if [[ -L "$target" ]]; then
      local current
      current="$(readlink "$target")"
      if [[ "$current" == "$source" ]]; then
        echo "  [ok]     $name"
        continue
      else
        echo "  [relink] $name — symlink points to $current, relinking"
        maybe_sudo "$target" rm "$target"
      fi
    elif [[ -e "$target" ]]; then
      # Source doesn't exist in repo yet — copy it in first
      if [[ ! -e "$source" ]]; then
        echo "  [import] $name — copying into repo"
        mkdir -p "$(dirname "$source")"
        if [[ -d "$target" ]]; then
          cp -r "$target" "$source"
        else
          cp "$target" "$source"
        fi
      else
        # Both exist — ask which to keep
        echo "  [conflict] $name — both repo and local versions exist"
        if diff -q "$source" "$target" &>/dev/null || \
           diff -rq "$source" "$target" &>/dev/null; then
          echo "             (files are identical)"
        else
          echo "             (files differ)"
        fi
        while true; do
          read -rp "  Keep [r]epo, [l]ocal, [d]iff, or [s]kip? " choice
          case "$choice" in
            r|repo)
              echo "  → keeping repo version"
              break
              ;;
            l|local)
              echo "  → keeping local version"
              rm -rf "$source"
              if [[ -d "$target" ]]; then
                cp -r "$target" "$source"
              else
                cp "$target" "$source"
              fi
              break
              ;;
            d|diff)
              diff -ru "$source" "$target" || true
              ;;
            s|skip)
              echo "  [skip]   $name"
              continue 2
              ;;
            *) echo "  Invalid choice. Enter r, l, d, or s." ;;
          esac
        done
      fi
      maybe_sudo "$target" rm -rf "$target"
    fi

    if [[ ! -e "$source" ]]; then
      echo "  [skip]   $name — source not found in repo and nothing at target"
      continue
    fi

    maybe_sudo "$target" mkdir -p "$(dirname "$target")"
    maybe_sudo "$target" ln -s "$source" "$target"
    echo "  [link]   $name — $target -> $source"

    local postinstall
    postinstall="$(get_postinstall "$name")"
    if [[ -n "$postinstall" ]]; then
      echo "  [run]    $name — $postinstall"
      eval "$postinstall"
    fi
  done

  echo ""
  echo "Done."
}

cmd_status() {
  for name in "${cfg_names[@]}"; do
    if skip_for_machine "$name"; then
      echo "  [skip]     $name — $(skip_reason "$name")"
      continue
    fi

    local source="$DOTFILES_DIR/$(get_source "$name")"
    local target
    target="$(resolve "$(get_target "$name")")"

    if [[ -L "$target" ]]; then
      local current
      current="$(readlink "$target")"
      if [[ "$current" == "$source" ]]; then
        echo "  [ok]      $name"
      else
        echo "  [wrong]   $name — points to $current (expected $source)"
      fi
    elif [[ -e "$target" ]]; then
      echo "  [unlinked] $name — regular file/dir exists at $target"
    else
      echo "  [missing]  $name — nothing at $target"
    fi
  done
}

cmd_add() {
  local name="$1"
  local target_path="$2"

  if [[ -z "$name" || -z "$target_path" ]]; then
    echo "Usage: dotfiles.sh add <name> <path>"
    echo "  e.g. dotfiles.sh add tmux ~/.tmux.conf"
    exit 1
  fi

  # Resolve the full path
  local resolved
  resolved="$(cd "$(dirname "$target_path")" && pwd)/$(basename "$target_path")"

  if [[ ! -e "$resolved" ]]; then
    echo "Error: $resolved does not exist."
    exit 1
  fi

  # Decide where to store it in the repo
  local repo_path
  if [[ "$resolved" == "$HOME/.config/"* ]]; then
    repo_path="config/${resolved#"$HOME/.config/"}"
  else
    repo_path="$(basename "$resolved")"
  fi

  local full_repo_path="$DOTFILES_DIR/$repo_path"

  # Copy into the repo
  if [[ -d "$resolved" ]]; then
    mkdir -p "$full_repo_path"
    cp -r "$resolved/." "$full_repo_path"
  else
    mkdir -p "$(dirname "$full_repo_path")"
    cp "$resolved" "$full_repo_path"
  fi

  # Convert resolved path back to ~ form for the config
  local target_short="${resolved/#$HOME/\~}"

  # Append to TOML config
  printf '\n[%s]\nsource = "%s"\ntarget = "%s"\n' "$name" "$repo_path" "$target_short" >> "$CONFIG"

  # Replace original with symlink
  rm -rf "$resolved"
  ln -s "$full_repo_path" "$resolved"

  echo "Added '$name'"
  echo "  copied  $resolved -> $full_repo_path"
  echo "  linked  $resolved -> $full_repo_path"
  echo "  config  updated dotfiles.toml"
}

cmd_uninstall() {
  echo "Removing symlinks..."
  for name in "${cfg_names[@]}"; do
    local target
    target="$(resolve "$(get_target "$name")")"
    local source="$DOTFILES_DIR/$(get_source "$name")"

    if [[ -L "$target" ]]; then
      local current
      current="$(readlink "$target")"
      if [[ "$current" == "$source" ]]; then
        maybe_sudo "$target" rm "$target"
        # Copy the file back so the program still works
        if [[ -d "$source" ]]; then
          maybe_sudo "$target" cp -r "$source" "$target"
        else
          maybe_sudo "$target" cp "$source" "$target"
        fi
        echo "  [restored] $name"
      else
        echo "  [skip]     $name — symlink points elsewhere ($current)"
      fi
    else
      echo "  [skip]     $name — not a symlink"
    fi
  done
  echo ""
  echo "Done."
}

# --- Main ---

cfg_names=()
parse_config

case "${1:-}" in
  install)   cmd_install ;;
  status)    cmd_status ;;
  add)       cmd_add "$2" "$3" ;;
  uninstall) cmd_uninstall ;;
  *)
    echo "Usage: dotfiles.sh <command>"
    echo ""
    echo "Commands:"
    echo "  install     Create symlinks for all tracked dotfiles"
    echo "  status      Show the state of all tracked dotfiles"
    echo "  add <name> <path>  Import a file/dir and start tracking it"
    echo "  uninstall   Remove all symlinks (copies files back)"
    ;;
esac
