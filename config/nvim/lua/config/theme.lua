-- Reads the environment-wide theme that `scripts/theme` writes to
-- ~/.config/nvim/theme, and maps it to a Neovim colorscheme and lualine theme.
local M = {}

local themes = {
  fesper = { colorscheme = "fesper", lualine = "auto" },
  gruvbox = { colorscheme = "gruvbox-material", lualine = "gruvbox-material" },
}

function M.current()
  local ok, lines = pcall(vim.fn.readfile, vim.fn.stdpath("config") .. "/theme")
  local name = ok and lines[1] and vim.trim(lines[1]) or ""
  return themes[name] or themes.gruvbox
end

-- Called by `scripts/theme` through `nvim --server <sock> --remote-expr` to
-- switch running instances without a restart.
function M.apply()
  local theme = M.current()
  vim.cmd.colorscheme(theme.colorscheme)
  if package.loaded["lualine"] then
    local lualine = require("lualine")
    local config = lualine.get_config()
    config.options.theme = theme.lualine
    lualine.setup(config)
  end
  return theme.colorscheme
end

return M
