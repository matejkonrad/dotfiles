return {
  "yetone/avante.nvim",
  version = false,
  build = "make",
  cmd = {
    "AvanteAsk",
    "AvanteChat",
    "AvanteEdit",
    "AvanteToggle",
    "AvanteFocus",
    "AvanteRefresh",
    "AvanteSwitchProvider",
    "AvanteModels",
    "AvanteHistory",
    "AvanteStop",
    "AvanteClear",
  },
  keys = {
    { "<leader>azn", "<cmd>AvanteAsk<cr>", desc = "Avante: ask", mode = { "n", "v" } },
    { "<leader>aza", "<cmd>AvanteChat<cr>", desc = "Avante: chat" },
    { "<leader>azt", "<cmd>AvanteToggle<cr>", desc = "Avante: toggle sidebar" },
    { "<leader>azf", "<cmd>AvanteFocus<cr>", desc = "Avante: focus sidebar" },
    { "<leader>aze", "<cmd>AvanteEdit<cr>", desc = "Avante: edit", mode = { "n", "v" } },
    { "<leader>azr", "<cmd>AvanteRefresh<cr>", desc = "Avante: refresh" },
    { "<leader>azp", "<cmd>AvanteSwitchProvider<cr>", desc = "Avante: switch provider" },
    { "<leader>azm", "<cmd>AvanteModels<cr>", desc = "Avante: select model" },
    { "<leader>azh", "<cmd>AvanteHistory<cr>", desc = "Avante: history" },
    { "<leader>azs", "<cmd>AvanteStop<cr>", desc = "Avante: stop request" },
    { "<leader>azc", "<cmd>AvanteClear<cr>", desc = "Avante: clear" },
  },
  dependencies = {
    "nvim-treesitter/nvim-treesitter",
    "stevearc/dressing.nvim",
    "nvim-lua/plenary.nvim",
    "MunifTanjim/nui.nvim",
    "nvim-tree/nvim-web-devicons",
    {
      "MeanderingProgrammer/render-markdown.nvim",
      opts = {
        file_types = { "markdown", "Avante" },
      },
      ft = { "markdown", "Avante" },
    },
  },
  opts = {
    provider = "claude-code",
    providers = {
      copilot = {
        model = "claude-sonnet-4",
      },
    },
    acp_providers = {
      ["claude-code"] = {
        command = "npx",
        args = { "@zed-industries/claude-code-acp" },
        env = {
          NODE_NO_WARNINGS = "1",
          ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY"),
        },
      },
      ["gemini-cli"] = {
        command = "gemini",
        args = { "--experimental-acp" },
        env = {
          NODE_NO_WARNINGS = "1",
          GEMINI_API_KEY = os.getenv("GEMINI_API_KEY"),
        },
      },
      ["codex"] = {
        command = "npx",
        args = { "@zed-industries/codex-acp" },
        env = {
          NODE_NO_WARNINGS = "1",
          OPENAI_API_KEY = os.getenv("OPENAI_API_KEY"),
        },
      },
      ["goose"] = {
        command = "goose",
        args = { "acp" },
      },
    },
    behaviour = {
      auto_suggestions = false,
      auto_set_highlight_group = true,
      auto_set_keymaps = false,
      auto_apply_diff_after_generation = false,
      support_paste_from_clipboard = false,
    },
    windows = {
      ask = {
        start_insert = false,
      },
      edit = {
        start_insert = false,
      },
    },
  },
}
