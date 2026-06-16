return {
  "NeogitOrg/neogit",
  lazy = true,
  dependencies = {
    "dlyongemallo/diffview.nvim",
    "m00qek/baleia.nvim",
    "folke/snacks.nvim",
  },
  cmd = "Neogit",
  keys = {
    { "<leader>gng", "<cmd>Neogit<cr>", desc = "Show Neogit UI" },
  },
  opts = {
    treesitter_diff_highlight = true,
    integrations = {
      diffview = true,
    },
  },
}
