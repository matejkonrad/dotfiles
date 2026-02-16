-- lua/plugins/conform.lua
-- Uses plain opts table so LazyVim deep-merges with defaults
-- Only specify formatters_by_ft entries you want to override/add
return {
  "stevearc/conform.nvim",
  opts = {
    formatters = {
      biome = {
        prefer_local = "node_modules/.bin",
        condition = function(self, ctx)
          return vim.fn.filereadable("biome.json") == 1 or vim.fn.filereadable("biome.jsonc") == 1
        end,
      },
      prettierd = {
        prefer_local = "node_modules/.bin",
      },
    },
    formatters_by_ft = {
      css = { "stylelint", "prettierd", "prettier", stop_after_first = true },
      scss = { "stylelint", "prettierd", "prettier", stop_after_first = true },
    },
  },
}
