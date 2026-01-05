return {
  {
    "ggandor/leap.nvim",
    opts = {
      -- your leap options here
    },
    config = function(_, opts)
      require("leap").add_default_mappings()
      require("leap").setup(opts)

      -- Example: make non‑targets look dimmer by linking groups
      vim.api.nvim_set_hl(0, "LeapBackdrop", { fg = "#555555" }) -- change color to taste
      vim.api.nvim_set_hl(0, "LeapMatch", { fg = "#ffffff", bold = true })
    end,
  },
}
