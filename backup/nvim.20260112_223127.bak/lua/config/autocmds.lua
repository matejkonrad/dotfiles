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
local redraw_group = vim.api.nvim_create_augroup("fix_reflow_rendering", { clear = true })

vim.api.nvim_create_autocmd({ "WinEnter", "BufEnter", "VimResized" }, {
  group = redraw_group,
  callback = function()
    vim.cmd("redraw")
  end,
})
