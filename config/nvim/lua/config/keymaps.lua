-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

vim.keymap.set("n", "<leader>yr", function()
  local relative = vim.fn.expand("%:.")
  vim.fn.setreg("+", relative)
  vim.notify("Copied: " .. relative)
end, { desc = "Yank relative file path" })

-- Cycle tabpages with bracket pairs (]/[ = next/prev, matching other nav maps).
vim.keymap.set("n", "]<Tab>", "<cmd>tabnext<cr>", { desc = "Next tab" })
vim.keymap.set("n", "[<Tab>", "<cmd>tabprevious<cr>", { desc = "Prev tab" })
