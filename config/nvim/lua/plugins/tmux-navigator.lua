return {
  "christoomey/vim-tmux-navigator",
  enabled = true,
  -- Only under tmux — inside a herdr pane, herdr-nvim-nav owns <C-h/j/k/l>
  -- (see herdr-nvim-nav.lua). Prevents the two navigators from clashing.
  cond = vim.env.HERDR_ENV ~= "1",
  init = function()
    vim.g.tmux_navigator_disable_when_zoomed = 1
  end,
  cmd = {
    "TmuxNavigateLeft",
    "TmuxNavigateDown",
    "TmuxNavigateUp",
    "TmuxNavigateRight",
    "TmuxNavigatePrevious",
  },
  keys = {
    -- Terminal-mode handling (lazygit/tuicr floats) lives in terminal-nav.lua.
    { "<C-h>", "<cmd>TmuxNavigateLeft<cr>", desc = "Window Left (tmux-aware)" },
    { "<C-j>", "<cmd>TmuxNavigateDown<cr>", desc = "Window Down (tmux-aware)" },
    { "<C-k>", "<cmd>TmuxNavigateUp<cr>", desc = "Window Up (tmux-aware)" },
    { "<C-l>", "<cmd>TmuxNavigateRight<cr>", desc = "Window Right (tmux-aware)" },
  },
}
