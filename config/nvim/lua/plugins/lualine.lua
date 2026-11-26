-- Statusline colours follow the active theme (lua/config/theme.lua). For
-- gruvbox, that is gruvbox-material's own lualine theme (shipped in
-- lualine.nvim) instead of LazyVim's "auto", which derives a flatter palette
-- from generic highlight groups.
--
-- The first lualine_x item shows the Claude Code sessions working in this
-- project (lua/config/agent_status.lua).
return {
  "nvim-lualine/lualine.nvim",
  opts = function(_, opts)
    opts.options.theme = require("config.theme").current().lualine

    local agents = require("config.agent_status")
    agents.start()
    table.insert(opts.sections.lualine_x, 1, {
      agents.text,
      cond = agents.visible,
      color = agents.color,
    })
  end,
}
