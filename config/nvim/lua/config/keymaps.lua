-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

vim.keymap.set("n", "<leader>yr", function()
  local rel = vim.fn.expand("%:.")
  vim.fn.setreg("+", rel)
  vim.notify("Copied: " .. rel)
end, { desc = "Yank relative file path" })

-- Lazygit that follows worktree switches. lazygit writes its final cwd to
-- $LAZYGIT_NEW_DIR_FILE on quit; if that is another worktree, nvim moves there:
-- global :cd (re-keys the open-in-nvim sockets, autocmds.lua), every unmodified
-- buffer of the old worktree reopens at the same path in the new one, and LSP
-- clients left without buffers stop. Modified buffers stay and are reported.
local function git_root(dir)
  local out = vim.fn.systemlist({ "git", "-C", dir, "rev-parse", "--show-toplevel" })
  return vim.v.shell_error == 0 and out[1] or nil
end

local function switch_worktree(old_root, new_root)
  vim.cmd.cd(vim.fn.fnameescape(new_root))
  local kept = {}
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    local name = vim.api.nvim_buf_get_name(buf)
    local rel = vim.bo[buf].buftype == "" and vim.fs.relpath(old_root, name)
    if rel then
      if vim.bo[buf].modified then
        table.insert(kept, rel)
      else
        local target = vim.fs.joinpath(new_root, rel)
        local exists = vim.uv.fs_stat(target) ~= nil
        for _, win in ipairs(vim.fn.win_findbuf(buf)) do
          vim.api.nvim_win_call(win, function()
            vim.cmd.edit(vim.fn.fnameescape(exists and target or new_root))
          end)
        end
        pcall(vim.api.nvim_buf_delete, buf, {})
      end
    end
  end
  for _, client in ipairs(vim.lsp.get_clients()) do
    if vim.tbl_isempty(client.attached_buffers) then
      client:stop()
    end
  end
  local msg = "Switched to worktree " .. new_root
  if #kept > 0 then
    msg = msg .. "\nUnsaved buffers kept from the old worktree:\n  " .. table.concat(kept, "\n  ")
  end
  vim.notify(msg, #kept > 0 and vim.log.levels.WARN or vim.log.levels.INFO)
end

local function lazygit(opts)
  local old_root = git_root(vim.fn.getcwd())
  local dir_file = vim.fn.tempname()
  local term = Snacks.lazygit(vim.tbl_extend("force", opts or {}, { env = { LAZYGIT_NEW_DIR_FILE = dir_file } }))
  term:on("TermClose", function()
    local ok, lines = pcall(vim.fn.readfile, dir_file)
    vim.fn.delete(dir_file)
    local new_root = ok and lines[1] and git_root(lines[1])
    if old_root and new_root and new_root ~= old_root then
      vim.schedule(function()
        switch_worktree(old_root, new_root)
      end)
    end
  end, { buf = true })
end

vim.keymap.set("n", "<leader>gg", function()
  lazygit({ cwd = LazyVim.root.git() })
end, { desc = "Lazygit (Root Dir)" })
vim.keymap.set("n", "<leader>gG", function()
  lazygit()
end, { desc = "Lazygit (cwd)" })

-- Cycle tabpages with bracket pairs (]/[ = next/prev, matching other nav maps).
vim.keymap.set("n", "]<Tab>", "<cmd>tabnext<cr>", { desc = "Next tab" })
vim.keymap.set("n", "[<Tab>", "<cmd>tabprevious<cr>", { desc = "Prev tab" })
