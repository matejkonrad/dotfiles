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
    "metalelf0/black-metal-theme-neovim",
    lazy = false,
    priority = 1000,
    config = function()
      require("black-metal").setup({
        -- optional configuration here
        -- theme = "dark-funeral",
        theme = "darkthrone",
      })
      -- require("black-metal").load()
    end,
  },
  {
    "LazyVim/LazyVim",
    opts = {
      -- colorscheme = "lackluster-hack",
      colorscheme = "darkthrone",
    },
  },
}
