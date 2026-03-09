-- Copilot Language Server for sidekick.nvim NES (Next Edit Suggestions)
-- https://github.com/folke/sidekick.nvim#-requirements
return {
  cmd = { vim.fn.expand("~/.local/share/nvim/mason/bin/copilot-language-server"), "--stdio" },
  filetypes = { "*" }, -- enable for all filetypes
  root_markers = { ".git" },
  settings = {
    telemetry = {
      telemetryLevel = "off",
    },
  },
  on_init = function(client)
    -- Required for Copilot LSP authentication
    client.notify("workspace/didChangeConfiguration", {
      settings = client.config.settings,
    })
  end,
}
