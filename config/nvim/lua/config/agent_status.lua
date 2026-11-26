-- Lualine component: busy/idle state of the Claude Code sessions that work in
-- this project. Claude writes ~/.claude/sessions/<pid>.json with `cwd` and
-- `status` (the same source as config/rex/agents.lua). A session counts when
-- its process is alive and its cwd is nvim's cwd or below it.
local M = {}

local DIR = vim.fs.normalize("~/.claude/sessions")
local INTERVAL = 2000

-- Status order and label; other statuses show under their own name.
local LABEL = { busy = "working", idle = "idle" }
local ORDER = { busy = 1, idle = 2 }

local text = ""
local busy = false
local timer ---@type uv.uv_timer_t?

local function read_json(path)
  local f = io.open(path, "r")
  if not f then
    return nil
  end
  local data = f:read("*a")
  f:close()
  local ok, decoded = pcall(vim.json.decode, data)
  return ok and type(decoded) == "table" and decoded or nil
end

local function within(root, cwd)
  return cwd == root or vim.startswith(cwd, root .. "/")
end

local function refresh()
  local root = vim.fn.getcwd()
  local counts = {} ---@type table<string, integer>
  local handle = vim.uv.fs_scandir(DIR)
  while handle do
    local name = vim.uv.fs_scandir_next(handle)
    if not name then
      break
    end
    local pid = tonumber(name:match("^(%d+)%.json$"))
    -- kill(pid, 0) only probes: 0 means the process exists.
    if pid and vim.uv.kill(pid, 0) == 0 then
      local s = read_json(DIR .. "/" .. name)
      if s and type(s.cwd) == "string" and s.status and within(root, s.cwd) then
        counts[s.status] = (counts[s.status] or 0) + 1
      end
    end
  end

  local statuses = vim.tbl_keys(counts)
  table.sort(statuses, function(a, b)
    local oa, ob = ORDER[a] or 9, ORDER[b] or 9
    return oa == ob and a < b or oa < ob
  end)
  local parts = {}
  for _, status in ipairs(statuses) do
    table.insert(parts, ("%d %s"):format(counts[status], LABEL[status] or status))
  end
  text = #parts > 0 and ("󰚩 " .. table.concat(parts, " · ")) or ""
  busy = (counts.busy or 0) > 0
end

function M.start()
  if timer then
    return
  end
  timer = vim.uv.new_timer()
  if timer then
    timer:start(0, INTERVAL, vim.schedule_wrap(refresh))
  end
end

function M.text()
  return text
end

function M.visible()
  return text ~= ""
end

function M.color()
  return busy and "DiagnosticWarn" or "Comment"
end

return M
