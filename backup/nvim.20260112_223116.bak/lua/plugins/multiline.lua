-- In your ~/.config/nvim/lua/plugins/vim-visual-multi.lua
return {
  "mg979/vim-visual-multi",
  branch = "master",
  event = "VeryLazy",
  init = function()
    -- Optional: customize key mappings
    -- vim.g.VM_maps = {
    --   ["Find Under"] = "<C-d>", -- like Cmd+D in VSCode/Zed
    --   ["Find Subword Under"] = "<C-d>",
    -- }
    --
    -- Optional: add more custom mappings
    -- vim.g.VM_maps["Skip Region"] = "<C-x>"
    -- vim.g.VM_maps["Remove Region"] = "<C-p>"
  end,
}
