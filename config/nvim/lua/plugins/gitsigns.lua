-- Word-level diff highlights (used by :Gitsigns toggle_word_diff). gitsigns
-- defaults these to TermCursor (reverse video), and the DiffText group is way
-- too bright -- so use subtle dark background tints instead. Tweak the hex to
-- taste. Re-applied on ColorScheme so it survives theme swaps.
local function set_diff_inline_hl()
  vim.api.nvim_set_hl(0, "GitSignsAddInline", { bg = "#26352b" })
  vim.api.nvim_set_hl(0, "GitSignsChangeInline", { bg = "#2b3040" })
  vim.api.nvim_set_hl(0, "GitSignsDeleteInline", { bg = "#3a2730" })
end
vim.api.nvim_create_autocmd("ColorScheme", { callback = set_diff_inline_hl })
set_diff_inline_hl()

return {
  "lewis6991/gitsigns.nvim",
  event = { "BufReadPre", "BufNewFile" },
  keys = {
    {
      "<leader>gmo",
      function()
        local gs = require("gitsigns")
        vim.fn.system("git rev-parse --verify origin/main 2>/dev/null")
        local ref = vim.v.shell_error == 0 and "origin/main" or "origin/master"
        gs.change_base(ref, true)
        vim.notify("gitsigns: vs " .. ref)
      end,
      desc = "Diff against origin main",
    },
    {
      "<leader>gmb",
      function()
        local gs = require("gitsigns")
        vim.ui.input({ prompt = "Branch: " }, function(branch)
          if not branch or branch == "" then return end
          gs.change_base(branch, true)
          vim.notify("gitsigns: vs " .. branch)
        end)
      end,
      desc = "Diff against branch",
    },
    {
      "<leader>gmr",
      function()
        local gs = require("gitsigns")
        gs.change_base(nil, true)
        vim.notify("gitsigns: reset to index")
      end,
      desc = "Diff reset to index",
    },
  },
  opts = {
    signs = {
      add          = { text = "▎" },
      change       = { text = "▎" },
      delete       = { text = "" },
      topdelete    = { text = "" },
      changedelete = { text = "▎" },
      untracked    = { text = "▎" },
    },
    signs_staged = {
      add          = { text = "▎" },
      change       = { text = "▎" },
      delete       = { text = "" },
      topdelete    = { text = "" },
      changedelete = { text = "▎" },
    },
    signcolumn = true,
    numhl = false,
    linehl = false,
    word_diff = false,
    current_line_blame = false,
    current_line_blame_opts = {
      virt_text_pos = "eol",
      delay = 300,
    },
    preview_config = {
      border = "rounded",
    },
    on_attach = function(buf)
      local gs = require("gitsigns")
      local map = function(mode, lhs, rhs, desc)
        vim.keymap.set(mode, lhs, rhs, { buffer = buf, desc = desc })
      end

      -- Hunk navigation (matches diff-mode convention)
      map("n", "]c", function()
        if vim.wo.diff then
          vim.cmd.normal({ "]c", bang = true })
        else
          gs.nav_hunk("next")
        end
      end, "Next hunk")

      map("n", "[c", function()
        if vim.wo.diff then
          vim.cmd.normal({ "[c", bang = true })
        else
          gs.nav_hunk("prev")
        end
      end, "Prev hunk")

      -- Hunk actions
      map({ "n", "v" }, "<leader>ghs", ":Gitsigns stage_hunk<CR>", "Stage hunk")
      map({ "n", "v" }, "<leader>ghr", ":Gitsigns reset_hunk<CR>", "Reset hunk")
      map("n", "<leader>ghS", gs.stage_buffer, "Stage buffer")
      map("n", "<leader>ghu", gs.undo_stage_hunk, "Undo stage hunk")
      map("n", "<leader>ghR", gs.reset_buffer, "Reset buffer")
      map("n", "<leader>ghp", gs.preview_hunk, "Preview hunk")
      map("n", "<leader>ghi", gs.preview_hunk_inline, "Preview hunk inline (expand)")
      map("n", "<leader>go", gs.toggle_deleted, "Toggle diff overlay (deleted lines)")
      map("n", "<leader>ghb", function() gs.blame_line({ full = true }) end, "Blame line")
      map("n", "<leader>ghd", gs.diffthis, "Diff this")
      map("n", "<leader>ghD", function() gs.diffthis("~") end, "Diff this ~")
      map("n", "<leader>ght", gs.toggle_current_line_blame, "Toggle line blame")

      -- Hunk text object
      map({ "o", "x" }, "ih", ":<C-U>Gitsigns select_hunk<CR>", "Inside hunk")
    end,
  },
}
