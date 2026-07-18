return {
  "afewyards/codereview.nvim",
  dependencies = { "nvim-lua/plenary.nvim" },
  cmd = {
    "CodeReview",
    "CodeReviewAI",
    "CodeReviewAIFile",
    "CodeReviewStart",
    "CodeReviewSubmit",
    "CodeReviewApprove",
    "CodeReviewOpen",
    "CodeReviewPipeline",
    "CodeReviewComments",
    "CodeReviewFiles",
    "CodeReviewToggleScroll",
    "CodeReviewCommits",
  },
  keys = {
    { "<leader>gv", "<cmd>CodeReview<cr>", desc = "Code Review: open PR/MR picker" },
    { "<leader>gvs", "<cmd>CodeReviewStart<cr>", desc = "Code Review: start review" },
    { "<leader>gvS", "<cmd>CodeReviewSubmit<cr>", desc = "Code Review: submit draft comments" },
    { "<leader>gva", "<cmd>CodeReviewApprove<cr>", desc = "Code Review: approve" },
    { "<leader>gvA", "<cmd>CodeReviewAI<cr>", desc = "Code Review: AI review (all files)" },
    { "<leader>gvf", "<cmd>CodeReviewAIFile<cr>", desc = "Code Review: AI review (current file)" },
    { "<leader>gvo", "<cmd>CodeReviewOpen<cr>", desc = "Code Review: open in browser" },
    { "<leader>gvp", "<cmd>CodeReviewPipeline<cr>", desc = "Code Review: pipeline status" },
    { "<leader>gvc", "<cmd>CodeReviewComments<cr>", desc = "Code Review: browse comments" },
    { "<leader>gvF", "<cmd>CodeReviewFiles<cr>", desc = "Code Review: browse changed files" },
    { "<leader>gvC", "<cmd>CodeReviewCommits<cr>", desc = "Code Review: browse commits" },
    { "<leader>gvt", "<cmd>CodeReviewToggleScroll<cr>", desc = "Code Review: toggle scroll mode" },
  },
  ---@module "codereview"
  ---@type codereview.Config
  opts = {
    picker = "snacks",
    ai = {
      enabled = true,
      provider = "claude_cli", -- reuses your existing `claude` CLI auth, no API key needed
    },
  },
}
