-- Syntax colors for the review tab, from tree-sitter and the user's Neovim colorscheme (fesper).
-- usage: nvim --headless --clean -l hl.lua <input.json> [output.json]
--   input:  [{id, path, filename}]: path is the text to color, filename picks the language.
--   output: one JSON line per entry, {"id": id, "lines": lines | null}; lines[i] = [[startCol, endCol, "#hex"], ...]
--           (byte columns, endCol -1: to the end of the line). Spans come in query order: the last one wins.
--           One line each, so the review reads them one at a time and never parses one huge document.
-- A file without a parser, or one that fails, is null; it never fails the others.
local input, output = arg[1], arg[2]

-- Parsers (and some queries) in site; nvim-treesitter's runtime has the full query set; colors in the dotfiles.
vim.opt.rtp:prepend(vim.fn.expand("~/.local/share/nvim/site"))
local nts = vim.fn.expand("~/.local/share/nvim/lazy/nvim-treesitter/runtime")
if vim.fn.isdirectory(nts) == 1 then vim.opt.rtp:prepend(nts) end
vim.opt.rtp:prepend(vim.fn.stdpath("config"))
vim.o.termguicolors = true
-- Without fesper, whatever @capture colors exist (Neovim's defaults) still give colors.
if not pcall(vim.cmd.colorscheme, "fesper") then pcall(vim.cmd.colorscheme, "default") end

local cache = {}
local function color(name, lang)
  local key = lang .. "|" .. name
  if cache[key] == nil then
    local hl = vim.api.nvim_get_hl(0, { name = "@" .. name .. "." .. lang, link = false })
    if not hl.fg then hl = vim.api.nvim_get_hl(0, { name = "@" .. name, link = false }) end
    cache[key] = hl.fg and string.format("#%06x", hl.fg) or false
  end
  return cache[key]
end

-- --clean skips nvim-treesitter, which maps these filetypes to their parsers.
for lang, fts in pairs({
  tsx = { "typescriptreact", "typescript.tsx" }, javascript = { "javascriptreact", "javascript.jsx" },
  bash = { "sh", "zsh" }, json = { "jsonc" }, markdown = { "mdx" }, xml = { "svg", "xsd" },
}) do pcall(vim.treesitter.language.register, lang, fts) end

local function langOf(filename)
  local ft = vim.filetype.match({ filename = filename })
  if not ft then return nil end
  return vim.treesitter.language.get_lang(ft) or ft
end

local function highlight(entry)
  local lang = langOf(entry.filename)
  if not lang or not pcall(vim.treesitter.language.add, lang) then return nil end
  local src = table.concat(vim.fn.readfile(entry.path), "\n")
  local parser = vim.treesitter.get_string_parser(src, lang)
  local tree = parser:parse(true)[1]
  local query = vim.treesitter.query.get(lang, "highlights")
  if not tree or not query then return nil end
  local lines = {}
  local n = #vim.split(src, "\n", { plain = true })
  for i = 1, n do lines[i] = {} end
  for id, node in query:iter_captures(tree:root(), src, 0, -1) do
    local c = color(query.captures[id], lang)
    if c then
      local sr, sc, er, ec = node:range()
      for r = sr, math.min(er, n - 1) do
        local s = r == sr and sc or 0
        local e = r == er and ec or -1
        if not (r == er and e == 0 and r ~= sr) then table.insert(lines[r + 1], { s, e, c }) end
      end
    end
  end
  return lines
end

local out = {}
local ok, entries = pcall(function() return vim.json.decode(table.concat(vim.fn.readfile(input), "\n")) end)
for _, entry in ipairs(ok and entries or {}) do
  local fine, lines = pcall(highlight, entry)
  table.insert(out, vim.json.encode({ id = tostring(entry.id), lines = (fine and lines) or vim.NIL }))
end
if output then vim.fn.writefile(out, output) else io.write(table.concat(out, "\n"), "\n") end
