-- <C-h/j/k/l> inside snacks terminals (lazygit, tuicr, gh-dash, <c-/>).
--
-- LazyVim's default (lazyvim/plugins/util.lua, term_nav) passes the raw chord to
-- the program when the terminal is floating, so with lazygit in the full-window
-- float the key lands in lazygit and navigation stops working. Those keys are
-- buffer-local to the terminal, so they beat any global terminal-mode map.
--
-- Override them with the same ids (nav_h…nav_l). Floating terminal: hop straight
-- to the neighbouring herdr/tmux pane. Split terminal:
-- run the normal-mode chord, i.e. whichever navigator owns it here
-- (herdr-nvim-nav in a herdr pane, vim-tmux-navigator under tmux).
-- Run whatever the normal-mode chord is mapped to, without replaying keys
-- (feedkeys from inside a key handler runs under textlock: E565 on wincmd).
-- Follows one <Plug> hop (herdr-nvim-nav) and <cmd>…<cr> rhs (vim-tmux-navigator).
local function run_normal_chord(dir)
  local map = vim.fn.maparg("<C-" .. dir .. ">", "n", false, true)
  for _ = 1, 3 do
    if not map or not map.lhs then
      break
    end
    if map.callback then
      return map.callback()
    end
    local rhs = map.rhs or ""
    local cmd = rhs:match("^<[Cc]md>(.*)<[Cc][Rr]>$")
    if cmd then
      return vim.cmd(cmd)
    end
    if not rhs:match("^<Plug>") then
      break
    end
    map = vim.fn.maparg(rhs, "n", false, true)
  end
  vim.cmd.wincmd(dir)
end

-- Floating terminals: `wincmd` from a float lands in the hidden window below
-- it, so the split-first navigators think they moved inside nvim and never
-- reach the multiplexer. A full-window float has no meaningful neighbour
-- anyway, so hop straight to the surrounding pane and stay in terminal mode.
local MUX_DIR = { h = "left", j = "down", k = "up", l = "right" }
local TMUX_FLAG = { h = "-L", j = "-D", k = "-U", l = "-R" }
local function mux_focus(dir)
  if vim.env.HERDR_PANE_ID and vim.env.HERDR_PANE_ID ~= "" then
    local herdr = vim.env.HERDR_BIN_PATH
    if herdr == nil or herdr == "" then
      herdr = "herdr"
    end
    vim.system({ herdr, "pane", "focus", "--direction", MUX_DIR[dir], "--current" })
  elseif vim.env.TMUX and vim.env.TMUX ~= "" then
    vim.system({ "tmux", "select-pane", TMUX_FLAG[dir] })
  end
end

local function term_nav(dir)
  ---@param self snacks.terminal
  return function(self)
    if self:is_floating() then
      mux_focus(dir)
      return
    end
    -- Split terminal: scheduled, like LazyVim's own version — the key handler
    -- runs in terminal mode under restrictions that forbid changing windows.
    -- No stopinsert/startinsert: from a scheduled callback they only apply
    -- after it returns (and in that order), so they would leave the terminal
    -- in normal mode. Running the chord in terminal mode works: moving to
    -- another window ends terminal mode by itself, staying put keeps it.
    vim.schedule(function()
      run_normal_chord(dir)
    end)
  end
end

return {
  "folke/snacks.nvim",
  opts = {
    terminal = {
      win = {
        keys = {
          nav_h = { "<C-h>", term_nav("h"), desc = "Navigate left (nvim/mux)", mode = "t" },
          nav_j = { "<C-j>", term_nav("j"), desc = "Navigate down (nvim/mux)", mode = "t" },
          nav_k = { "<C-k>", term_nav("k"), desc = "Navigate up (nvim/mux)", mode = "t" },
          nav_l = { "<C-l>", term_nav("l"), desc = "Navigate right (nvim/mux)", mode = "t" },
        },
      },
    },
  },
}
