-- Statusline colours follow the active theme (lua/config/theme.lua). For
-- gruvbox, that is gruvbox-material's own lualine theme (shipped in
-- lualine.nvim) instead of LazyVim's "auto", which derives a flatter palette
-- from generic highlight groups.
return {
  "nvim-lualine/lualine.nvim",
  opts = {
    options = {
      theme = require("config.theme").current().lualine,
    },
  },
}
