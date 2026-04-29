local diff_branch = nil

local function apply_ref(buf)
  if not diff_branch then
    return
  end
  local path = vim.api.nvim_buf_get_name(buf)
  if path == "" or vim.bo[buf].buftype ~= "" then
    return
  end
  local rel = vim.fn.fnamemodify(path, ":.")
  local ref_text = vim.fn.system({ "git", "show", diff_branch .. ":" .. rel })
  if vim.v.shell_error ~= 0 then
    ref_text = ""
  end
  MiniDiff.set_ref_text(buf, ref_text)
end

return {
  "nvim-mini/mini.diff",
  init = function()
    vim.api.nvim_create_autocmd("BufEnter", {
      callback = function(ev)
        vim.defer_fn(function()
          if vim.api.nvim_buf_is_valid(ev.buf) then
            apply_ref(ev.buf)
          end
        end, 50)
      end,
    })
  end,
  keys = {
    {
      "<leader>gmo",
      function()
        local base = vim.fn.system("git rev-parse --verify origin/main 2>/dev/null")
        diff_branch = vim.v.shell_error == 0 and "origin/main" or "origin/master"
        apply_ref(0)
        vim.notify("mini.diff: vs " .. diff_branch)
      end,
      desc = "Diff against origin main",
    },
    {
      "<leader>gmb",
      function()
        vim.ui.input({ prompt = "Branch: " }, function(branch)
          if not branch or branch == "" then
            return
          end
          diff_branch = branch
          apply_ref(0)
          vim.notify("mini.diff: vs " .. diff_branch)
        end)
      end,
      desc = "Diff against branch",
    },
    {
      "<leader>gmr",
      function()
        diff_branch = nil
        local buf = vim.api.nvim_get_current_buf()
        -- Disable + re-enable so mini.diff re-attaches the default git source.
        pcall(MiniDiff.disable, buf)
        pcall(MiniDiff.enable, buf)
        vim.notify("mini.diff: reset to index")
      end,
      desc = "Diff reset to index",
    },
  },
}
