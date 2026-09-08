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
  -- One entry point. Everything else is a key inside the review view:
  -- <C-s> submit, <C-a> approve, A AI review, af AI review file, cc comment,
  -- r reply, R resolve, o open in browser, p pipeline, <C-q> quit.
  keys = {
    { "<leader>gv", "<cmd>CodeReview<cr>", desc = "Review PR (codereview.nvim)" },
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
