-- Resolve the remote's default branch name (main, master, or whatever
-- `origin/HEAD` points at). Falls back to probing origin/main then
-- origin/master so it works even when `git remote set-head` was never run.
local function default_remote_branch()
  local head = vim.fn.system("git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null")
  if vim.v.shell_error == 0 then
    local branch = head:gsub("^origin/", ""):gsub("%s+", "")
    if branch ~= "" then
      return branch
    end
  end
  vim.fn.system("git rev-parse --verify origin/main 2>/dev/null")
  if vim.v.shell_error == 0 then
    return "main"
  end
  vim.fn.system("git rev-parse --verify origin/master 2>/dev/null")
  if vim.v.shell_error == 0 then
    return "master"
  end
  return "main"
end

return {
  "dlyongemallo/diffview.nvim",
  version = "*",
  cmd = { "DiffviewOpen", "DiffviewFileHistory", "DiffviewClose" },
  keys = {
    { "<leader>gad", "<cmd>DiffviewOpen<cr>", desc = "Diff Working Tree" },
    {
      "<leader>gag",
      function()
        vim.cmd("DiffviewOpen origin/" .. default_remote_branch())
      end,
      desc = "Diff vs Origin Default Branch",
    },
    { "<leader>gau", "<cmd>DiffviewOpen @{u}<cr>", desc = "Diff vs Upstream" },
    { "<leader>gah", "<cmd>DiffviewFileHistory %<cr>", desc = "File History" },
    { "<leader>gaH", "<cmd>DiffviewFileHistory<cr>", desc = "Repo History" },
    { "<leader>gac", "<cmd>DiffviewOpen HEAD~1...HEAD<cr>", desc = "Current Commit Diff" },
    { "<leader>gax", "<cmd>DiffviewClose<cr>", desc = "Close Diffview" },
    {
      "<leader>gar",
      function()
        vim.ui.input({ prompt = "PR number: " }, function(pr)
          if not pr or pr == "" then return end
          vim.notify("Checking out PR #" .. pr .. "...", vim.log.levels.INFO)
          vim.fn.jobstart("gh pr checkout " .. pr, {
            on_exit = function(_, code)
              vim.schedule(function()
                if code ~= 0 then
                  vim.notify("Failed to checkout PR #" .. pr, vim.log.levels.ERROR)
                  return
                end
                -- Get the base branch of the PR
                vim.fn.jobstart("gh pr view " .. pr .. " --json baseRefName -q .baseRefName", {
                  stdout_buffered = true,
                  on_stdout = function(_, data)
                    vim.schedule(function()
                      local base = data[1] and data[1]:gsub("%s+", "") or "main"
                      if base == "" then base = "main" end
                      vim.cmd("DiffviewOpen origin/" .. base .. "...HEAD")
                      vim.notify("Reviewing PR #" .. pr .. " against " .. base, vim.log.levels.INFO)
                    end)
                  end,
                })
              end)
            end,
          })
        end)
      end,
      desc = "Review PR (checkout + diffview)",
    },
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
