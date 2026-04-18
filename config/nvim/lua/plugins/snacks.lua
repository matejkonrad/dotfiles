local git_filter_enabled = false

local get_git_nodes = function(root_path)
  local Tree = require("snacks.explorer.tree")
  local nodes = {}
  Tree:walk(Tree:find(root_path), function(node)
    if node.status then
      table.insert(nodes, node)
    end
  end)
  return nodes
end

local is_git_item = function(item, git_nodes)
  return vim.iter(git_nodes):any(function(node)
    if node.dir_status then
      return vim.fs.relpath(node.path, item.file) ~= nil
    end
    return vim.fs.relpath(item.file, node.path) ~= nil
  end)
end

return {
  {
    "snacks.nvim",
    opts = {
      picker = {
        sources = {
          files = {
            hidden = true,
          },
          explorer = {
            finder = function(opts, ctx)
              if git_filter_enabled then
                ctx.picker.git_nodes = get_git_nodes(ctx.filter.cwd)
              end
              return require("snacks.picker.source.explorer").explorer(opts, ctx)
            end,
            transform = function(item, ctx)
              if not git_filter_enabled then
                return true
              end
              return is_git_item(item, ctx.picker.git_nodes)
            end,
            actions = {
              toggle_git = {
                desc = "Toggle git-only filter",
                action = function(picker)
                  git_filter_enabled = not git_filter_enabled
                  picker:find()
                  vim.notify(git_filter_enabled and "Explorer: git files only" or "Explorer: all files")
                end,
              },
              grep_in_dir = {
                desc = "Grep in Directory",
                action = function(picker, item)
                  local dir = item and (item.dir and item.file or vim.fn.fnamemodify(item.file, ":h"))
                  if dir then
                    picker:close()
                    Snacks.picker.grep({ dirs = { dir } })
                  end
                end,
              },
              git_status = {
                desc = "Git Status (changed files)",
                action = function(picker)
                  picker:close()
                  Snacks.picker.git_status()
                end,
              },
              grug_far_in_dir = {
                desc = "Search & Replace in Directory (grug-far)",
                action = function(picker, item)
                  local dir = item and (item.dir and item.file or vim.fn.fnamemodify(item.file, ":h"))
                  if dir then
                    picker:close()
                    require("grug-far").open({ prefills = { paths = dir } })
                  end
                end,
              },
            },
            win = {
              list = {
                keys = {
                  ["<leader>gs"] = "git_status",
                  ["G"] = "toggle_git",
                  ["<leader>/"] = "grep_in_dir",
                  ["<leader>sr"] = "grug_far_in_dir",
                },
              },
            },
          },
        },
      },
    },
    keys = {
      {
        "<leader>fd",
        function()
          vim.ui.input(
            { prompt = "Search in dir: ", default = vim.fn.getcwd() .. "/", completion = "dir" },
            function(dir)
              if dir then
                Snacks.picker.grep({ dirs = { dir } })
              end
            end
          )
        end,
        desc = "Live Grep in Directory",
      },
      {
        "<leader>fh",
        function()
          Snacks.picker.files({ hidden = true, ignored = true })
        end,
        desc = "Find Files (hidden + ignored)",
      },
      {
        "<leader>f/",
        function()
          Snacks.picker.search_history()
        end,
        desc = "Search History",
      },
      {
        "<leader>gi",
        function()
          Snacks.picker.gh_issue()
        end,
        desc = "List Issues",
      },
      {
        "<leader>gI",
        function()
          Snacks.picker.gh_issue({ state = "all" })
        end,
        desc = "List Issues (All)",
      },
      {
        "<leader>gp",
        function()
          Snacks.picker.gh_pr()
        end,
        desc = "List PRs",
      },
      {
        "<leader>gP",
        function()
          Snacks.picker.gh_pr({ state = "all" })
        end,
        desc = "List PRs (All)",
      },
    },
  },
}
