return {
  "akinsho/bufferline.nvim",
  opts = {
    options = {
      -- Show the buffer line as soon as there's one buffer (LazyVim hides it
      -- until 2+). We drive `showtabline = 2` from lua/config/options.lua and
      -- turn OFF bufferline's own auto-toggle so it never re-forces the line to
      -- show — otherwise it overrides snacks.nvim's dashboard, which sets
      -- showtabline=0 while the start screen is up.
      always_show_bufferline = false,
      auto_toggle_bufferline = true,
    },
  },
}
