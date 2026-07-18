return {
  {
    "daliusd/ghlite.nvim",
    enabled = true,
    dependencies = { "esmuellert/codediff.nvim" },
    --dependencies = { "dlyongemallo/diffview.nvim" },
    cmd = {
      "GHLitePRSelect",
      "GHLitePRCheckout",
      "GHLitePRView",
      "GHLitePRLoadComments",
      "GHLitePRDiff",
      "GHLitePRDiffview",
      "GHLitePRAddComment",
      "GHLitePRUpdateComment",
      "GHLitePRDeleteComment",
      "GHLitePROpenComment",
      "GHLitePRApprove",
      "GHLitePRMerge",
    },
    keys = {
      { "<leader>grs", "<cmd>GHLitePRSelect<cr>", desc = "GH: select PR" },
      { "<leader>gro", "<cmd>GHLitePRCheckout<cr>", desc = "GH: checkout PR" },
      { "<leader>grv", "<cmd>GHLitePRView<cr>", desc = "GH: view PR" },
      { "<leader>gru", "<cmd>GHLitePRLoadComments<cr>", desc = "GH: load PR comments" },
      { "<leader>grp", "<cmd>GHLitePRDiff<cr>", desc = "GH: PR diff (quick)" },
      {
        "<leader>grl",
        function()
          -- ghlite caches the selected PR (incl. headRefOid) in memory and never
          -- invalidates it, so a diffview after pushing shows the pre-push diff.
          -- Clear the cache to force a re-fetch of the current branch's PR head.
          require("ghlite.state").selected_PR = nil
          vim.cmd("GHLitePRDiffview")
        end,
        desc = "GH: PR diffview (fresh)",
      },
      { "<leader>gra", "<cmd>GHLitePRAddComment<cr>", desc = "GH: add PR comment" },
      { "<leader>grc", "<cmd>GHLitePRUpdateComment<cr>", desc = "GH: update comment" },
      { "<leader>grd", "<cmd>GHLitePRDeleteComment<cr>", desc = "GH: delete comment" },
      { "<leader>grg", "<cmd>GHLitePROpenComment<cr>", desc = "GH: open comment in browser" },
    },
    opts = {
      diff_tool = "codediff",
      view_split = "vsplit",
      diff_split = "vsplit",
      comment_split = "split",
      html_comments_command = { "lynx", "-stdin", "-dump" },
      merge = {
        approved = "--squash",
        nonapproved = "--auto --squash",
      },
    },
  },
  { "pwntester/octo.nvim", enabled = false },
}
