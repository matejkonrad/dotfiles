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

-- Open a per-(multiplexer session, git worktree) server socket so the
-- open-in-nvim handlers can reach THIS nvim. Keyed by session+worktree so
-- parallel agents in separate worktrees never route to the wrong editor.
local function open_in_nvim_trim(s)
  return (s or ""):gsub("%s+$", "")
end

-- Sockets started for the current worktree; stopped again when the global cwd
-- moves to another worktree (e.g. a lazygit worktree switch, see keymaps.lua).
local open_in_nvim_socks = {}

local function open_in_nvim_register()
  for _, sock in ipairs(open_in_nvim_socks) do
    pcall(vim.fn.serverstop, sock)
  end
  open_in_nvim_socks = {}
  local root = open_in_nvim_trim(vim.fn.system({ "git", "-C", vim.fn.getcwd(), "rev-parse", "--show-toplevel" }))
  if root == "" then
    root = vim.fn.getcwd()
  end

  -- tmux: ⌥-click / `gf` in copy-mode → ~/.local/bin/tmux-open-in-nvim.
  -- Socket name MUST match scripts/tmux-open-in-nvim.
  if vim.env.TMUX_PANE then
    local sid =
      open_in_nvim_trim(vim.fn.system({ "tmux", "display", "-p", "-t", vim.env.TMUX_PANE, "-F", "#{session_id}" }))
    if sid ~= "" then
      local key = vim.fn.sha256(sid .. ":" .. root):sub(1, 16)
      local ok, sock = pcall(vim.fn.serverstart, ("/tmp/nvim-%s.sock"):format(key))
      if ok then
        table.insert(open_in_nvim_socks, sock)
      end
    end
  end

  -- herdr: click a path link in any pane → the open-in-nvim herdr plugin
  -- (config/herdr/plugins/open-in-nvim). Keyed by HERDR_WORKSPACE_ID + worktree.
  -- Socket + .pane sidecar names MUST match open-in-nvim.sh.
  -- The herdr-nvim sidebar daemon is skipped: its pane id changes on every toggle.
  if vim.env.HERDR_PANE_ID and vim.env.HERDR_PANE_ID ~= "" and not vim.g.herdr_nvim_daemon then
    local wsid = vim.env.HERDR_WORKSPACE_ID or ""
    local key = vim.fn.sha256(wsid .. ":" .. root):sub(1, 16)
    local ok, sock = pcall(vim.fn.serverstart, ("/tmp/nvim-herdr-%s.sock"):format(key))
    if ok then
      table.insert(open_in_nvim_socks, sock)
    end
    -- Record this nvim's herdr pane id so the handler can focus it after opening.
    pcall(vim.fn.writefile, { vim.env.HERDR_PANE_ID }, ("/tmp/nvim-herdr-%s.pane"):format(key))
  end

  -- Rex: agents (or any pane) run `rex-open-in-nvim path[:line]` to open a file
  -- here (scripts/rex-open-in-nvim). Keyed by REX_SESSION + worktree.
  -- Socket + .block sidecar names MUST match that script.
  if require("config.rex").session() then
    local key = vim.fn.sha256(vim.env.REX_SESSION .. ":" .. root):sub(1, 16)
    local ok, sock = pcall(vim.fn.serverstart, ("/tmp/nvim-rex-%s.sock"):format(key))
    if ok then
      table.insert(open_in_nvim_socks, sock)
    end
    pcall(vim.fn.writefile, { vim.env.REX_BLOCK }, ("/tmp/nvim-rex-%s.block"):format(key))
  end
end

open_in_nvim_register()
vim.api.nvim_create_autocmd("DirChanged", {
  pattern = "global",
  callback = open_in_nvim_register,
})

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
