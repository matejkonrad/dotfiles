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
-- Added here:
--   <leader>aa  pick the target agent; later sends go to it until you pick again
--
-- Upstream resolve() always sends to the lone agent in this tab, with no way to
-- reach another one. The pin wraps resolve(), so herdr-nvim's own sends and
-- git-review.lua's send_to_agent() both follow it. A pin to a closed agent is
-- dropped and resolve() falls back to the upstream rule.
return {
  "ChmaraX/herdr-nvim",
  cond = vim.env.HERDR_ENV == "1",
  -- Not lazy: setup() must run before the daemon's own VimEnter setup().
  lazy = false,
  opts = {},
  config = function(_, opts)
    require("herdr-nvim").setup(opts)
    local agents = require("herdr-nvim.agents")
    local upstream_resolve = agents.resolve
    local pinned -- pane_id
    agents.resolve = function(list)
      for _, a in ipairs(list) do
        if a.pane_id == pinned then
          return a
        end
      end
      pinned = nil
      return upstream_resolve(list)
    end
    vim.keymap.set("n", "<leader>aa", function()
      local list, err = agents.list()
      if not list then
        return vim.notify("herdr-nvim: " .. err, vim.log.levels.ERROR)
      end
      require("herdr-nvim.ui").pick_agent(list, function(agent)
        pinned = agent.pane_id
        vim.notify("herdr-nvim: sending to " .. agents.display(agent))
      end)
    end, { desc = "Pick target agent" })
  end,
}
