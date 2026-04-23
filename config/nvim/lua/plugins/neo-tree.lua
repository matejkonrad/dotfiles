return {
  "nvim-neo-tree/neo-tree.nvim",
  opts = {
    sources = { "filesystem" },
    filesystem = {
      bind_to_cwd = false,
      follow_current_file = { enabled = true },
      use_libuv_file_watcher = false,
      async_directory_scan = "always",
      scan_mode = "shallow",
      filtered_items = {
        visible = false,
        hide_dotfiles = false,
        hide_gitignored = true,
      },
    },
    commands = {
      grep_in_dir = function(state)
        local node = state.tree:get_node()
        local dir = node.type == "directory" and node.path or vim.fn.fnamemodify(node.path, ":h")
        Snacks.picker.grep({ dirs = { dir } })
      end,
      grug_far_in_dir = function(state)
        local node = state.tree:get_node()
        local dir = node.type == "directory" and node.path or vim.fn.fnamemodify(node.path, ":h")
        require("grug-far").open({ prefills = { paths = dir } })
      end,
    },
    window = {
      mappings = {
        ["<leader>/"] = "grep_in_dir",
        ["<leader>sr"] = "grug_far_in_dir",
      },
    },
  },
}
