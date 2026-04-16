return {
  "yetone/avante.nvim",
  enabled = false,
  dependencies = {
    "nvim-lua/plenary.nvim",
    "MunifTanjim/nui.nvim",
    "folke/snacks.nvim", -- for input provider snacks
    "nvim-tree/nvim-web-devicons", -- or echasnovski/mini.icons
    "zbirenbaum/copilot.lua", -- for providers='copilot'
    "MunifTanjim/nui.nvim",
    {
      "MeanderingProgrammer/render-markdown.nvim",
      opts = {
        file_types = { "markdown", "Avante" },
      },
      ft = { "markdown", "Avante" },
    },
  },
  -- LazyVim Avante extra uses lazy.nvim `keys` (not mappings.toggle).
  keys = {
    { "<C-.>", "<cmd>AvanteToggle<CR>", desc = "Toggle Avante" },
  },
  opts = {
    provider = "cursor",
    mode = "normal",

    input = {
      provider = "snacks",
      provider_opts = {
        -- Additional snacks.input options
        title = "Avante Input",
        icon = " ",
      },
    },

    windows = {
      position = "right",
      wrap = true,
      width = 30,
      input = { prefix = "> ", height = 8 },
      ask = { start_insert = false, border = "single" },
      edit = { start_insert = false, border = "single" },
    },

    mappings = {
      submit = {
        normal = "<CR>",
        insert = "<C-s>",
      },
      sidebar = {
        apply_all = "A",
        apply = "a",
        remove = "d",
      },
    },

    behaviour = {
      auto_focus_sidebar = true,
      auto_add_current_file = true,
      auto_apply_diff_after_generation = false,
      minimize_diff = true,
      auto_suggestions = false,
      acp_follow_agent_locations = true,
    },
    providers = {
      claude = {
        auth_type = "max",
      },
    },

    acp_providers = {
      cursor = {
        command = os.getenv("HOME") .. "/.local/bin/agent",
        args = { "acp" },
        auth_method = "cursor_login",
        env = {
          HOME = os.getenv("HOME"),
          PATH = os.getenv("PATH"),
        },
      },
    },
  },
}
