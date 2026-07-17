-- Seamless navigation + resizing between Neovim splits and herdr panes.
-- The herdr side is the herdr-splits plugin (install once with
-- `herdr plugin install lmilojevicc/herdr-splits.nvim`) bound in
-- config/herdr/config.toml; this is the editor side.
--
--   <C-h/j/k/l> ....... move between nvim splits, cross into herdr panes at edges
--   <M-h/j/k/l> ....... resize nvim splits, delegate to herdr when a split fills the pane
--
-- Only loads inside a herdr pane (HERDR_ENV=1); vim-tmux-navigator handles the
-- same keys under tmux (it is gated to HERDR_ENV ~= 1 in tmux-navigator.lua).
return {
  "lmilojevicc/herdr-splits.nvim",
  cond = vim.env.HERDR_ENV == "1",
  event = "VeryLazy",
  opts = {
    at_edge = "wrap",
    nav_at_edge = "wrap",
    unzoom_on_nav = true,
  },
  keys = {
    { "<C-h>", function() require("herdr-splits").move_cursor_left() end, desc = "Navigate left (nvim/herdr)" },
    { "<C-j>", function() require("herdr-splits").move_cursor_down() end, desc = "Navigate down (nvim/herdr)" },
    { "<C-k>", function() require("herdr-splits").move_cursor_up() end, desc = "Navigate up (nvim/herdr)" },
    { "<C-l>", function() require("herdr-splits").move_cursor_right() end, desc = "Navigate right (nvim/herdr)" },
    { "<M-h>", function() require("herdr-splits").resize_left() end, desc = "Resize left (nvim/herdr)" },
    { "<M-j>", function() require("herdr-splits").resize_down() end, desc = "Resize down (nvim/herdr)" },
    { "<M-k>", function() require("herdr-splits").resize_up() end, desc = "Resize up (nvim/herdr)" },
    { "<M-l>", function() require("herdr-splits").resize_right() end, desc = "Resize right (nvim/herdr)" },
  },
}
