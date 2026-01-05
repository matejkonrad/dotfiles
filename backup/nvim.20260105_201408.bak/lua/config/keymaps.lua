-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- CodeCompanion keymaps
vim.keymap.set({ "n", "v" }, "<leader>cc", "<cmd>CodeCompanionActions<cr>", { desc = "CodeCompanion Actions" })
vim.keymap.set("v", "<leader>ca", "<cmd>CodeCompanionAdd<cr>", { desc = "CodeCompanion Add" })
vim.keymap.set("n", "<leader>ct", "<cmd>CodeCompanionChat<cr>", { desc = "CodeCompanion Chat" })
vim.keymap.set("n", "<leader>ch", "<cmd>CodeCompanionChat<cr>", { desc = "CodeCompanion New Chat" })
vim.keymap.set("v", "<leader>cq", "<cmd>CodeCompanionChat<cr>", { desc = "CodeCompanion Quick Chat" })

-- Quick access to common CodeCompanion prompts
vim.keymap.set("v", "<leader>ce", function()
  vim.cmd("CodeCompanion explain")
end, { desc = "CodeCompanion Explain Code" })

vim.keymap.set("v", "<leader>cr", function()
  vim.cmd("CodeCompanion review")
end, { desc = "CodeCompanion Code Review" })

vim.keymap.set("v", "<leader>cT", function()
  vim.cmd("CodeCompanion test")
end, { desc = "CodeCompanion Generate Tests" })
