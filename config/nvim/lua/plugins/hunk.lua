local function get_repo_root()
  local root = vim.fn.systemlist("git rev-parse --show-toplevel")[1]
  if vim.v.shell_error ~= 0 then
    vim.notify("Not a git repo", vim.log.levels.ERROR)
    return nil
  end
  return root
end

local function get_remote()
  local remotes = vim.fn.systemlist("git remote")
  if #remotes == 0 then return nil end
  for _, r in ipairs(remotes) do
    if r == "origin" then return "origin" end
  end
  return remotes[1]
end

local function get_main_ref()
  local remote = get_remote()
  if not remote then return nil end
  for _, branch in ipairs({ "main", "master" }) do
    vim.fn.system("git rev-parse --verify " .. remote .. "/" .. branch .. " 2>/dev/null")
    if vim.v.shell_error == 0 then
      return remote .. "/" .. branch
    end
  end
  return nil
end

local function export_ref_to_tmpdir(ref, callback)
  local tmpdir = vim.fn.tempname()
  vim.fn.mkdir(tmpdir, "p")
  vim.fn.jobstart("git archive " .. ref .. " | tar -x -C " .. tmpdir, {
    cwd = get_repo_root(),
    on_exit = function(_, code)
      vim.schedule(function()
        if code ~= 0 then
          vim.notify("Failed to export " .. ref, vim.log.levels.ERROR)
          return
        end
        callback(tmpdir)
      end)
    end,
  })
end

local function open_diff_editor(left, right)
  vim.cmd("DiffEditor " .. left .. " " .. right)
end

return {
  "julienvincent/hunk.nvim",
  dependencies = {
    "MunifTanjim/nui.nvim",
  },
  cmd = { "DiffEditor" },
  keys = {
    -- Current changes (working tree vs HEAD) — like git status
    {
      "<leader>gqd",
      function()
        local root = get_repo_root()
        if not root then return end
        export_ref_to_tmpdir("HEAD", function(tmpdir)
          open_diff_editor(tmpdir, root)
        end)
      end,
      desc = "Hunk: Diff working tree vs HEAD",
    },

    -- Diff against remote main/master
    {
      "<leader>gqm",
      function()
        local root = get_repo_root()
        if not root then return end
        local ref = get_main_ref()
        if not ref then
          vim.notify("Could not find main/master on any remote", vim.log.levels.ERROR)
          return
        end
        export_ref_to_tmpdir(ref, function(tmpdir)
          open_diff_editor(tmpdir, root)
          vim.notify("Hunk: diff vs " .. ref, vim.log.levels.INFO)
        end)
      end,
      desc = "Hunk: Diff vs main",
    },

    -- Diff against a custom branch
    {
      "<leader>gqb",
      function()
        vim.ui.input({ prompt = "Branch: " }, function(branch)
          if not branch or branch == "" then return end
          local root = get_repo_root()
          if not root then return end
          export_ref_to_tmpdir(branch, function(tmpdir)
            open_diff_editor(tmpdir, root)
            vim.notify("Hunk: diff vs " .. branch, vim.log.levels.INFO)
          end)
        end)
      end,
      desc = "Hunk: Diff vs custom branch",
    },

    -- Review a PR (checkout + diff against its base)
    {
      "<leader>gqr",
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
                vim.fn.jobstart("gh pr view " .. pr .. " --json baseRefName -q .baseRefName", {
                  stdout_buffered = true,
                  on_stdout = function(_, data)
                    vim.schedule(function()
                      local base = data[1] and data[1]:gsub("%s+", "") or "main"
                      if base == "" then base = "main" end
                      local root = get_repo_root()
                      if not root then return end
                      local remote = get_remote() or "origin"
                      export_ref_to_tmpdir(remote .. "/" .. base, function(tmpdir)
                        open_diff_editor(tmpdir, root)
                        vim.notify("Hunk: reviewing PR #" .. pr .. " vs " .. base, vim.log.levels.INFO)
                      end)
                    end)
                  end,
                })
              end)
            end,
          })
        end)
      end,
      desc = "Hunk: Review PR",
    },
  },
  opts = {
    keys = {
      global = {
        quit = { "q" },
        accept = { "<leader><CR>" },
        focus_tree = { "<leader>e" },
      },
      tree = {
        expand_node = { "l", "<Right>" },
        collapse_node = { "h", "<Left>" },
        open_file = { "<CR>" },
        toggle_file = { "a" },
      },
      diff = {
        toggle_hunk = { "A" },
        toggle_line = { "a" },
        toggle_line_pair = { "s" },
        prev_hunk = { "[h" },
        next_hunk = { "]h" },
        toggle_focus = { "<Tab>" },
      },
    },
    ui = {
      tree = {
        mode = "nested",
        width = 35,
      },
      layout = "vertical",
    },
    icons = {
      enable_file_icons = true,
    },
  },
}
