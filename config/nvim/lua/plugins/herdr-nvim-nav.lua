-- Seamless <C-h/j/k/l> navigation between Neovim splits and herdr panes.
-- The herdr side is the herdr-nvim-nav plugin (install once with
-- `herdr plugin install aimdevlee/herdr-nvim-nav`) bound in
-- config/herdr/config.toml; this is the editor side.
--
-- How it works: on startup this writes our PID to
-- $XDG_CACHE_HOME/herdr/nvim-panes/<HERDR_PANE_ID>. The herdr action (a small C
-- binary) reads that marker per keystroke and forwards the chord into nvim when
-- a live nvim owns the pane. Inside nvim the chord moves between splits and, at
-- an edge, crosses into the neighbouring herdr pane over herdr's control socket
-- (no process spawn — this is why it replaced herdr-splits for navigation).
--
-- Resize (<M-h/j/k/l>) is still herdr-splits.nvim, see herdr-splits.lua.
-- Only loads inside a herdr pane (HERDR_ENV=1); vim-tmux-navigator handles the
-- same keys under tmux (gated to HERDR_ENV ~= 1 in tmux-navigator.lua).
--
-- Why the <Plug> indirection: LazyVim maps <C-h/j/k/l> to plain window moves on
-- VeryLazy, which runs AFTER this plugin's setup() and would overwrite maps the
-- plugin sets itself. LazyVim's keymap helper skips any lhs that a lazy.nvim
-- `keys` spec claims, so the user-facing chords are declared here in `keys`
-- and the plugin only maps <Plug> targets they point at.
return {
  "aimdevlee/herdr-nvim-nav",
  cond = vim.env.HERDR_ENV == "1",
  -- Not lazy: the pane marker must exist before the first <C-h/j/k/l> press,
  -- otherwise herdr moves pane focus instead of handing the key to nvim.
  lazy = false,
  opts = {
    with_tmux = false, -- never under tmux inside herdr; skips vim-tmux-navigator
    keymaps = {
      left = { "<Plug>(herdr-nav-left)" },
      down = { "<Plug>(herdr-nav-down)" },
      up = { "<Plug>(herdr-nav-up)" },
      right = { "<Plug>(herdr-nav-right)" },
    },
  },
  config = function(_, opts)
    local nav = require("herdr-nvim-nav")
    if not vim.g.herdr_nvim_daemon then
      nav.setup(opts)
      return
    end
    -- herdr-nvim sidebar daemon: every toggle opens a new herdr pane and
    -- herdr-nvim setenv()s its HERDR_PANE_ID just before the UI attaches.
    -- setup() reads the pane id once, so rerun it on each attach to move the
    -- pane marker and the socket target to the new pane.
    local marker
    local function marker_path(pane)
      local cache = vim.env.XDG_CACHE_HOME
      if not cache or cache == "" then
        cache = vim.env.HOME .. "/.cache"
      end
      return cache .. "/herdr/nvim-panes/" .. pane
    end
    vim.api.nvim_create_autocmd("UIEnter", {
      callback = function()
        local pane = vim.env.HERDR_PANE_ID
        if not pane or pane == "" then
          return
        end
        if marker and marker ~= marker_path(pane) then
          os.remove(marker)
        end
        marker = marker_path(pane)
        nav.setup(opts)
      end,
    })
    -- The daemon outlives the sidebar pane: drop the marker when the UI detaches.
    vim.api.nvim_create_autocmd("UILeave", {
      callback = function()
        if marker then
          os.remove(marker)
          marker = nil
        end
      end,
    })
  end,
  keys = {
    -- <C-arrows> are a plain herdr pane jump (config.toml focus_pane_*) and
    -- never reach nvim, so only the hjkl chords are bound. Terminal-mode
    -- handling (lazygit/tuicr floats) lives in terminal-nav.lua.
    { "<C-h>", "<Plug>(herdr-nav-left)", desc = "Navigate left (nvim/herdr)" },
    { "<C-j>", "<Plug>(herdr-nav-down)", desc = "Navigate down (nvim/herdr)" },
    { "<C-k>", "<Plug>(herdr-nav-up)", desc = "Navigate up (nvim/herdr)" },
    { "<C-l>", "<Plug>(herdr-nav-right)", desc = "Navigate right (nvim/herdr)" },
  },
}
