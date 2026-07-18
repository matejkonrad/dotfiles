return {
  "olimorris/codecompanion.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-treesitter/nvim-treesitter",
  },
  cmd = {
    "CodeCompanion",
    "CodeCompanionChat",
    "CodeCompanionActions",
    "CodeCompanionCLI",
  },
  keys = {
    { "<leader>ay", "<cmd>CodeCompanionChat Toggle<cr>", desc = "CodeCompanion: toggle chat", mode = { "n", "v" } },
    { "<leader>ayo", "<cmd>CodeCompanionChat adapter=opencode<cr>", desc = "CodeCompanion: chat via OpenCode" },
    { "<leader>ayc", "<cmd>CodeCompanionChat adapter=claude_code<cr>", desc = "CodeCompanion: chat via Claude Code" },
    { "<leader>ayi", "<cmd>CodeCompanion<cr>", desc = "CodeCompanion: inline", mode = { "n", "v" } },
    { "<leader>ayl", "<cmd>CodeCompanionCLI<cr>", desc = "CodeCompanion: CLI (default agent)" },
    { "<leader>ayk", "<cmd>CodeCompanionCLI agent=opencode<cr>", desc = "CodeCompanion: CLI via OpenCode" },
    { "<C-a>", "<cmd>CodeCompanionActions<cr>", desc = "CodeCompanion: actions", mode = { "n", "v" } },
  },
  opts = {
    adapters = {
      acp = {
        -- The claude_code preset expects a `claude-agent-acp` binary on PATH,
        -- which isn't installed here; run it via npx instead (same approach
        -- avante.lua used). Also needs CLAUDE_CODE_OAUTH_TOKEN (from
        -- `claude setup-token`) or ANTHROPIC_API_KEY before it'll connect.
        claude_code = function()
          return require("codecompanion.adapters").extend("claude_code", {
            commands = {
              default = { "npx", "-y", "@zed-industries/claude-code-acp" },
            },
          })
        end,
      },
    },
    interactions = {
      -- Default chat agent. `opencode` is installed and works with zero
      -- extra config; switch per-buffer with `:CodeCompanionChat adapter=<name>`.
      chat = {
        adapter = "opencode",
      },
      -- Raw terminal wrapper around CLI agents (`:CodeCompanionCLI`), separate
      -- from the ACP chat buffer above. Switch with `:CodeCompanionCLI agent=<name>`.
      cli = {
        agent = "opencode",
        agents = {
          opencode = {
            cmd = "opencode",
            args = {},
            description = "OpenCode CLI",
          },
          claude_code = {
            cmd = "claude",
            args = {},
            description = "Claude Code CLI",
          },
        },
      },
    },
  },
}
