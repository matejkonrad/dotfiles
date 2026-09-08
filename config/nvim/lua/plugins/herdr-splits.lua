-- Seamless RESIZE between Neovim splits and herdr panes.
-- The herdr side is the herdr-splits plugin (install once with
-- `herdr plugin install lmilojevicc/herdr-splits.nvim`) bound in
-- config/herdr/config.toml; this is the editor side.
--
--   <M-h/j/k/l> ....... resize nvim splits, delegate to herdr when a split fills the pane
--
-- Navigation (<C-h/j/k/l>) moved to herdr-nvim-nav (see herdr-nvim-nav.lua):
-- herdr-splits spawned a process per keystroke and was noticeably slow.
-- herdr-nvim-nav has no resize actions, so herdr-splits stays for that only.
--
-- Only loads inside a herdr pane (HERDR_ENV=1).
return {
  "lmilojevicc/herdr-splits.nvim",
  cond = vim.env.HERDR_ENV == "1",
  event = "VeryLazy",
  opts = {
    at_edge = "wrap",
    unzoom_on_nav = true,
  },
  keys = {
    { "<M-h>", function() require("herdr-splits").resize_left() end, desc = "Resize left (nvim/herdr)" },
    { "<M-j>", function() require("herdr-splits").resize_down() end, desc = "Resize down (nvim/herdr)" },
    { "<M-k>", function() require("herdr-splits").resize_up() end, desc = "Resize up (nvim/herdr)" },
    { "<M-l>", function() require("herdr-splits").resize_right() end, desc = "Resize right (nvim/herdr)" },
  },
}
