local git_filter_enabled = false

-- Generated/noise globs, excluded by default. Toggle back in with <a-g>.
local noise_exclude = {
  "**/drizzle/**/*.json", -- drizzle migration snapshots & journal
}

-- Test globs, excluded by default. Toggle back in with <a-t>.
local test_exclude = {
  "**/*_test.*",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_spec.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/spec/**",
}

-- Effective grep excludes: each group is dropped unless its show_* flag is on.
local function grep_exclude(show_tests, show_noise)
  local ex = {}
  if not show_noise then
    vim.list_extend(ex, vim.deepcopy(noise_exclude))
  end
  if not show_tests then
    vim.list_extend(ex, vim.deepcopy(test_exclude))
  end
  return ex
end

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
      scroll = { enabled = false },
      -- lazygit (<leader>gg) fills the whole editor instead of a centered float.
      -- In snacks.win, width/height of 0 means "full size" (win.lua:1283).
      styles = {
        lazygit = {
          width = 0,
          height = 0,
          border = "none",
        },
      },
      gh = {},
      dashboard = {
        preset = {
          header = [[
 ____  __     __   __ _  __ _ 
(  _ \(  )   / _\ (  ( \(  / )
 ) _ (/ (_/\/    \/    / )  ( 
(____/\____/\_/\_/\_)__)(__\_)
]],
        },
      },
      picker = {
        sources = {
          files = {
            hidden = true,
          },
          grep = {
            -- <leader>/ and <leader>sg skip tests + noise by default.
            exclude = grep_exclude(false, false),
            show_tests = false,
            show_noise = false,
            -- Title-bar icon lights up when that group is *included*.
            toggles = {
              show_tests = { icon = "󰙨" }, -- tests visible
              show_noise = { icon = "" }, -- generated/noise visible
            },
            actions = {
              toggle_tests = function(picker)
                picker.opts.show_tests = not picker.opts.show_tests
                picker.opts.exclude = grep_exclude(picker.opts.show_tests, picker.opts.show_noise)
                picker.list:set_target()
                picker:find()
              end,
              toggle_noise = function(picker)
                picker.opts.show_noise = not picker.opts.show_noise
                picker.opts.exclude = grep_exclude(picker.opts.show_tests, picker.opts.show_noise)
                picker.list:set_target()
                picker:find()
              end,
            },
            win = {
              input = {
                keys = {
                  ["<a-t>"] = { "toggle_tests", mode = { "i", "n" } },
                  ["<a-g>"] = { "toggle_noise", mode = { "i", "n" } },
                },
              },
            },
          },
          gh_issue = {},
          gh_pr = {},
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
