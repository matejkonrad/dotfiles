-- tuicr: standalone code-review TUI (https://github.com/…/tuicr).
-- Launched in a full-window snacks float, styled like lazygit (see snacks.lua).
-- `:edit` inside tuicr spawns $EDITOR (nvim); flatten.nvim intercepts that and
-- opens the file as a tab in *this* Neovim instead of a nested editor.
return {
  "snacks.nvim",
  keys = {
    {
      "<leader>gr",
      function()
        Snacks.terminal.open("tuicr", {
          -- width/height 0 = full editor, matching the lazygit style (snacks.lua:57)
          win = {
            position = "float",
            width = 0,
            height = 0,
            border = "none",
            title = " tuicr ",
            title_pos = "center",
          },
        })
      end,
      desc = "Git Review (tuicr)",
    },
  },
}
