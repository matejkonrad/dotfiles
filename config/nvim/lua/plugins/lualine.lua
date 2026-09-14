-- Statusline colours from gruvbox-material's own lualine theme (shipped in
-- lualine.nvim) instead of LazyVim's "auto", which derives a flatter palette
-- from generic highlight groups.
return {
  "nvim-lualine/lualine.nvim",
  opts = {
    options = {
      theme = "gruvbox-material",
    },
  },
}
