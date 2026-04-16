return {
  "folke/sidekick.nvim",
  enabled = true,
  opts = {
    cli = {
      mux = {
        backend = "tmux",
        enabled = true,
        split = {
          vertical = true,
          size = 0.3,
        },
      },
      win = {
        layout = "right",
        split = {
          width = 0, -- Set to 0 so the default logic ignores it initially
        },
        -- The Magic Hook
        config = function(terminal)
          -- terminal.opts is a deepcopy of Config.cli.win
          -- We can calculate the integer width here dynamically
          terminal.opts.split.width = math.floor(vim.o.columns * 0.25)
        end,
      },
    },
  },
}
