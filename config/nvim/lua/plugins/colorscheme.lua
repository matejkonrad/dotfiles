return {
  -- { "rebelot/kanagawa.nvim" },
  {
    "slugbyte/lackluster.nvim",
    lazy = false,
    priority = 1000,
    opts = {
      tweak_highlight = {
        Visual = {
          overwrite = true,
          bg = "#3a3a3a",
        },
      },
    },
  },
  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = "lackluster-hack",
    },
  },
}
