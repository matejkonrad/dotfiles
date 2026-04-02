-- Context bridge for Claude Code (cursor, buffers, diagnostics)
-- Works alongside sidekick.nvim which handles the terminal/UI
return {
  "coder/claudecode.nvim",
  enabled = false,
  opts = {
    auto_start = true,
    diff_opts = {
      open_in_new_tab = true,
      layout = "vertical",
    },
  },
}
