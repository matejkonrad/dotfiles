return {
  "coder/claudecode.nvim",
  opts = {
    auto_start = true,
    terminal = {
      provider = "none",
    },
    diff_opts = {
      open_in_new_tab = false,
      layout = "vertical",
    },
  },
  -- Talks to an EXTERNAL Claude Code (running in a tmux pane) over the
  -- WebSocket IDE protocol. Kept under <leader>ac so it doesn't clash with
  -- sidekick's <leader>a* keys, which drive sidekick's own embedded terminal.
  keys = {
    { "<leader>ac", "", desc = "+claude code" },
    { "<leader>acf", "<cmd>ClaudeCodeAdd %<cr>", desc = "Send file" },
    { "<leader>act", "<cmd>ClaudeCodeSend<cr>", mode = "v", desc = "Send this (selection)" },
    { "<leader>aca", "<cmd>ClaudeCodeDiffAccept<cr>", desc = "Accept diff" },
    { "<leader>acd", "<cmd>ClaudeCodeDiffDeny<cr>", desc = "Deny diff" },
    { "<leader>ac?", "<cmd>ClaudeCodeStatus<cr>", desc = "Connection status" },
  },
}
