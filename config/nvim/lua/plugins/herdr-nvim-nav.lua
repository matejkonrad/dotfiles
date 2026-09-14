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
