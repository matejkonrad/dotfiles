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
            actions = {
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
          vim.ui.input({ prompt = "Search in dir: ", default = vim.fn.getcwd() .. "/", completion = "dir" }, function(dir)
            if dir then
              Snacks.picker.grep({ dirs = { dir } })
            end
          end)
        end,
        desc = "Live Grep in Directory",
      },
      { "<leader>fh", function() Snacks.picker.files({ hidden = true, ignored = true }) end, desc = "Find Files (hidden + ignored)" },
      { "<leader>f/", function() Snacks.picker.search_history() end, desc = "Search History" },
      { "<leader>gi", function() Snacks.picker.gh_issue() end, desc = "List Issues" },
      { "<leader>gI", function() Snacks.picker.gh_issue({ state = "all" }) end, desc = "List Issues (All)" },
      { "<leader>gp", function() Snacks.picker.gh_pr() end, desc = "List PRs" },
      { "<leader>gP", function() Snacks.picker.gh_pr({ state = "all" }) end, desc = "List PRs (All)" },
    },
  },
}
