-- lua/plugins/lsp.lua
return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        -- WGSL language server
        wgsl_analyzer = {},
        -- CSS Modules go-to-definition from JS/TS to .module.scss
        cssmodules_ls = {},
        -- SCSS hover, completions, diagnostics
        somesass_ls = {
          on_attach = function(client, bufnr)
            client.server_capabilities.definitionProvider = false
          end,
        },
        -- Only enable biome LSP in projects that have a biome config
        biome = {
          root_dir = function(fname)
            return require("lspconfig.util").root_pattern("biome.json", "biome.jsonc")(fname)
          end,
          on_attach = function(client, bufnr)
            client.server_capabilities.documentFormattingProvider = false
          end,
        },
      },
    },
  },
}
