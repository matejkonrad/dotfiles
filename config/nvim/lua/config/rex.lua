-- Rex (superlogical) helpers: pane navigation and sending text to the coding
-- agents (Claude Code, Codex, ...) that run in other panes of the same Rex
-- session. Used by plugins/rex-nav.lua, terminal-nav.lua and git-review.lua.
local M = {}

-- Foreground program names that count as an agent pane.
local AGENTS = { claude = true, codex = true, opencode = true, pi = true, gemini = true, aider = true }

-- Rex session id when this nvim owns a Rex pane, nil under herdr or tmux
-- (those navigators own the keys there).
function M.session()
  local s = vim.env.REX_SESSION
  if not s or s == "" or vim.env.HERDR_ENV == "1" or (vim.env.TMUX and vim.env.TMUX ~= "") then
    return nil
  end
  return s
end

local function rex(args)
  local res = vim.system(vim.list_extend({ "rex" }, args), { text = true }):wait()
  if res.code ~= 0 then
    return nil, vim.trim(res.stderr or "")
  end
  return res.stdout
end

local DIR = { h = "left", j = "down", k = "up", l = "right" }

---Focus the neighbouring Rex pane.
---@param dir "h"|"j"|"k"|"l"
function M.focus(dir)
  vim.system({ "rex", "focus", DIR[dir], "-s", M.session() })
end

---Move to the nvim split in `dir`, or into the Rex pane beyond it at an edge.
---@param dir "h"|"j"|"k"|"l"
function M.navigate(dir)
  local win = vim.api.nvim_get_current_win()
  vim.cmd.wincmd(dir)
  if vim.api.nvim_get_current_win() == win then
    M.focus(dir)
  end
end

---@class RexAgent
---@field block_id string
---@field window_id string
---@field name string
---@field cwd string

---Agent panes in this Rex session, found by their foreground program.
---@return RexAgent[]?, string?
function M.agents()
  local out, err = rex({ "block", "ls", "-s", M.session(), "--json" })
  if not out then
    return nil, err
  end
  local agents = {}
  for _, block in ipairs(vim.json.decode(out).blocks or {}) do
    if block.block_id ~= vim.env.REX_BLOCK then
      local pout = rex({ "block", "call", "-s", M.session(), "-b", block.block_id, "process" })
      local fg = pout and vim.json.decode(pout).foreground
      -- Claude Code's process name is its version, so match argv0 instead.
      local name = fg and vim.fs.basename(fg.argv0 or fg.name or "")
      if name and AGENTS[name] then
        table.insert(agents, { block_id = block.block_id, window_id = block.window_id, name = name, cwd = fg.cwd })
      end
    end
  end
  return agents
end

---Pick the agent to talk to: the only one, the only one in this tab, or ask.
---@param cb fun(agent: RexAgent)
function M.with_agent(cb)
  local agents, err = M.agents()
  if not agents then
    vim.notify("rex: " .. tostring(err), vim.log.levels.ERROR, { title = "rex" })
    return
  end
  if #agents == 0 then
    vim.notify("No agent pane in this Rex session", vim.log.levels.WARN, { title = "rex" })
    return
  end
  if #agents > 1 then
    local here = vim.json.decode(rex({ "block", "inspect", "-s", M.session(), vim.env.REX_BLOCK, "--json" }) or "{}")
    local window = here.block and here.block.window_id
    local same = vim.tbl_filter(function(a)
      return a.window_id == window
    end, agents)
    if #same == 1 then
      agents = same
    end
  end
  if #agents == 1 then
    return cb(agents[1])
  end
  vim.ui.select(agents, {
    prompt = "Agent",
    format_item = function(a)
      return ("%s  %s"):format(a.name, vim.fn.fnamemodify(a.cwd or "", ":~"))
    end,
  }, function(a)
    if a then
      cb(a)
    end
  end)
end

---Type `payload` into the agent's prompt without submitting it, then focus it.
---@param payload string
---@param what string
---@param agent? RexAgent
function M.send(payload, what, agent)
  local function deliver(a)
    local _, err = rex({ "send", "-s", M.session(), "-b", a.block_id, "--", payload })
    if err then
      vim.notify("rex send: " .. err, vim.log.levels.ERROR, { title = "rex" })
      return
    end
    rex({ "focus", "-s", M.session(), a.block_id })
    vim.notify(what .. " staged in " .. a.name, vim.log.levels.INFO, { title = "rex" })
  end
  if agent then
    deliver(agent)
  else
    M.with_agent(deliver)
  end
end

---Reference the current file (and line range) at the agent's prompt, as
---`@path#L10-20`, with the path relative to the agent's cwd.
---@param range? { [1]: integer, [2]: integer }
function M.reference(range)
  local file = vim.api.nvim_buf_get_name(0)
  if file == "" then
    vim.notify("Buffer has no file", vim.log.levels.WARN, { title = "rex" })
    return
  end
  M.with_agent(function(agent)
    local path = agent.cwd and vim.fs.relpath(agent.cwd, file) or file
    local ref = "@" .. path
    if range then
      ref = ref .. (range[1] == range[2] and "#L%d" or "#L%d-%d"):format(range[1], range[2])
    end
    M.send(ref .. " ", ref, agent)
  end)
end

return M
