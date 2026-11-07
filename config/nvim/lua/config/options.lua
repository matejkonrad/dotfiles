-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

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

-- LSP server to use for TypeScript: the native `tsc` server when the project
-- has TypeScript 7 (or the tsgo native preview), else vtsls. Decided once at
-- startup from the cwd, since there is one nvim per project.
-- Override per project with `vim.g.lazyvim_ts_lsp = "vtsls"` in an exrc.
local function project_has_ts7()
  local pkg = vim.fs.find("package.json", { upward = true, path = vim.fn.getcwd(), type = "file" })[1]
  local root = pkg and vim.fs.dirname(pkg) or vim.fn.getcwd()
  if vim.fn.executable(root .. "/node_modules/.bin/tsgo") == 1 then
    return true
  end
  local ok, lines = pcall(vim.fn.readfile, root .. "/node_modules/typescript/package.json")
  local major = ok and tonumber(table.concat(lines):match('"version"%s*:%s*"(%d+)') or "")
  return type(major) == "number" and major >= 7
end
vim.g.lazyvim_ts_lsp = project_has_ts7() and "tsc" or "vtsls"

-- Tab-indented projects (FramerStudio's .editorconfig sets indent_style = tab
-- with no indent_size) fall back to LazyVim's tabstop=2, which cramps nested
-- JSX. 4 matches how VS Code shows the same files.
vim.opt.tabstop = 4
vim.opt.shiftwidth = 0 -- follow tabstop

-- LazyVim's prettier extra otherwise runs Prettier everywhere, before oxfmt
-- in oxfmt projects like FramerStudio.
vim.g.lazyvim_prettier_needs_config = true

-- Always show the buffer line, even with a single buffer. We own `showtabline`
-- here (bufferline's own toggle is disabled in lua/plugins/bufferline.lua) so
-- that snacks.nvim's dashboard can hide the line while it's up and restore this
-- value (2) the moment a real buffer is opened.
vim.o.showtabline = 2
