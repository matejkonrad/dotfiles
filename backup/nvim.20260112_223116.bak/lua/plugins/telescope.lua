return {
  "nvim-telescope/telescope.nvim",
  dependencies = { "nvim-lua/plenary.nvim" },
  opts = {
    defaults = {
      file_ignore_patterns = {},
      hidden = true,
    },
  },
  keys = {
    {
      "<leader>fh",
      function()
        require("telescope.builtin").find_files({ hidden = true, no_ignore = true })
      end,
      desc = "Find Files (hidden, no_ignore = true)",
    },
  },
}
