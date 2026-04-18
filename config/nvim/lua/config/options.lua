-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

-- Enable Copilot LSP for sidekick.nvim NES (Next Edit Suggestions)
-- vim.lsp.enable("copilot")

-- Explicitly set background to prevent detection issues in terminal multiplexers (Zellij/tmux)
vim.o.background = "dark"

-- Auto-reload files changed outside Neovim
vim.o.autoread = true

-- Smoother scrolling
vim.o.smoothscroll = true

-- Show relative line numbers
vim.o.relativenumber = true
