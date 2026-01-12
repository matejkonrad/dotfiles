-- lua/plugins/conform.lua
return {
  "stevearc/conform.nvim",
  opts = function()
    -- Create debug command after conform is loaded
    vim.api.nvim_create_autocmd("User", {
      pattern = "LazyLoad",
      callback = function(event)
        if event.data == "conform.nvim" then
          local conform = require("conform")

          -- Debug command to check which formatters will be used
          vim.api.nvim_create_user_command("ConformDebug", function()
            local bufnr = vim.api.nvim_get_current_buf()
            local ft = vim.bo[bufnr].filetype
            local filename = vim.api.nvim_buf_get_name(bufnr)
            local formatters = conform.list_formatters(bufnr)

            print("=== Conform Debug Info ===")
            print("File: " .. filename)
            print("File type: " .. ft)
            print("\nAvailable formatters for this file type:")

            if #formatters == 0 then
              print("  No formatters available")
            else
              for _, formatter in ipairs(formatters) do
                print("  - " .. formatter.name .. (formatter.available and " (available)" or " (NOT available)"))
              end
            end

            print("\nWill use formatters:")
            local will_use = conform.list_formatters_to_run(bufnr)
            if #will_use == 0 then
              print("  None")
            else
              for _, formatter in ipairs(will_use) do
                print("  - " .. formatter.name)
              end
            end
          end, { desc = "Debug conform formatters for current buffer" })
        end
      end,
    })

    return {
      formatters = {
        -- Configure biome to prefer local installation
        biome = {
          prefer_local = "node_modules/.bin",
          -- Only run if biome config exists
          condition = function(self, ctx)
            return vim.fn.filereadable("biome.json") == 1 or vim.fn.filereadable("biome.jsonc") == 1
          end,
        },
        -- Configure prettierd to prefer local installation
        prettierd = {
          prefer_local = "node_modules/.bin",
        },
        -- Configure eslint_d to prefer local installation
        eslint_d = {
          prefer_local = "node_modules/.bin",
        },
      },
      -- Define formatters by file type
      -- The order matters: it tries formatters from left to right
      formatters_by_ft = {
        -- JavaScript/TypeScript ecosystem
        javascript = { "biome", "prettierd", "prettier", stop_after_first = true },
        javascriptreact = { "biome", "prettierd", "prettier", stop_after_first = true },
        typescript = { "biome", "prettierd", "prettier", stop_after_first = true },
        typescriptreact = { "biome", "prettierd", "prettier", stop_after_first = true },
        json = { "biome", "prettierd", "prettier", stop_after_first = true },
        jsonc = { "biome", "prettierd", "prettier", stop_after_first = true },

        -- Web technologies
        css = { "stylelint", "prettierd", "prettier", stop_after_first = true },
        scss = { "stylelint", "prettierd", "prettier", stop_after_first = true },
        less = { "prettierd", "prettier", stop_after_first = true },
        html = { "prettierd", "prettier", stop_after_first = true },
        vue = { "prettierd", "prettier", stop_after_first = true },
        svelte = { "prettierd", "prettier", stop_after_first = true },
        markdown = { "prettierd", "prettier", stop_after_first = true },
        ["markdown.mdx"] = { "prettierd", "prettier", stop_after_first = true },
        yaml = { "prettierd", "prettier", stop_after_first = true },
        toml = { "taplo" },

        -- Programming languages
        lua = { "stylua" },
        python = { "ruff", "black", stop_after_first = true },
        go = { "gofumpt", "gofmt", stop_after_first = true },
        rust = { "rustfmt" },
        c = { "clang_format" },
        cpp = { "clang_format" },
        java = { "google-java-format" },
        kotlin = { "ktlint" },
        swift = { "swiftformat" },
        ruby = { "rubocop", "standardrb", stop_after_first = true },
        elixir = { "mix" },
        php = { "php_cs_fixer", "phpcbf", stop_after_first = true },

        -- Shell scripting
        sh = { "shfmt" },
        bash = { "shfmt" },
        zsh = { "shfmt" },
        fish = { "fish_indent" },

        -- Config files
        terraform = { "terraform_fmt" },
        hcl = { "terraform_fmt" },
        nix = { "nixpkgs_fmt", "nixfmt", stop_after_first = true },

        -- Other
        sql = { "sqlfmt", "pg_format", stop_after_first = true },
        graphql = { "prettierd", "prettier", stop_after_first = true },
        xml = { "xmlformat" },
      },
    }
  end,
}
