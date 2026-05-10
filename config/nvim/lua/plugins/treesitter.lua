return {
  {
    "nvim-treesitter/nvim-treesitter",
    opts = function(_, opts)
      vim.list_extend(opts.ensure_installed or {}, {
        "go",
        "rust",
        "typescript",
        "sql",
        "wgsl",
        "tsx",
        "html",
        "css",
        "scss",
        "typst",
        "vue",
        "typescriptreact",
        "javascriptreact",
      })
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter-textobjects",
    branch = "main",
    init = function()
      -- Disable entire built-in ftplugin mappings to avoid conflicts.
      -- See https://github.com/neovim/neovim/tree/master/runtime/ftplugin for built-in ftplugins.
      vim.g.no_plugin_maps = true
    end,
    config = function()
      local select = require("nvim-treesitter-textobjects.select")
      local move = require("nvim-treesitter-textobjects.move")

      local sel = function(lhs, capture, desc)
        vim.keymap.set({ "x", "o" }, lhs, function()
          select.select_textobject(capture, "textobjects")
        end, { desc = desc })
      end

      sel("af", "@function.outer", "around function")
      sel("if", "@function.inner", "inside function")
      sel("ac", "@class.outer", "around class")
      sel("ic", "@class.inner", "inside class")
      sel("ab", "@block.outer", "around block")
      sel("ib", "@block.inner", "inside block")
      sel("aa", "@parameter.outer", "around argument")
      sel("ia", "@parameter.inner", "inside argument")

      -- `captures` accepts a string or a list; the plugin tries each in order
      -- and uses whichever the current language's textobjects.scm defines.
      local jump = function(lhs, fn, captures, desc)
        vim.keymap.set({ "n", "x", "o" }, lhs, function()
          fn(captures, "textobjects")
        end, { desc = desc })
      end

      -- ] / [ land INSIDE the body (first statement). Fall back to outer start
      -- for languages whose textobjects.scm doesn't define `.inner`.
      jump("]f", move.goto_next_start,     { "@function.inner", "@function.outer" }, "inside next function")
      jump("[f", move.goto_previous_start, { "@function.inner", "@function.outer" }, "inside prev function")
      jump("]F", move.goto_next_end,       "@function.outer", "end of next function")
      jump("[F", move.goto_previous_end,   "@function.outer", "end of prev function")

      -- Capitals to avoid clashes: ]b/[b = buffer nav, ]c/[c = git hunks
      jump("]C", move.goto_next_start,     { "@class.inner", "@class.outer" }, "inside next class")
      jump("[C", move.goto_previous_start, { "@class.inner", "@class.outer" }, "inside prev class")

      jump("]B", move.goto_next_start,     { "@block.inner", "@block.outer" }, "inside next block")
      jump("[B", move.goto_previous_start, { "@block.inner", "@block.outer" }, "inside prev block")

      jump("]a", move.goto_next_start,     "@parameter.inner", "next argument")
      jump("[a", move.goto_previous_start, "@parameter.inner", "prev argument")
    end,
  },
}
