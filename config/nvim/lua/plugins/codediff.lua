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
  "esmuellert/codediff.nvim",
  enabled = true,
  cmd = "CodeDiff",
  keys = {
    { "<leader>gad", "<cmd>CodeDiff<cr>", desc = "Diff Working Tree" },
    {
      "<leader>gag",
      function()
        vim.cmd("CodeDiff origin/" .. default_remote_branch() .. "...")
      end,
      desc = "Diff vs Origin Default Branch",
    },
    { "<leader>gau", "<cmd>CodeDiff @{u}...<cr>", desc = "Diff vs Upstream" },
    { "<leader>gah", "<cmd>CodeDiff history %<cr>", desc = "File History" },
    { "<leader>gaH", "<cmd>CodeDiff history<cr>", desc = "Repo History" },
    { "<leader>gac", "<cmd>CodeDiff HEAD~1 HEAD<cr>", desc = "Current Commit Diff" },
    {
      "<leader>gap",
      function()
        Snacks.picker.git_log({
          confirm = function(picker, item)
            picker:close()
            if item and item.commit then
              vim.cmd("CodeDiff " .. item.commit .. "~1 " .. item.commit)
            end
          end,
        })
      end,
      desc = "Pick commit → Diff",
    },
    {
      "<leader>gaF",
      function()
        Snacks.picker.git_log_file({
          confirm = function(picker, item)
            picker:close()
            if item and item.commit then
              vim.cmd("CodeDiff " .. item.commit .. "~1 " .. item.commit)
            end
          end,
        })
      end,
      desc = "Pick commit (current file) → Diff",
    },
    {
      "<leader>gam",
      function()
        Snacks.picker.git_log({
          title = "Tab to multi-select, Enter to diff range",
          confirm = function(picker, _)
            local selected = picker:selected({ fallback = true })
            picker:close()
            if not selected or #selected == 0 then
              return
            end

            if #selected == 1 then
              local c = selected[1].commit
              vim.cmd("CodeDiff " .. c .. "~1 " .. c)
              return
            end

            -- git log is newest-first, so last selected is oldest
            local newest = selected[1].commit
            local oldest = selected[#selected].commit
            vim.cmd("CodeDiff " .. oldest .. "~1 " .. newest)
          end,
        })
      end,
      desc = "Multi-select commits → Diff range",
    },
    {
      "<leader>gaS",
      function()
        vim.ui.input({ prompt = "Git revspec: " }, function(spec)
          if not spec or spec == "" then
            return
          end
          vim.cmd("CodeDiff " .. spec)
        end)
      end,
      desc = "Diff arbitrary revspec",
    },
    { "<leader>gax", "<cmd>tabclose<cr>", desc = "Close Diff Tab" },
    {
      "<leader>gar",
      function()
        vim.ui.input({ prompt = "PR number: " }, function(pr)
          if not pr or pr == "" then
            return
          end
          vim.notify("Checking out PR #" .. pr .. "...", vim.log.levels.INFO)
          vim.fn.jobstart("gh pr checkout " .. pr, {
            on_exit = function(_, code)
              vim.schedule(function()
                if code ~= 0 then
                  vim.notify("Failed to checkout PR #" .. pr, vim.log.levels.ERROR)
                  return
                end
                vim.fn.jobstart("gh pr view " .. pr .. " --json baseRefName -q .baseRefName", {
                  stdout_buffered = true,
                  on_stdout = function(_, data)
                    vim.schedule(function()
                      local base = data[1] and data[1]:gsub("%s+", "") or "main"
                      if base == "" then
                        base = "main"
                      end
                      vim.cmd("CodeDiff origin/" .. base .. "...")
                      vim.notify("Reviewing PR #" .. pr .. " against " .. base, vim.log.levels.INFO)
                    end)
                  end,
                })
              end)
            end,
          })
        end)
      end,
      desc = "Review PR (checkout + codediff)",
    },
  },
  opts = {
    diff = {
      layout = "side-by-side",
      ignore_trim_whitespace = false,
      original_position = "left",
      jump_to_first_change = true,
      cycle_next_hunk = true,
      cycle_next_file = true,
    },
    explorer = {
      position = "left",
      width = 35,
      view_mode = "tree",
      flatten_dirs = true,
      indent_markers = true,
    },
    history = {
      position = "bottom",
      height = 16,
    },
    keymaps = {
      view = {
        quit = "q",
        toggle_explorer = "<leader>b",
        focus_explorer = "<leader>e",
        next_hunk = "]c",
        prev_hunk = "[c",
        next_file = "]f",
        prev_file = "[f",
      },
    },
  },
}
