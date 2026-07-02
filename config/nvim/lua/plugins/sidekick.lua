local function dismiss()
  pcall(function()
    require("sidekick").clear()
  end)
  local ns = vim.api.nvim_get_namespaces()["nvim.lsp.inline_completion"]
  if ns then
    vim.api.nvim_buf_clear_namespace(0, ns, 0, -1)
  end
end

local function accept_partial(pattern)
  return function()
    vim.lsp.inline_completion.get({
      on_accept = function(item)
        local is_str = type(item.insert_text) == "string"
        local text = is_str and item.insert_text or item.insert_text.value
        local slice = text:match(pattern) or text
        if is_str then
          item.insert_text = slice
        else
          item.insert_text = vim.tbl_extend("force", item.insert_text, { value = slice })
        end
        return item
      end,
    })
  end
end

return {
  "folke/sidekick.nvim",
  enabled = true,
  opts = {
    cli = {
      mux = {
        backend = "tmux",
        enabled = true,
      },
    },
  },
  keys = {
    { "<C-]>", dismiss, mode = "i", desc = "AI: dismiss suggestion" },
    { "<M-Right>", accept_partial("^%s*[%w_]+"), mode = "i", desc = "AI: accept word" },
    { "<M-l>", accept_partial("^[^\n]*"), mode = "i", desc = "AI: accept line" },
    {
      "<leader>ui",
      function()
        vim.lsp.inline_completion.enable(not vim.lsp.inline_completion.is_enabled())
      end,
      mode = "n",
      desc = "Toggle inline completion",
    },
  },
}
