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
  keys = (function()
    local keys = {}
    for _, d in ipairs({ { "h", "left" }, { "j", "down" }, { "k", "up" }, { "l", "right" } }) do
      local lhs, dir = "<C-" .. d[1] .. ">", d[2]
      local plug = "<Plug>(herdr-nav-" .. dir .. ")"
      -- <C-arrows> are a plain herdr pane jump (config.toml focus_pane_*) and
      -- never reach nvim, so only the hjkl chords are bound.
      keys[#keys + 1] = { lhs, plug, desc = "Navigate " .. dir .. " (nvim/herdr)" }
      -- Terminal mode too: with lazygit/tuicr/gh-dash open in a full-window
      -- float, herdr hands the chord to nvim (the pane marker says nvim owns
      -- it) and nvim would pass it into the TUI, where it dies. Leave terminal
      -- mode, run the same nav (a float has no split neighbours, so it crosses
      -- into the herdr pane), then re-enter terminal mode if we are still in
      -- the terminal window so the TUI is live when focus comes back.
      keys[#keys + 1] = {
        lhs,
        function()
          local win = vim.api.nvim_get_current_win()
          local esc = vim.api.nvim_replace_termcodes("<C-\\><C-n>" .. plug, true, false, true)
          vim.api.nvim_feedkeys(esc, "m", false)
          vim.schedule(function()
            if vim.api.nvim_get_current_win() == win and vim.bo.buftype == "terminal" then
              vim.cmd("startinsert")
            end
          end)
        end,
        mode = "t",
        desc = "Navigate " .. dir .. " (nvim/herdr)",
      }
    end
    return keys
  end)(),
}
