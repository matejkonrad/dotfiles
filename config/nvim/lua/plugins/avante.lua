return {
  "yetone/avante.nvim",
  enabled = false,
  opts = {
    -- Default to claude-code ACP provider
    provider = "claude-code",
    -- Add cursor ACP alongside the built-in defaults
    windows = {
      ask = { start_insert = false, border = "single" },
      edit = { start_insert = false, border = "single" },
    },
    acp_providers = {
      ["cursor"] = {
        command = "cursor-agent-acp",
        args = {},
        env = {
          NODE_NO_WARNINGS = "1",
        },
      },
    },
  },
}
