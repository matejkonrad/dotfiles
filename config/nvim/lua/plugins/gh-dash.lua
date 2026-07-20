-- gh-dash: GitHub PRs/issues dashboard TUI (gh extension dlvhdr/gh-dash).
-- Launched in a full-window snacks float, matching the tuicr/lazygit style.
return {
  "snacks.nvim",
  keys = {
    {
      "<leader>G",
      function()
        Snacks.terminal.open("gh dash", {
          -- width/height 0 = full editor, like the lazygit float (snacks.lua:57)
          win = {
            position = "float",
            width = 0,
            height = 0,
            border = "none",
            title = " gh dash ",
            title_pos = "center",
          },
        })
      end,
      desc = "GitHub Dashboard (gh dash)",
    },
  },
}
