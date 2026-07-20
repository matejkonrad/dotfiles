-- flatten.nvim: when a nested `nvim` is launched from inside a terminal buffer
-- (tuicr's `:edit`, `git commit` in lazygit, `nvim` from a snacks terminal, …),
-- open the file in *this* host instance instead of starting a nested editor.
return {
  "willothy/flatten.nvim",
  lazy = false,
  priority = 1001, -- must be set up before any terminal is opened
  opts = {
    window = {
      open = "tab", -- tuicr's `:edit` opens the file in a new tab of the host nvim
    },
    -- default block_for (gitcommit/gitrebase) is kept, so `git commit` from a
    -- terminal still blocks until the message buffer is closed.
  },
}
