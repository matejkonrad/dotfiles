-- Reload a buffer as soon as its file changes on disk, e.g. when an agent in
-- another pane edits it. LazyVim only runs :checktime on FocusGained and
-- TermLeave, so a buffer you read while the agent works stays stale.
--
-- One fs_event watcher per file buffer. 'autoread' (options.lua) reloads an
-- unmodified buffer silently; a buffer with unsaved changes gets the usual
-- W12 prompt.
local M = {}

local watchers = {} ---@type table<integer, uv.uv_fs_event_t>
local pending = {} ---@type table<integer, boolean>

local function stop(buf)
  local w = watchers[buf]
  watchers[buf] = nil
  if w and not w:is_closing() then
    w:stop()
    w:close()
  end
end

local check

-- Editors and agents write in bursts (and often as write-temp + rename), so
-- wait a moment and run one :checktime per burst.
local function schedule(buf)
  if pending[buf] then
    return
  end
  pending[buf] = true
  vim.defer_fn(function()
    check(buf)
  end, 100)
end

function M.watch(buf)
  stop(buf)
  if not vim.api.nvim_buf_is_valid(buf) or vim.bo[buf].buftype ~= "" then
    return
  end
  local path = vim.api.nvim_buf_get_name(buf)
  if path == "" or not vim.uv.fs_stat(path) then
    return
  end
  local w = vim.uv.new_fs_event()
  if not w then
    return
  end
  local ok = w:start(path, {}, function(err)
    if not err then
      vim.schedule(function()
        schedule(buf)
      end)
    end
  end)
  if ok then
    watchers[buf] = w
  else
    w:close()
  end
end

check = function(buf)
  pending[buf] = nil
  if not vim.api.nvim_buf_is_valid(buf) then
    return stop(buf)
  end
  -- :checktime is not allowed in the command-line window.
  if vim.fn.getcmdwintype() ~= "" then
    return schedule(buf)
  end
  vim.cmd.checktime(buf)
  -- A rename-style save replaces the inode the watcher follows: re-arm.
  M.watch(buf)
end

function M.setup()
  local group = vim.api.nvim_create_augroup("autoreload", { clear = true })
  vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost", "BufFilePost" }, {
    group = group,
    callback = function(ev)
      M.watch(ev.buf)
    end,
  })
  vim.api.nvim_create_autocmd({ "BufUnload", "BufWipeout" }, {
    group = group,
    callback = function(ev)
      stop(ev.buf)
    end,
  })
  -- autocmds.lua runs on VeryLazy, after the startup buffers are read.
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) then
      M.watch(buf)
    end
  end
end

return M
