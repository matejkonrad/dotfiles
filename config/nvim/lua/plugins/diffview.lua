return {
  "sindrets/diffview.nvim",
  cmd = { "DiffviewOpen", "DiffviewFileHistory", "DiffviewClose" },
  keys = {
    -- Compare working tree against HEAD (unstaged + staged changes)
    { "<leader>gd", "<cmd>DiffviewOpen<cr>", desc = "Diff Working Tree" },
    -- Compare current branch against origin (what will be pushed)
    { "<leader>gG", "<cmd>DiffviewOpen origin/HEAD...HEAD<cr>", desc = "Diff vs Origin" },
    -- File history for current file
    { "<leader>gh", "<cmd>DiffviewFileHistory %<cr>", desc = "File History" },
    -- File history for entire repo
    { "<leader>gH", "<cmd>DiffviewFileHistory<cr>", desc = "Repo History" },
    -- Current commit details
    { "<leader>gc", "<cmd>DiffviewOpen HEAD~1...HEAD<cr>", desc = "Current Commit Diff" },
    -- Close diffview
    { "<leader>gq", "<cmd>DiffviewClose<cr>", desc = "Close Diffview" },
  },
  opts = {
    diff_binaries = false,
    enhanced_diff_hl = true,
    use_icons = true,
    view = {
      default = {
        layout = "diff2_horizontal", -- side by side
        winbar_info = true,
      },
      merge_tool = {
        layout = "diff3_horizontal",
        disable_diagnostics = true,
      },
      file_history = {
        layout = "diff2_horizontal",
        winbar_info = true,
      },
    },
    file_panel = {
      listing_style = "tree",
      tree_options = {
        flatten_dirs = true,
        folder_statuses = "only_folded",
      },
      win_config = {
        position = "left",
        width = 35,
      },
    },
    file_history_panel = {
      log_options = {
        git = {
          single_file = {
            diff_merges = "combined",
          },
          multi_file = {
            diff_merges = "first-parent",
          },
        },
      },
      win_config = {
        position = "bottom",
        height = 16,
      },
    },
    hooks = {
      -- Allow editing in the right panel (local/working copy)
      view_opened = function()
        -- Right side (b) is editable by default for working tree diffs
        -- This hook can be extended for custom behavior
      end,
    },
    keymaps = {
      view = {
        { "n", "q", "<cmd>DiffviewClose<cr>", { desc = "Close" } },
        { "n", "<leader>e", "<cmd>DiffviewToggleFiles<cr>", { desc = "Toggle file panel" } },
        { "n", "<leader>co", "<cmd>DiffviewConflictPick('ours')<cr>", { desc = "Pick ours" } },
        { "n", "<leader>ct", "<cmd>DiffviewConflictPick('theirs')<cr>", { desc = "Pick theirs" } },
        { "n", "<leader>cb", "<cmd>DiffviewConflictPick('base')<cr>", { desc = "Pick base" } },
        { "n", "<leader>ca", "<cmd>DiffviewConflictPick('all')<cr>", { desc = "Pick all" } },
      },
      file_panel = {
        { "n", "q", "<cmd>DiffviewClose<cr>", { desc = "Close" } },
        { "n", "j", "<cmd>DiffviewFocusEntry<cr>", { desc = "Focus entry" } },
        { "n", "s", "<cmd>DiffviewToggleStage<cr>", { desc = "Stage/unstage" } },
        { "n", "S", "<cmd>DiffviewStageAll<cr>", { desc = "Stage all" } },
        { "n", "U", "<cmd>DiffviewUnstageAll<cr>", { desc = "Unstage all" } },
        { "n", "X", "<cmd>DiffviewRestoreEntry<cr>", { desc = "Restore entry" } },
        { "n", "R", "<cmd>DiffviewRefresh<cr>", { desc = "Refresh" } },
      },
      file_history_panel = {
        { "n", "q", "<cmd>DiffviewClose<cr>", { desc = "Close" } },
        { "n", "y", "<cmd>DiffviewYankHash<cr>", { desc = "Yank commit hash" } },
        { "n", "zR", "<cmd>DiffviewExpandAllFolds<cr>", { desc = "Expand all folds" } },
        { "n", "zM", "<cmd>DiffviewCollapseAllFolds<cr>", { desc = "Collapse all folds" } },
      },
    },
  },
}
