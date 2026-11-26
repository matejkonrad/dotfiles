-- Themes come from lua/config/theme.lua (set by `scripts/theme`):
--   fesper   colors/fesper.lua, no plugin
--   gruvbox  gruvbox-material, loaded by lazy.nvim on `:colorscheme`
return {
  {
    "sainnhe/gruvbox-material",
    lazy = true,
    init = function()
      -- Vimscript globals: must be set before the colorscheme loads.
      vim.g.gruvbox_material_background = "hard" -- hard | medium | soft
      vim.g.gruvbox_material_foreground = "material" -- material | mix | original
      vim.g.gruvbox_material_enable_italic = true
      -- Floats (pickers, lazygit, docs) share the editor bg instead of the
      -- default 'bright' bg3 (#45403d). With 'bright', bg3 is also Visual, so
      -- lazygit's selected line (snacks maps it to Visual) was invisible
      -- inside the float — see LazyVim/LazyVim#4251.
      vim.g.gruvbox_material_float_style = "blend"
      vim.g.gruvbox_material_better_performance = 1
    end,
  },
  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = require("config.theme").current().colorscheme,
    },
  },
}
