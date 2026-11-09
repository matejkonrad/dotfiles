-- nvim sidebar + code annotations sent to coding agents (ChmaraX/herdr-nvim).
-- The herdr side is the chmarax.herdr-nvim plugin (install once with
-- `herdr plugin install ChmaraX/herdr-nvim`), bound in config/herdr/config.toml:
--   prefix+e  toggle the per-tab nvim sidebar
--   prefix+o  pick a file the agent touched
--
-- The sidebar is a headless nvim daemon per tab running this same config
-- (vim.g.herdr_nvim_daemon, set in config/lazy.lua) with a `--remote-ui`
-- client in the pane. The daemon calls setup() again on VimEnter; options merge.
--
-- Under Rex the plugin's only herdr calls (agents.list/resolve and
-- dispatch.send) are swapped for config/rex.lua, so the same comment UI sends
-- to agent blocks in this Rex session.
--
-- Default keymaps (prefix <leader>a). Comments live in memory per nvim.
--   <leader>ac  comment line / selection
--   <leader>al  list comments (hover to jump, ⏎ edit, d delete)
--   <leader>as  paste all comments into the agent input (you press Enter)
--   <leader>aS  send all comments to the agent (submits)
--   <leader>ai  reference line / selection at the agent cursor
-- Added here:
--   <leader>aa  pick the target agent; later sends go to it until you pick again
--   <leader>ad  (Rex) stage the dev server's last 80 lines at the agent
--
-- Upstream resolve() always sends to the lone agent in this tab, with no way to
-- reach another one. The pin wraps resolve(), so herdr-nvim's own sends and
-- git-review.lua's send_to_agent() both follow it. A pin to a closed agent is
-- dropped and resolve() falls back to the upstream rule.
local function rex_session()
  return require("config.rex").session()
end

-- Swap herdr-nvim's herdr calls for Rex ones. Agents keep herdr-nvim's shape
-- (pane_id, tab_id, kind, status, cwd, title) so ui/init code is unchanged.
local function use_rex(agents, dispatch)
  local rex = require("config.rex")
  local session = rex.session()

  agents.list = function()
    local list, err = rex.agents()
    if not list then
      return nil, "rex: " .. tostring(err)
    end
    local out = {}
    for _, a in ipairs(list) do
      table.insert(out, {
        pane_id = a.block_id,
        tab_id = a.window_id,
        kind = a.name,
        status = "unknown",
        cwd = a.cwd or "",
        title = a.name,
      })
    end
    return out
  end

  -- Rex tab (window) of this nvim block, for the "lone agent in this tab" rule.
  local function current_window()
    local res = vim.system({ "rex", "block", "inspect", "-s", session, vim.env.REX_BLOCK, "--json" }, { text = true }):wait()
    if res.code ~= 0 then
      return nil
    end
    local ok, decoded = pcall(vim.json.decode, res.stdout)
    return ok and decoded.block and decoded.block.window_id or nil
  end

  agents.resolve = function(list)
    if #list == 1 then
      return list[1]
    end
    local window = current_window()
    local in_tab = vim.tbl_filter(function(a)
      return a.tab_id == window
    end, list)
    return #in_tab == 1 and in_tab[1] or nil
  end

  dispatch.send = function(block_id, text, opts)
    local res = vim.system({ "rex", "send", "-s", session, "-b", block_id, "--", text }, { text = true }):wait()
    if res.code ~= 0 then
      return false, "rex send failed: " .. vim.trim(res.stderr or "")
    end
    if opts and opts.submit then
      -- Separate Enter, so the agent treats the text as a paste and then submits.
      vim.wait(100)
      vim.system({ "rex", "send", "-s", session, "-b", block_id, "\r" }):wait()
    end
    vim.system({ "rex", "focus", "-s", session, block_id })
    return true
  end
end

return {
  "ChmaraX/herdr-nvim",
  cond = function()
    return vim.env.HERDR_ENV == "1" or vim.g.herdr_app or rex_session() ~= nil
  end,
  -- Not lazy: setup() must run before the daemon's own VimEnter setup().
  lazy = false,
  opts = {},
  config = function(_, opts)
    local agents = require("herdr-nvim.agents")
    local dispatch = require("herdr-nvim.dispatch")
    local on_rex = vim.env.HERDR_ENV ~= "1" and rex_session() ~= nil
    if on_rex then
      use_rex(agents, dispatch)
    end

    require("herdr-nvim").setup(opts)

    -- A nvim you start yourself in a Herdr desktop app terminal: list and
    -- send to agents through the app's herdr-nvim binary (app-agents,
    -- app-send), like the app's own tab nvim. Switched on after setup(), so
    -- the app-only tree setup (herdr-nvim.app) stays off here.
    local exec = require("herdr-nvim.exec")
    if vim.g.herdr_app and not exec.is_app() then
      vim.env.HERDR_NVIM_SELF = vim.env.HERDR_NVIM_SELF
        or vim.fn.expand("~/.config/herdr-app/mods/herdr-nvim/bin/herdr-nvim")
      exec.is_app = function()
        return true
      end
    end

    -- Pin: wrap resolve() so later sends go to the picked agent.
    local upstream_resolve = agents.resolve
    local pinned -- pane_id (herdr) or block_id (Rex)
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

    -- Rex only: stage the dev server's recent output at the agent. Goes through
    -- agents.resolve, so it follows the <leader>aa pin like the comments do.
    if on_rex then
      vim.keymap.set("n", "<leader>ad", function()
        local log, err = require("config.rex").dev_log(80)
        if not log then
          return vim.notify("rex: " .. tostring(err), vim.log.levels.WARN)
        end
        local payload = "Dev server output (last 80 lines):\n```\n" .. log .. "\n```\n"
        local list, lerr = agents.list()
        if not list then
          return vim.notify("herdr-nvim: " .. lerr, vim.log.levels.ERROR)
        end
        local function deliver(agent)
          local ok, serr = dispatch.send(agent.pane_id, payload, { submit = false })
          if not ok then
            vim.notify("herdr-nvim: " .. serr, vim.log.levels.ERROR)
          end
        end
        local agent = agents.resolve(list)
        if agent then
          deliver(agent)
        else
          require("herdr-nvim.ui").pick_agent(list, deliver)
        end
      end, { desc = "Send dev server log to agent" })
    end
  end,
}
