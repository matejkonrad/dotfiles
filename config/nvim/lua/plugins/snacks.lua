return {
  {
    "snacks.nvim",
    opts = {
      picker = {
        sources = {
          files = {
            hidden = true,
          },
        },
      },
    },
    keys = {
      { "<leader>gi", function() Snacks.picker.gh_issue() end, desc = "List Issues" },
      { "<leader>gI", function() Snacks.picker.gh_issue({ state = "all" }) end, desc = "List Issues (All)" },
      { "<leader>gp", function() Snacks.picker.gh_pr() end, desc = "List PRs" },
      { "<leader>gP", function() Snacks.picker.gh_pr({ state = "all" }) end, desc = "List PRs (All)" },
    },
  },
}
