return {
  {
    "saghen/blink.cmp",
    ---@module 'blink.cmp'
    ---
    ---
    ---
    ---@type blink.cmp.Config
    opts = {
      keymap = {
        ["<Tab>"] = {
          "snippet_forward",
          function() -- if you are using Neovim's native inline completions
            return vim.lsp.inline_completion.get()
          end,
          "fallback",
        },
      },
    },
  },
}
