-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
--
-- Add any additional autocmds here
-- with `vim.api.nvim_create_autocmd`
--
-- Or remove existing autocmds by their group name (which is prefixed with `lazyvim_` for the defaults)
-- e.g. vim.api.nvim_del_augroup_by_name("lazyvim_wrap_spell")

-- Workaround for Neovim 0.11 terminal reflow rendering bug
-- Force redraws only on events that commonly trigger the bug
-- local redraw_group = vim.api.nvim_create_augroup("fix_reflow_rendering", { clear = true })

-- vim.api.nvim_create_autocmd({ "WinEnter", "BufEnter", "VimResized" }, {
--   group = redraw_group,
--   callback = function()
--     vim.cmd("redraw")
--   end,
-- })

vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
  pattern = { ".env*" },
  callback = function()
    vim.diagnostic.enable(false, { bufnr = 0 })
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = { "markdown" },
  callback = function()
    vim.diagnostic.enable(false, { bufnr = 0 })
  end,
})

-- Open a per-(tmux session, git worktree) server socket so the tmux
-- open-in-nvim handler (⌥-click / `gf` in copy-mode → ~/.local/bin/tmux-open-in-nvim)
-- can reach THIS nvim. Keyed by session+worktree so parallel agents in separate
-- worktrees never route to the wrong editor. The socket name MUST match the one
-- built in scripts/tmux-open-in-nvim.
if vim.env.TMUX_PANE then
  local function trim(s)
    return (s or ""):gsub("%s+$", "")
  end
  local sid = trim(vim.fn.system({ "tmux", "display", "-p", "-t", vim.env.TMUX_PANE, "-F", "#{session_id}" }))
  local ws = trim(vim.fn.system({ "git", "-C", vim.fn.getcwd(), "rev-parse", "--show-toplevel" }))
  if ws == "" then
    ws = vim.fn.getcwd()
  end
  if sid ~= "" then
    local key = vim.fn.sha256(sid .. ":" .. ws):sub(1, 16)
    pcall(vim.fn.serverstart, ("/tmp/nvim-%s.sock"):format(key))
  end
end

-- Auto-wipe unnamed empty buffers when they become hidden (avoids the stray
-- "[No Name]" buffers that linger after creating/opening new files).
vim.api.nvim_create_autocmd("BufHidden", {
  callback = function(args)
    local buf = args.buf
    if not vim.api.nvim_buf_is_valid(buf) then return end
    if vim.api.nvim_buf_get_name(buf) ~= "" then return end
    if vim.bo[buf].buftype ~= "" then return end
    if vim.bo[buf].modified then return end
    local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    if #lines > 1 or (lines[1] and lines[1] ~= "") then return end
    vim.schedule(function()
      if vim.api.nvim_buf_is_valid(buf) then
        pcall(vim.api.nvim_buf_delete, buf, { force = false })
      end
    end)
  end,
})
