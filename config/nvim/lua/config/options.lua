-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

-- Explicitly set background to prevent detection issues in terminal multiplexers (Zellij/tmux)
vim.o.background = "dark"

-- Workaround for Neovim 0.11 terminal reflow rendering bug
-- https://github.com/neovim/neovim/issues/33133
vim.opt.scrollback = 1000 -- Reduce scrollback to minimize reflow impact
vim.opt.lazyredraw = false -- Force immediate redraws
vim.opt.redrawtime = 5000 -- Increase redraw timeout
