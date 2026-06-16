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

-- Bordered diagnostic floats and LSP hovers
vim.diagnostic.config({
  float = { border = "rounded", source = true },
})
vim.o.winborder = "rounded"

-- Bordered LSP signature help (winborder doesn't apply to gK by default)
local orig_signature_help = vim.lsp.buf.signature_help
vim.lsp.buf.signature_help = function(config)
  return orig_signature_help(vim.tbl_extend("keep", config or {}, {
    border = "rounded",
  }))
end

-- LSP server to use for TypeScript. Forcing vtsls: tsgo (TS native preview)
-- still lacks the add-missing-import code action (typescript-go #3318), so
-- <leader>ca couldn't auto-import. vtsls is slower/heavier but has full code
-- actions. To go back to auto-picking tsgo when a project ships it locally,
-- delete the last line and restore the three commented ones.
-- local pkg = vim.fs.find("package.json", { upward = true, path = vim.fn.getcwd(), type = "file" })[1]
-- local root = pkg and vim.fs.dirname(pkg) or vim.fn.getcwd()
-- vim.g.lazyvim_ts_lsp = vim.fn.executable(root .. "/node_modules/.bin/tsgo") == 1 and "tsgo" or "vtsls"
vim.g.lazyvim_ts_lsp = "vtsls"
