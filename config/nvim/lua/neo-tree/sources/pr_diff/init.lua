-- Custom neo-tree source: lists files changed between the current branch
-- and its PR base (merge-base with origin/HEAD) as a collapsible tree.
--
-- Navigate() results are cached by HEAD sha + merge-base sha so tab switches
-- don't re-run three git subprocesses every time. Press `R` to force-refresh.

local renderer = require("neo-tree.ui.renderer")

local M = {
  name = "pr_diff",
  display_name = "  PR",
}

-- Simple in-memory cache: { key = "<head>:<mb>", items = {...}, expanded = {...} }.
local cache = nil

local function default_remote_branch()
  local head = vim.fn.system("git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null")
  if vim.v.shell_error == 0 then
    local branch = head:gsub("^origin/", ""):gsub("%s+", "")
    if branch ~= "" then
      return branch
    end
  end
  return "main"
end

local function head_sha()
  local sha = vim.fn.systemlist("git rev-parse HEAD 2>/dev/null")[1]
  if not sha or sha == "" then return nil end
  return sha
end

local function merge_base(base)
  local mb = vim.fn.systemlist("git merge-base origin/" .. base .. " HEAD 2>/dev/null")[1]
  if not mb or mb == "" then
    return nil
  end
  return mb
end

local function compute()
  local repo_root = vim.fn.systemlist("git rev-parse --show-toplevel 2>/dev/null")[1]
  if not repo_root or repo_root == "" then
    return nil, "not a git repo"
  end

  local head = head_sha()
  if not head then
    return nil, "could not resolve HEAD"
  end

  local base = default_remote_branch()
  local mb = merge_base(base)
  if not mb then
    return nil, "no merge-base vs origin/" .. base
  end

  local lines = vim.fn.systemlist(("git diff --name-status %s...HEAD"):format(mb))
  local entries = {}
  for _, line in ipairs(lines) do
    local status, path = line:match("^(%S+)%s+(.+)$")
    if status and path then
      if status:sub(1, 1) == "R" or status:sub(1, 1) == "C" then
        path = path:match("[^\t]+$") or path
      end
      table.insert(entries, { path = path, status = status })
    end
  end

  local items, expanded = M._build_tree(entries, repo_root)
  return { key = head, items = items, expanded = expanded }, nil
end

---Build a nested neo-tree node list from flat file entries.
function M._build_tree(entries, repo_root)
  local root_children = {}
  local dir_cache     = {}

  for _, entry in ipairs(entries) do
    local parts = vim.split(entry.path, "/", { plain = true })
    local parent_children = root_children
    local current_path    = repo_root

    for i = 1, #parts - 1 do
      local part = parts[i]
      current_path = current_path .. "/" .. part
      local existing = dir_cache[current_path]
      if not existing then
        existing = {
          id       = current_path,
          name     = part,
          type     = "directory",
          path     = current_path,
          loaded   = true,
          children = {},
        }
        dir_cache[current_path] = existing
        table.insert(parent_children, existing)
      end
      parent_children = existing.children
    end

    local filename = parts[#parts]
    local abs = current_path .. "/" .. filename
    table.insert(parent_children, {
      id    = abs,
      name  = filename,
      type  = "file",
      path  = abs,
      extra = { git_status_string = entry.status },
    })
  end

  local expanded = {}
  for dir_path, _ in pairs(dir_cache) do
    table.insert(expanded, dir_path)
  end
  return root_children, expanded
end

---Invalidate the cache; called on explicit R refresh.
function M.invalidate()
  cache = nil
end

function M.navigate(state, path, path_to_reveal, callback, async)
  state.path = vim.fn.getcwd()

  -- Fast path: one cheap `git rev-parse HEAD` to check cache validity.
  -- If HEAD changed (commit, checkout, rebase), recompute; otherwise reuse.
  -- Press R to invalidate manually (e.g. after `git fetch`).
  local head = head_sha()
  if cache and head and cache.key == head then
    state.default_expanded_nodes = cache.expanded
    renderer.show_nodes(cache.items, state)
    if callback then callback() end
    return
  end

  local result, err = compute()
  if err then
    vim.notify("pr_diff: " .. err, vim.log.levels.WARN)
    state.default_expanded_nodes = {}
    renderer.show_nodes({}, state)
    if callback then callback() end
    return
  end

  cache = result
  state.default_expanded_nodes = cache.expanded
  renderer.show_nodes(cache.items, state)
  if callback then callback() end
end

function M.setup(config, global_config)
  -- No autocmds. Use `R` in the tab to force-refresh.
end

return M
