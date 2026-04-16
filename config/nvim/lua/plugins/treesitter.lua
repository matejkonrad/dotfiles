return {
  {
    "nvim-treesitter/nvim-treesitter",
    opts = function(_, opts)
      vim.list_extend(opts.ensure_installed or {}, {
        "go",
        "rust",
        "typescript",
        "sql",
        "wgsl",
        "tsx",
        "html",
        "css",
        "scss",
        "typst",
        "vue",
        "typescriptreact",
        "javascriptreact",
      })
    end,
  },
}
