-- Git review, all inside Neovim. Every entry point is <leader>g + one key:
--
--   <leader>gr  pick commits (Tab = multi-select) → Enter codediff, <C-r> tuicr,
--               <C-a> stage the range into the focused herdr agent
--   <leader>gf  same picker, current file only
--   <leader>gb  pick a branch → Enter codediff vs default branch, <C-r> tuicr
--   <leader>gd  codediff working tree
--   <leader>gD  codediff current branch vs origin default branch
--   <leader>gt  tuicr in a full-window float (its own screen picks tree/commits)
--   <leader>ga  send the active tuicr session's comments to the herdr agent
--   <leader>gg  lazygit (LazyVim), <leader>gv codereview.nvim (codereview.lua)
--
-- gr/gf/gb/gd/gD replace LazyVim's snacks pickers on those keys (git log, file
-- history, blame line, diff hunks). Blame is still <leader>ghb.
--
-- tuicr's `e` key jumps back into this Neovim via scripts/tuicr-editor-nvim.

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

---@class GitReviewRange
---@field base string  revision the diff starts from (exclusive)
---@field head string  revision the diff ends at (inclusive)
---@field label string human-readable name for notifications

-- One definition of "the selected range" shared by codediff, tuicr and the
-- agent action, so the three never disagree.
---@param selected snacks.picker.Item[]  newest first, as git log prints
---@return GitReviewRange|nil
local function range_from_commits(selected)
  if not selected or #selected == 0 then
    return nil
  end
  local newest, oldest = selected[1].commit, selected[#selected].commit
  if #selected == 1 then
    return { base = newest .. "~1", head = newest, label = newest }
  end
  return { base = oldest .. "~1", head = newest, label = oldest .. ".." .. newest }
end

---@param item snacks.picker.Item
---@return GitReviewRange|nil
local function range_from_branch(item)
  local branch = item and (item.branch or item.commit)
  if not branch then
    return nil
  end
  local base = "origin/" .. default_remote_branch()
  return { base = base, head = branch, label = base .. "..." .. branch }
end

local function full_float(title)
  -- width/height 0 = full editor, matching the lazygit style (snacks.lua)
  return { position = "float", width = 0, height = 0, border = "none", title = " " .. title .. " ", title_pos = "center" }
end

---@param range GitReviewRange
local function open_codediff(range)
  vim.cmd("CodeDiff " .. range.base .. " " .. range.head)
end

---@param args string[]
local function open_tuicr(args)
  Snacks.terminal.open(vim.list_extend({ "tuicr" }, args), { win = full_float("tuicr") })
end

-- Stage text into the focused herdr agent's prompt (herdr-context.nvim, not
-- submitted). Outside herdr the text goes to the clipboard instead.
---@param payload string
---@param what string
local function send_to_agent(payload, what)
  if vim.env.HERDR_PANE_ID and vim.env.HERDR_PANE_ID ~= "" then
    local ok, err = pcall(function()
      local cfg = require("herdr-context.config").get()
      local targets = require("herdr-context.targets")
      local transport = require("herdr-context.transport")
      targets.resolve(cfg, require("herdr-context.picker"), {}, function(target, terr)
        if not target then
          vim.notify(terr or "No herdr agent", vim.log.levels.ERROR, { title = "git review" })
          return
        end
        transport.stage(cfg, target, payload, function(sent, serr)
          if not sent then
            vim.notify(serr or "Could not stage", vim.log.levels.ERROR, { title = "git review" })
          else
            vim.notify(what .. " staged in " .. (target.agent or "agent"), vim.log.levels.INFO, { title = "git review" })
          end
        end)
      end)
    end)
    if ok then
      return
    end
    vim.notify("herdr-context unavailable: " .. tostring(err), vim.log.levels.WARN, { title = "git review" })
  end
  vim.fn.setreg("+", payload)
  vim.notify(what .. " copied to clipboard (no herdr agent)", vim.log.levels.INFO, { title = "git review" })
end

---@param range GitReviewRange
local function range_summary(range)
  local log = vim.fn.system({ "git", "log", "--oneline", "--no-decorate", range.base .. ".." .. range.head })
  local stat = vim.fn.system({ "git", "diff", "--stat", range.base .. ".." .. range.head })
  return table.concat({
    "Please review the commits " .. range.label .. " (" .. range.base .. ".." .. range.head .. "):",
    "",
    vim.trim(log),
    "",
    vim.trim(stat),
  }, "\n")
end

-- Comments from the active tuicr session of this repo, as the markdown tuicr's
-- own `y` key produces: "N. **[TYPE]** `file:line` - text".
---@return string|nil, string|nil
local function tuicr_comments_markdown()
  local root = vim.trim(vim.fn.system({ "git", "rev-parse", "--show-toplevel" }))
  if vim.v.shell_error ~= 0 then
    return nil, "Not inside a git repository"
  end
  local out = vim.fn.system({ "tuicr", "review", "list", "--repo", root })
  if vim.v.shell_error ~= 0 then
    return nil, "tuicr review list failed: " .. vim.trim(out)
  end
  local ok, sessions = pcall(vim.json.decode, out)
  if not ok or type(sessions) ~= "table" or #sessions == 0 then
    return nil, "No tuicr review session for this repo"
  end
  local session
  for _, s in ipairs(sessions) do
    if s.active then
      session = s
      break
    end
  end
  if not session then
    table.sort(sessions, function(a, b)
      return (a.updated_at or "") > (b.updated_at or "")
    end)
    session = sessions[1]
  end
  out = vim.fn.system({ "tuicr", "review", "comments", "--session", session.slug })
  if vim.v.shell_error ~= 0 then
    return nil, "tuicr review comments failed: " .. vim.trim(out)
  end
  local cok, comments = pcall(vim.json.decode, out)
  if not cok or type(comments) ~= "table" or #comments == 0 then
    return nil, "No comments in tuicr session " .. session.slug
  end
  local lines = { "Review comments from tuicr (" .. session.slug .. "):", "" }
  for i, c in ipairs(comments) do
    local target = type(c.target) == "table" and c.target or c
    local anchor = target.file or ""
    local line = target.line or target.start_line
    if line then
      anchor = anchor .. ":" .. (target.side == "old" and "~" or "") .. line
      if target.end_line and target.end_line ~= line then
        anchor = anchor .. "-" .. target.end_line
      end
    end
    local kind = c.comment_type or c.type
    local tag = (kind and kind ~= "none") and ("**[" .. tostring(kind):upper() .. "]** ") or ""
    local where = anchor ~= "" and ("`" .. anchor .. "` - ") or ""
    lines[#lines + 1] = ("%d. %s%s%s"):format(i, tag, where, vim.trim(c.content or ""))
  end
  return table.concat(lines, "\n")
end

-- Shared picker actions. `confirm` opens codediff; <C-r>/<C-a> are extra keys.
local function review_picker_opts(range_fn)
  local function pick(picker)
    local selected = picker:selected({ fallback = true })
    picker:close()
    return range_fn(selected)
  end
  return {
    title = "Review: Tab select · Enter codediff · C-r tuicr · C-a agent",
    confirm = function(picker)
      local range = pick(picker)
      if range then
        open_codediff(range)
      end
    end,
    actions = {
      review_tuicr = function(picker)
        local range = pick(picker)
        if range then
          open_tuicr({ "-r", range.base .. ".." .. range.head })
        end
      end,
      review_agent = function(picker)
        local range = pick(picker)
        if range then
          send_to_agent(range_summary(range), "Range " .. range.label)
        end
      end,
    },
    win = {
      input = {
        keys = {
          ["<c-r>"] = { "review_tuicr", mode = { "n", "i" }, desc = "Review in tuicr" },
          ["<c-a>"] = { "review_agent", mode = { "n", "i" }, desc = "Send range to agent" },
        },
      },
    },
  }
end

return {
  {
    "esmuellert/codediff.nvim",
    cmd = "CodeDiff",
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
  },
  {
    -- Keys live on the snacks spec so they replace LazyVim's snacks pickers on
    -- the same lhs (gr, gf, gb, gd, gD) instead of racing them.
    "folke/snacks.nvim",
    keys = {
      {
        "<leader>gr",
        function()
          Snacks.picker.git_log(review_picker_opts(range_from_commits))
        end,
        desc = "Review commits (codediff/tuicr/agent)",
      },
      {
        "<leader>gf",
        function()
          Snacks.picker.git_log_file(review_picker_opts(range_from_commits))
        end,
        desc = "Review commits of this file",
      },
      {
        "<leader>gb",
        function()
          local opts = review_picker_opts(function(selected)
            return range_from_branch(selected and selected[1])
          end)
          opts.title = "Review branch vs origin/" .. default_remote_branch() .. " · Enter codediff · C-r tuicr"
          Snacks.picker.git_branches(opts)
        end,
        desc = "Review branch",
      },
      { "<leader>gd", "<cmd>CodeDiff<cr>", desc = "Diff working tree (codediff)" },
      {
        "<leader>gD",
        function()
          vim.cmd("CodeDiff origin/" .. default_remote_branch() .. "...")
        end,
        desc = "Diff branch vs origin default (codediff)",
      },
      {
        "<leader>gt",
        function()
          Snacks.terminal.toggle("tuicr", { win = full_float("tuicr") })
        end,
        desc = "tuicr (code review)",
      },
      {
        "<leader>ga",
        function()
          local md, err = tuicr_comments_markdown()
          if not md then
            vim.notify(err, vim.log.levels.WARN, { title = "git review" })
            return
          end
          send_to_agent(md, "tuicr comments")
        end,
        desc = "Send tuicr comments to agent",
      },
    },
  },
}
