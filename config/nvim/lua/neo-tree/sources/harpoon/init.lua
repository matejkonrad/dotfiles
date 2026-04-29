-- Custom neo-tree source: lists files pinned via harpoon2.
-- <CR> opens, `d` removes from the list, `a` adds current file, `R` refreshes.
--
-- No BufEnter autocmd — refreshes happen on explicit `R` or when you re-enter
-- the tab (navigate() is called by neo-tree on source switch).

local renderer = require("neo-tree.ui.renderer")

local M = {
  name = "harpoon",
  display_name = "󰛢  Harpoon",
}

local function harpoon_list()
  local ok, harpoon = pcall(require, "harpoon")
  if not ok then return nil end
  return harpoon:list()
end

local function load_items()
  local list = harpoon_list()
  if not list then return {}, "harpoon not available" end

  local items = {}
  for i, entry in ipairs(list.items or {}) do
    local path = entry.value
    local abs  = vim.fn.fnamemodify(path, ":p")
    table.insert(items, {
      id    = abs .. ":" .. i,
      name  = string.format("%d  %s", i, path),
      type  = "file",
      path  = abs,
      extra = { harpoon_index = i },
    })
  end
  return items, nil
end

function M.navigate(state, path, path_to_reveal, callback, async)
  state.path = vim.fn.getcwd()
  state.default_expanded_nodes = {}
  local items, err = load_items()
  if err then
    vim.notify("harpoon source: " .. err, vim.log.levels.WARN)
  end
  renderer.show_nodes(items, state)
  if callback then callback() end
end

function M.setup(config, global_config)
  -- No autocmds. Neo-tree calls navigate() on tab switch; press `R` to refresh.
end

return M
