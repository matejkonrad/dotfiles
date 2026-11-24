-- Agent switcher: one picker that lists every coding agent running in any
-- Rex session, with its state, and jumps to the pane you choose.
--
-- How it finds them:
--   * Claude Code writes ~/.claude/sessions/<pid>.json for each running
--     Claude, with its name, cwd and status (busy / idle). That file is the
--     state source, so no hook or OSC 7501 support is needed.
--   * Each Rex terminal reports its child pid (the login shell). An agent
--     belongs to the pane whose child pid is one of its ancestors in `ps`.
--     Rex's `foreground` is not used: for a Claude pane it reports `login`.
--   * Codex, OpenCode and Pi have no session file, so they are matched by
--     process name and listed without a state.
--
-- Agents outside Rex (Claude desktop, Zed) have no pane and are skipped.

local HOME = os.getenv("HOME")
local CLAUDE_DIR = os.getenv("CLAUDE_CONFIG_DIR") or (HOME .. "/.claude")
local TERMINAL = "com.superlogical.terminal"
local OTHER_AGENTS = { codex = "Codex", opencode = "OpenCode", pi = "Pi" }

local function exec_lines(argv)
  local r = rex.exec(argv, { timeout = 5 })
  local out = {}
  if r and r.ok then
    for line in r.stdout:gmatch("[^\n]+") do
      out[#out + 1] = line
    end
  end
  return out
end

local function read_json(path)
  local f = io.open(path, "rb")
  if not f then
    return nil
  end
  local text = f:read("*a")
  f:close()
  return rex.json.decode(text)
end

local function call(method, params)
  local ok, result = pcall(rex.call, method, params)
  return ok and result or nil
end

local function short_path(path)
  if not path then
    return ""
  end
  return (path:gsub("^" .. HOME:gsub("%p", "%%%0"), "~"))
end

local function ago(ms)
  if not ms then
    return ""
  end
  local s = math.max(0, os.time() - math.floor(ms / 1000))
  if s < 60 then
    return s .. "s"
  elseif s < 3600 then
    return math.floor(s / 60) .. "m"
  elseif s < 86400 then
    return math.floor(s / 3600) .. "h"
  end
  return math.floor(s / 86400) .. "d"
end

-- pid -> { ppid, name } for every process on the machine.
local function process_table()
  local procs = {}
  for _, line in ipairs(exec_lines({ "/bin/ps", "-axo", "pid=,ppid=,comm=" })) do
    local pid, ppid, comm = line:match("^%s*(%d+)%s+(%d+)%s+(.+)$")
    if pid then
      procs[tonumber(pid)] = { ppid = tonumber(ppid), name = comm:match("([^/]+)$") }
    end
  end
  return procs
end

-- child pid -> pane, for every terminal pane in every Rex session.
local function rex_panes()
  local panes = {}
  local list = call("session.list") or {}
  for _, s in ipairs(list.sessions or {}) do
    local view = call("session.view", { session_id = s.session_id }) or {}
    for tab, w in ipairs(view.windows or {}) do
      for _, layer in ipairs(w.layers or {}) do
        for _, b in ipairs(layer.blocks or {}) do
          if b.creator_name == TERMINAL then
            local proc = call("block.method", {
              session_id = s.session_id,
              block_id = b.block_id,
              method = "process",
            })
            local child = proc and proc.child and proc.child.pid
            if child then
              panes[child] = {
                session_id = s.session_id,
                session_label = s.label or "",
                window_id = w.window_id,
                block_id = b.block_id,
                tab = tab,
              }
            end
          end
        end
      end
    end
  end
  return panes
end

-- The pane an agent pid runs in: walk up its parents until one is a pane's child.
local function pane_of(pid, procs, panes)
  local seen = 0
  while pid and pid > 1 and seen < 64 do
    if panes[pid] then
      return panes[pid]
    end
    local p = procs[pid]
    pid = p and p.ppid
    seen = seen + 1
  end
end

local STATE = {
  busy = { order = 1, label = "working" },
  idle = { order = 2, label = "idle" },
}

local function collect()
  local procs = process_table()
  local panes = rex_panes()
  local agents, claimed = {}, {}

  for _, file in ipairs(exec_lines({ "/bin/ls", CLAUDE_DIR .. "/sessions" })) do
    local digits = file:match("^(%d+)%.json$")
    local pid = digits and tonumber(digits)
    local s = pid and procs[pid] and read_json(CLAUDE_DIR .. "/sessions/" .. file)
    local pane = s and pane_of(pid, procs, panes)
    if pane then
      claimed[pid] = true
      local state = STATE[s.status] or { order = 0, label = s.status or "?" }
      agents[#agents + 1] = {
        pane = pane,
        name = s.name or "claude",
        cwd = s.cwd,
        kind = "Claude",
        state = state,
        updated = s.statusUpdatedAt or s.updatedAt,
      }
    end
  end

  for pid, p in pairs(procs) do
    local kind = OTHER_AGENTS[p.name]
    local pane = kind and pane_of(pid, procs, panes)
    -- Skip helpers whose parent is the same agent.
    local parent = procs[p.ppid]
    if pane and not (parent and parent.name == p.name) then
      local pwd = call("block.method", {
        session_id = pane.session_id,
        block_id = pane.block_id,
        method = "pwd",
      })
      agents[#agents + 1] = {
        pane = pane,
        name = kind,
        kind = kind,
        cwd = pwd and pwd.pwd and pwd.pwd:gsub("^file://[^/]*", ""),
        state = { order = 3, label = "" },
      }
    end
  end

  table.sort(agents, function(a, b)
    if a.state.order ~= b.state.order then
      return a.state.order < b.state.order
    end
    return (a.updated or 0) > (b.updated or 0)
  end)
  return agents
end

rex.action({
  name = "agents_pick",
  title = "Agents: Switch to Agent…",
  description = "List the coding agents running in every Rex session and jump to one.",
  keywords = "claude codex agent switch jump",
  run = function(ctx)
    local agents = collect()
    local items, by_id = {}, {}
    for _, a in ipairs(agents) do
      local id = a.pane.session_id .. "|" .. a.pane.block_id
      if not by_id[id] then
        by_id[id] = a
        local here = a.pane.block_id == ctx.block_id and " (this pane)" or ""
        items[#items + 1] = {
          id = id,
          icon = "code",
          title = a.name .. here,
          subtitle = a.pane.session_label .. " · tab " .. a.pane.tab .. " · " .. short_path(a.cwd),
          detail = a.updated and (a.state.label .. " " .. ago(a.updated)) or a.state.label,
        }
      end
    end

    local choice = rex.ui.pick({
      title = #items == 0 and "No agents running in Rex" or ("Agents (" .. #items .. ")"),
      placeholder = "Filter by name, session or folder",
      confirm = "Go to agent",
      items = items,
    })
    local a = choice and by_id[choice]
    if not a then
      return
    end

    rex.call("session.focus_block", { session_id = a.pane.session_id, block_id = a.pane.block_id })
    rex.client.queue("session.select", { session_id = a.pane.session_id, window_id = a.pane.window_id })
  end,
})
