-- lua/plugins/lsp.lua

-- Detect whether the current project can use TypeScript 7's native LSP.
-- Evaluated once at startup, based on the cwd nvim was opened in.
-- (One nvim per project, so cwd == project root.)
local function project_has_ts7()
  local root = vim.fn.getcwd()

  -- 1. Native preview ships a `tsgo` binary into node_modules/.bin
  if vim.fn.executable(root .. "/node_modules/.bin/tsgo") == 1 then
    return true
  end

  -- 2. Or the project pins typescript to the v7 native rewrite
  local pkg = root .. "/node_modules/typescript/package.json"
  if vim.fn.filereadable(pkg) == 1 then
    local ok, lines = pcall(vim.fn.readfile, pkg)
    if ok then
      local major = table.concat(lines):match('"version"%s*:%s*"(%d+)')
      if major and tonumber(major) >= 7 then
        return true
      end
    end
  end

  return false
end

-- Manual override wins if set (e.g. `vim.g.use_ts7 = true` in a project exrc).
-- Otherwise auto-detect: TS7 if available, else fall back to vtsls (TS6).
local use_ts7 = false
-- if vim.g.use_ts7 ~= nil then
--   use_ts7 = vim.g.use_ts7
-- else
--   use_ts7 = project_has_ts7()
-- end

return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        -- TypeScript / JavaScript
        vtsls = {
          enabled = not use_ts7,
          settings = {
            typescript = {
              tsserver = {
                maxTsServerMemory = 12288,
                useSyntaxServer = "auto",
              },
              preferences = {
                -- "auto" (not "off") so auto-import finds components/types from
                -- package.json + workspace packages. "off" blocks those.
                includePackageJsonAutoImports = "auto",
              },
              inlayHints = {
                -- parameterNames = { enabled = "literals" },
                -- parameterTypes = { enabled = false },
                -- variableTypes = { enabled = false },
                -- propertyDeclarationTypes = { enabled = true },
                -- functionLikeReturnTypes = { enabled = false },
                -- enumMemberValues = { enabled = true },
              },
            },
            javascript = {
              inlayHints = {
                parameterNames = { enabled = "literals" },
                parameterTypes = { enabled = false },
                variableTypes = { enabled = false },
                propertyDeclarationTypes = { enabled = true },
                functionLikeReturnTypes = { enabled = false },
                enumMemberValues = { enabled = true },
              },
            },
            vtsls = {
              experimental = {
                completion = {
                  enableServerSideFuzzyMatch = true,
                  entriesLimit = 50,
                },
                maxInlayHintLength = 30,
              },
            },
          },
        },
        -- TypeScript 7 native LSP. Set use_ts7 above to enable it.
        tsgo = {
          enabled = use_ts7,
          cmd = { "npx", "--no-install", "tsc", "--lsp", "--stdio" },
        },
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
