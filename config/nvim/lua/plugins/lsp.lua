-- lua/plugins/lsp.lua
return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        -- SCSS go-to-definition, references, hover, completions
        somesass_ls = {},
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
