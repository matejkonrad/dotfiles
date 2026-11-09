-- Neovim side of Rex (superlogical): <C-h/j/k/l> across nvim splits and Rex
-- panes, and file/line references sent to the agent pane in the same session.
-- The Rex side of the navigation is config/rex/init.lua: it hands the chord to
-- nvim when nvim is the pane's foreground program. Logic: config/rex.lua.
--
--   <leader>af  reference the whole file
-- <leader>ai (line / selection) comes from herdr-nvim.lua, which runs under Rex
-- too and follows its <leader>aa agent pin.
--
-- Only inside a Rex pane outside herdr/tmux (their navigators own the keys
-- there). A virtual spec: no plugin to install, the `keys` claim the chords
-- before LazyVim's default <C-h/j/k/l> window maps (see herdr-nvim-nav.lua).
-- lazy.nvim rejects a spec without a source, hence the (unused) dir.
return {
  name = "rex-nav",
  dir = vim.fn.stdpath("config"),
  virtual = true,
  cond = require("config.rex").session() ~= nil,
  keys = {
    -- Terminal-mode handling (lazygit/tuicr floats) lives in terminal-nav.lua.
    { "<C-h>", function() require("config.rex").navigate("h") end, desc = "Navigate left (nvim/rex)" },
    { "<C-j>", function() require("config.rex").navigate("j") end, desc = "Navigate down (nvim/rex)" },
    { "<C-k>", function() require("config.rex").navigate("k") end, desc = "Navigate up (nvim/rex)" },
    { "<C-l>", function() require("config.rex").navigate("l") end, desc = "Navigate right (nvim/rex)" },
    { "<leader>af", function() require("config.rex").reference() end, desc = "Reference file at agent" },
  },
}
