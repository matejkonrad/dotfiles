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
    "stevedylandev/darkmatter-nvim",
    lazy = false,
    priority = 1000,
  },
  {
    "datsfilipe/vesper.nvim",
    enabled = true,
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

      -- Diff green/red scale: 10 = subtle bg tint (DiffAdd/DiffDelete),
      -- 100 = vivid bg tint (mini.diff's dedicated old/new overlay groups).
      local diff_green_10 = "#1a2e1a"
      local diff_green_100 = "#2b5c2b"
      local diff_red_10 = "#2e1a1a"
      local diff_red_100 = "#5c2b2b"
      local diff_red_fg = "#c47070" -- brighter/more saturated red, for text (not bg)
      -- DiffChange/DiffText stay neutral (not red/green): Snacks and mini.diff
      -- link their "unchanged context" highlight to DiffChange, so coloring
      -- it breaks their context rendering. This also matches convention --
      -- tokyonight etc. keep DiffChange/DiffText a shared neutral hue at two
      -- brightness levels rather than splitting them by diff side.
      local diff_neutral_10 = "#232323"
      local diff_neutral_100 = "#3a3a3a"

      local indent_subtle = "#282828" -- Snacks indent guide lines
      local conflict_incoming = "#1a1a2e" -- merge conflict "incoming": kept distinct from diff red/green on purpose
      local diffview_filler = "#3a3a3a" -- diffview's blank filler lines (the -----)
      local ghost_text = "#a08770" -- inline completion (copilot-native) ghost text
      local flash_backdrop = "#505050" -- flash.nvim dimmed backdrop

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
          hl(0, "SnacksPickerGitStatusUntracked", { fg = cream })
          hl(0, "SnacksPickerGitStatusAdded", { fg = sage })
          hl(0, "SnacksPickerGitStatusModified", { fg = tan })
          hl(0, "SnacksPickerGitStatusRenamed", { fg = tan })
          hl(0, "SnacksPickerGitStatusDeleted", { fg = diff_red_fg })
          hl(0, "SnacksPickerGitStatusIgnored", { fg = dim })
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
          hl(0, "SnacksIndent", { fg = indent_subtle })
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

          -- Avante
          hl(0, "AvanteSidebarNormal", { bg = bg })
          hl(0, "AvanteSidebarWinSeparator", { fg = dim, bg = bg })
          hl(0, "AvanteSidebarWinHorizontalSeparator", { fg = dim, bg = bg })
          hl(0, "AvanteTitle", { fg = bg, bg = tan })
          hl(0, "AvanteReversedTitle", { fg = tan, bg = bg })
          hl(0, "AvanteSubtitle", { fg = bg, bg = sage })
          hl(0, "AvanteReversedSubtitle", { fg = sage, bg = bg })
          hl(0, "AvanteThirdTitle", { fg = muted_fg, bg = bg_selection })
          hl(0, "AvanteReversedThirdTitle", { fg = bg_selection, bg = bg })
          hl(0, "AvanteInlineHint", { fg = dim, italic = true })
          hl(0, "AvantePopupHint", { fg = dim, bg = bg })
          hl(0, "AvantePromptInput", { bg = bg })
          hl(0, "AvantePromptInputBorder", { fg = dim, bg = bg })
          hl(0, "AvanteConflictCurrent", { bg = diff_green_10 })
          hl(0, "AvanteConflictIncoming", { bg = conflict_incoming })

          -- WhichKey
          hl(0, "WhichKey", { fg = tan })
          hl(0, "WhichKeyGroup", { fg = sage })
          hl(0, "WhichKeyDesc", { fg = muted_fg })

          -- Render Markdown - code block backgrounds
          hl(0, "RenderMarkdownCode", { bg = bg })
          hl(0, "RenderMarkdownCodeInline", { bg = bg })

          -- Diff highlights - bg only so treesitter syntax colors show through
          hl(0, "DiffAdd", { bg = diff_green_10 }) -- subtle green tint
          hl(0, "DiffDelete", { bg = diff_red_10 }) -- subtle red tint
          hl(0, "DiffChange", { bg = diff_neutral_10 }) -- neutral: Snacks/mini.diff link "unchanged context" to this group
          hl(0, "DiffText", { bg = diff_neutral_100, bold = true }) -- brighter neutral accent, not red/green
          hl(0, "Added", { fg = sage })
          hl(0, "Removed", { fg = diff_red_fg })
          hl(0, "Changed", { fg = sage })

          -- mini.diff has dedicated, non-shared groups for each side (unlike
          -- DiffText, nothing else links to these), so a real red/green split
          -- here is safe and intentional. MiniDiffOverChange = old/reference
          -- text, MiniDiffOverChangeBuf = new/buffer text.
          hl(0, "MiniDiffOverChange", { bg = diff_red_100, bold = true })
          hl(0, "MiniDiffOverChangeBuf", { bg = diff_green_100, bold = true })

          -- Diffview specific
          hl(0, "DiffviewDiffAddAsDelete", { bg = diff_red_10 })
          hl(0, "DiffviewDiffDelete", { fg = diffview_filler }) -- filler lines (the -----)

          -- LSP inline completion (copilot-native uses ComplHint, not CopilotSuggestion)
          hl(0, "ComplHint", { fg = ghost_text, italic = true })

          -- Neo-tree: strip italic from all its highlight groups.
          local function strip_italic(group)
            local cur = vim.api.nvim_get_hl(0, { name = group, link = false })
            if cur and next(cur) ~= nil then
              cur.italic = false
              vim.api.nvim_set_hl(0, group, cur)
            end
          end
          for _, g in ipairs({
            "NeoTreeDotfile",
            "NeoTreeFileName",
            "NeoTreeFileNameOpened",
            "NeoTreeGitIgnored",
            "NeoTreeGitUntracked",
            "NeoTreeGitModified",
            "NeoTreeGitAdded",
            "NeoTreeGitConflict",
            "NeoTreeGitDeleted",
            "NeoTreeGitRenamed",
            "NeoTreeGitStaged",
            "NeoTreeGitUnstaged",
            "NeoTreeHiddenByName",
            "NeoTreeDimText",
            "NeoTreeMessage",
            "NeoTreeTitleBar",
            "NeoTreeWinBar",
            "NeoTreeRootName",
            "NeoTreeDirectoryName",
            "NeoTreeFloatTitle",
            "NeoTreeTabActive",
            "NeoTreeTabInactive",
            "NeoTreeTabSeparatorActive",
            "NeoTreeTabSeparatorInactive",
          }) do
            strip_italic(g)
          end

          -- Flash.nvim - high contrast labels for easy jumping
          hl(0, "FlashLabel", { fg = bg, bg = tan, bold = true, nocombine = true })
          hl(0, "FlashMatch", { fg = cream, bg = bg_selection, nocombine = true })
          hl(0, "FlashCurrent", { fg = bg, bg = cream, bold = true, nocombine = true })
          hl(0, "FlashBackdrop", { fg = flash_backdrop })
          hl(0, "FlashPrompt", { fg = muted_fg, bg = bg })
          hl(0, "FlashCursor", { reverse = true })
        end,
      })
    end,
  },
  { "EdenEast/nightfox.nvim", enabled = false },
  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = "vesper",
    },
  },
}
