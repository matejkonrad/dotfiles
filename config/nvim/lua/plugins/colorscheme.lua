return {
  -- { "rebelot/kanagawa.nvim" },
  {
    "slugbyte/lackluster.nvim",
    lazy = false,
    priority = 1000,
    opts = {
      tweak_highlight = {
        Visual = {
          overwrite = true,
          bg = "#3a3a3a",
        },
      },
    },
  },
  {
    "datsfilipe/vesper.nvim",
    lazy = false,
    priority = 1000,
    config = function()
      -- Color palette for vesper customization
      -- Vesper's "green" is actually cyan (#99FFE4), so we override with warmer tones
      local sage = "#8a9a7b" -- Muted sage green (actual green)
      local tan = "#D4A373" -- Warm tan/gold
      local cream = "#FFCFA8" -- Vesper's orange/cream
      local muted_fg = "#A0A0A0"
      local dim = "#606060"
      local bg = "#101010" -- Vesper's main bg
      local bg_selection = "#2a2a2a"

      require("vesper").setup({
        transparent = false,
        italics = {
          comments = true,
          keywords = false,
          functions = false,
          strings = false,
          variables = false,
        },
      })

      -- Autocmd to reapply custom highlights when vesper loads
      vim.api.nvim_create_autocmd("ColorScheme", {
        pattern = "vesper",
        callback = function()
          local hl = vim.api.nvim_set_hl

          -- Override vesper's cyan with actual muted green/sage
          hl(0, "DiagnosticInfo", { fg = sage })
          hl(0, "DiagnosticHint", { fg = dim })
          hl(0, "DiagnosticVirtualTextInfo", { fg = sage })
          hl(0, "DiagnosticVirtualTextHint", { fg = dim })
          hl(0, "Special", { fg = tan })

          -- Base floats - same background as main editor
          hl(0, "NormalFloat", { bg = bg })
          hl(0, "FloatBorder", { fg = dim, bg = bg })
          hl(0, "FloatTitle", { fg = tan, bg = bg })

          -- Terminal - same background as main editor
          hl(0, "TermCursor", { bg = muted_fg })
          hl(0, "TermCursorNC", { bg = dim })

          -- Directory/file browsing
          hl(0, "Directory", { fg = sage })

          -- Snacks Picker overrides - same background as main editor
          hl(0, "SnacksPickerNormal", { bg = bg })
          hl(0, "SnacksPickerBorder", { fg = dim, bg = bg })
          hl(0, "SnacksPickerTitle", { fg = tan, bg = bg, bold = true })
          hl(0, "SnacksPickerMatch", { fg = tan, bold = true })
          hl(0, "SnacksPickerSearch", { fg = tan, bold = true })
          hl(0, "SnacksPickerPrompt", { fg = cream })
          hl(0, "SnacksPickerSpecial", { fg = tan })
          hl(0, "SnacksPickerLabel", { fg = tan })
          hl(0, "SnacksPickerSpinner", { fg = tan })
          hl(0, "SnacksPickerIcon", { fg = sage })
          hl(0, "SnacksPickerDir", { fg = sage })
          hl(0, "SnacksPickerDirectory", { fg = sage })
          hl(0, "SnacksPickerFile", { fg = muted_fg })
          hl(0, "SnacksPickerToggle", { fg = sage })
          hl(0, "SnacksPickerToggleOn", { fg = sage })
          hl(0, "SnacksPickerToggleOff", { fg = dim })
          hl(0, "SnacksPickerGitStatus", { fg = tan })
          hl(0, "SnacksPickerGitStatusStaged", { fg = sage })
          hl(0, "SnacksPickerGitBranch", { fg = cream })
          hl(0, "SnacksPickerGitBranchCurrent", { fg = tan })

          -- Snacks Picker List/Preview - same background as main editor
          hl(0, "SnacksPickerListNormal", { bg = bg })
          hl(0, "SnacksPickerListBorder", { fg = dim, bg = bg })
          hl(0, "SnacksPickerPreviewNormal", { bg = bg })
          hl(0, "SnacksPickerPreviewBorder", { fg = dim, bg = bg })
          hl(0, "SnacksPickerInputNormal", { bg = bg })
          hl(0, "SnacksPickerInputBorder", { fg = dim, bg = bg })
          hl(0, "SnacksPickerBoxNormal", { bg = bg })
          hl(0, "SnacksPickerBoxBorder", { fg = dim, bg = bg })

          -- Snacks Explorer
          hl(0, "SnacksExplorerDirectory", { fg = sage })

          -- Snacks Dashboard
          hl(0, "SnacksDashboardNormal", { bg = bg })
          hl(0, "SnacksDashboardIcon", { fg = sage })
          hl(0, "SnacksDashboardKey", { fg = tan })
          hl(0, "SnacksDashboardSpecial", { fg = tan })
          hl(0, "SnacksDashboardTerminal", { bg = bg })

          -- Snacks Indent
          hl(0, "SnacksIndent", { fg = "#282828" })
          hl(0, "SnacksIndentScope", { fg = dim })
          hl(0, "SnacksIndentChunk", { fg = tan })

          -- Sidekick overrides - same background as main editor
          hl(0, "SidekickChat", { bg = bg })
          hl(0, "SidekickSign", { fg = tan })
          hl(0, "SidekickCliAttached", { fg = sage })
          hl(0, "SidekickCliStarted", { fg = cream })
          hl(0, "SidekickCliInstalled", { fg = sage })
          hl(0, "SidekickDiffContext", { bg = bg_selection })
          hl(0, "SidekickDiffAdd", { fg = sage })
          hl(0, "SidekickLocFile", { fg = tan })
          hl(0, "SidekickLocNum", { fg = dim })

          -- WhichKey
          hl(0, "WhichKey", { fg = tan })
          hl(0, "WhichKeyGroup", { fg = sage })
          hl(0, "WhichKeyDesc", { fg = muted_fg })

          -- Flash.nvim - high contrast labels for easy jumping
          hl(0, "FlashLabel", { fg = bg, bg = tan, bold = true, nocombine = true })
          hl(0, "FlashMatch", { fg = cream, bg = "#2a2a2a", nocombine = true })
          hl(0, "FlashCurrent", { fg = bg, bg = cream, bold = true, nocombine = true })
          hl(0, "FlashBackdrop", { fg = "#505050" })
          hl(0, "FlashPrompt", { fg = muted_fg, bg = bg })
          hl(0, "FlashCursor", { reverse = true })
        end,
      })
    end,
  },
  { "EdenEast/nightfox.nvim" }, -- lazy,
  {
    "metalelf0/black-metal-theme-neovim",
    lazy = false,
    priority = 1000,
    config = function()
      require("black-metal").setup({
        -- optional configuration here
        -- theme = "dark-funeral",
        theme = "windir",
      })
      -- require("black-metal").load()

      -- Fix inverted diff colors in immortal theme
      vim.api.nvim_create_autocmd("ColorScheme", {
        pattern = "immortal",
        callback = function()
          local added = vim.api.nvim_get_hl(0, { name = "Added" })
          local removed = vim.api.nvim_get_hl(0, { name = "Removed" })
          local diff_add = vim.api.nvim_get_hl(0, { name = "DiffAdd" })
          local diff_delete = vim.api.nvim_get_hl(0, { name = "DiffDelete" })

          vim.api.nvim_set_hl(0, "Added", { fg = removed.fg })
          vim.api.nvim_set_hl(0, "Removed", { fg = added.fg })
          vim.api.nvim_set_hl(0, "DiffAdd", { bg = diff_delete.bg })
          vim.api.nvim_set_hl(0, "DiffDelete", { bg = diff_add.bg })
        end,
      })
      vim.api.nvim_create_autocmd("ColorScheme", {
        pattern = "windir",
        callback = function()
          local added = vim.api.nvim_get_hl(0, { name = "Added" })
          local removed = vim.api.nvim_get_hl(0, { name = "Removed" })
          local diff_add = vim.api.nvim_get_hl(0, { name = "DiffAdd" })
          local diff_delete = vim.api.nvim_get_hl(0, { name = "DiffDelete" })

          vim.api.nvim_set_hl(0, "Added", { fg = removed.fg })
          vim.api.nvim_set_hl(0, "Removed", { fg = added.fg })
          vim.api.nvim_set_hl(0, "DiffAdd", { bg = diff_delete.bg })
          vim.api.nvim_set_hl(0, "DiffDelete", { bg = diff_add.bg })
          vim.api.nvim_set_hl(0, "FlashLabel", { fg = "#ffffff", bold = false })
        end,
      })
    end,
  },
  {
    "LazyVim/LazyVim",
    opts = {
      -- colorscheme = "lackluster-hack",
      colorscheme = "vesper",
    },
  },
}
