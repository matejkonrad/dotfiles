-- herdr-nvim sidebar daemon: a headless nvim that herdr-nvim starts per tab
-- and listens under .../herdr-nvim/<tab>.sock (see lua/plugins/herdr-nvim.lua).
-- Mark it before the specs load, so the herdr-gated plugins (cond =
-- HERDR_ENV == "1") also load in the sidebar.
vim.g.herdr_nvim_daemon = vim.v.servername:find("/herdr-nvim/", 1, true) ~= nil
if vim.g.herdr_nvim_daemon then
  vim.env.HERDR_ENV = "1"
end

-- Herdr desktop app: its terminals run under herdr-core (HC_TERMINAL_ID) and
-- its herdr-nvim daemon sets HERDR_NVIM_HOST=app. The TUI's pane plugins
-- (herdr-nvim-nav, herdr-splits) talk to the TUI socket, so they stay off here
-- and config/keymaps.lua maps <C-h/j/k/l> for the app instead.
-- tmux or Rex inside an app terminal owns <C-h/j/k/l> there, so those stay off.
vim.g.herdr_app = (
  vim.env.HERDR_NVIM_HOST == "app"
  or (vim.env.HC_TERMINAL_ID ~= nil and vim.env.HERDR_PANE_ID == nil)
)
  and vim.env.TMUX == nil
  and vim.env.REX_SESSION == nil

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  local lazyrepo = "https://github.com/folke/lazy.nvim.git"
  local out = vim.fn.system({ "git", "clone", "--filter=blob:none", "--branch=stable", lazyrepo, lazypath })
  if vim.v.shell_error ~= 0 then
    vim.api.nvim_echo({
      { "Failed to clone lazy.nvim:\n", "ErrorMsg" },
      { out, "WarningMsg" },
      { "\nPress any key to exit..." },
    }, true, {})
    vim.fn.getchar()
    os.exit(1)
  end
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
  spec = {
    -- add LazyVim and import its plugins
    { "LazyVim/LazyVim", import = "lazyvim.plugins" },
    -- import/override with your plugins
    { import = "plugins" },
  },
  defaults = {
    -- By default, only LazyVim plugins will be lazy-loaded. Your custom plugins will load during startup.
    -- If you know what you're doing, you can set this to `true` to have all your custom plugins lazy-loaded by default.
    lazy = false,
    -- It's recommended to leave version=false for now, since a lot the plugin that support versioning,
    -- have outdated releases, which may break your Neovim install.
    version = false, -- always use the latest git commit
    -- version = "*", -- try installing the latest stable version for plugins that support semver
  },
  install = { colorscheme = { "tokyonight", "habamax" } },
  checker = {
    enabled = true, -- check for plugin updates periodically
    notify = false, -- notify on update
  }, -- automatically check for plugin updates
  rocks = { enabled = false },
  performance = {
    rtp = {
      -- disable some rtp plugins
      disabled_plugins = {
        "gzip",
        -- "matchit",
        -- "matchparen",
        -- "netrwPlugin",
        "tarPlugin",
        "tohtml",
        "tutor",
        "zipPlugin",
      },
    },
  },
})
