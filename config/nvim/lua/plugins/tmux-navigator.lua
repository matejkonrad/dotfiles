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
    -- Normal AND terminal mode: with lazygit/tuicr open in a full-window float
    -- the chord must still leave nvim for the tmux pane (see herdr-nvim-nav.lua
    -- for the same reasoning). <cmd> mappings keep terminal mode intact.
    { "<C-h>", "<cmd>TmuxNavigateLeft<cr>", mode = { "n", "t" }, desc = "Window Left (tmux-aware)" },
    { "<C-j>", "<cmd>TmuxNavigateDown<cr>", mode = { "n", "t" }, desc = "Window Down (tmux-aware)" },
    { "<C-k>", "<cmd>TmuxNavigateUp<cr>", mode = { "n", "t" }, desc = "Window Up (tmux-aware)" },
    { "<C-l>", "<cmd>TmuxNavigateRight<cr>", mode = { "n", "t" }, desc = "Window Right (tmux-aware)" },
  },
}
