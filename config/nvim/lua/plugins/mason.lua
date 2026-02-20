-- lua/plugins/mason.lua
return {
  "mason-org/mason.nvim",
  opts = function(_, opts)
    opts.ensure_installed = opts.ensure_installed or {}
    vim.list_extend(opts.ensure_installed, {
      "biome", -- biome CLI
      "prettierd", -- fast daemon for Prettier
      "eslint_d", -- optional (Prettier projects w/ ESLint)
      "some-sass-language-server",
      "cssmodules-language-server",
    })
  end,
}
