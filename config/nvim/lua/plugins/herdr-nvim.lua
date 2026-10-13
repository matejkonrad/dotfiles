-- nvim sidebar + code annotations sent to herdr agents (ChmaraX/herdr-nvim).
-- The herdr side is the chmarax.herdr-nvim plugin (install once with
-- `herdr plugin install ChmaraX/herdr-nvim`), bound in config/herdr/config.toml:
--   prefix+e  toggle the per-tab nvim sidebar
--   prefix+o  pick a file the agent touched
--
-- The sidebar is a headless nvim daemon per tab running this same config
-- (vim.g.herdr_nvim_daemon, set in config/lazy.lua) with a `--remote-ui`
-- client in the pane. The daemon calls setup() again on VimEnter; options merge.
--
-- Default keymaps (prefix <leader>a). Comments live in memory per nvim.
--   <leader>ac  comment line / selection
--   <leader>al  list comments (hover to jump, ⏎ edit, d delete)
--   <leader>as  paste all comments into the agent input (you press Enter)
--   <leader>aS  send all comments to the agent (submits)
--   <leader>ai  reference line / selection at the agent cursor
return {
  "ChmaraX/herdr-nvim",
  cond = vim.env.HERDR_ENV == "1",
  -- Not lazy: setup() must run before the daemon's own VimEnter setup().
  lazy = false,
  opts = {},
}
