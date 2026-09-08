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
  -- WebSocket IDE protocol. Lives under <leader>aC: <leader>ac is herdr-context's
  -- compose key (herdr-context.lua), and sidekick owns the other <leader>a* keys.
  keys = {
    { "<leader>aC", "", desc = "+claude code" },
    { "<leader>aCf", "<cmd>ClaudeCodeAdd %<cr>", desc = "Send file" },
    { "<leader>aCt", "<cmd>ClaudeCodeSend<cr>", mode = "v", desc = "Send this (selection)" },
    { "<leader>aCa", "<cmd>ClaudeCodeDiffAccept<cr>", desc = "Accept diff" },
    { "<leader>aCd", "<cmd>ClaudeCodeDiffDeny<cr>", desc = "Deny diff" },
    { "<leader>aC?", "<cmd>ClaudeCodeStatus<cr>", desc = "Connection status" },
  },
}
