-- Rex (superlogical) config. Linked to ~/.config/rex/init.lua by dotfiles.toml.
-- Apply changes with `rex config reload`; `rex config check` reports errors.
-- `rex keymap` lists what this file binds; app defaults live in Settings.
--
-- Keymap tiers mirror config/herdr/config.toml:
--
--   ctrl+h/j/k/l ....... NAVIGATE  seamless across nvim splits and Rex panes
--   ctrl+arrows ........ focus the adjacent Rex pane (not nvim-aware)
--   alt+h/j/k/l ........ RESIZE    nvim splits when nvim is focused, else Rex pane
--   ctrl+alt+h/l ....... previous / next TAB      (also ctrl+alt+left/right)
--   ctrl+alt+j/k ....... next / previous SESSION  (also ctrl+alt+down/up)
--   ctrl+alt+shift ..... MOVE  tab (h/l) or pane (arrows)
--   ctrl+alt+s / t ..... session switcher / new tab
--   alt + .............. pane ops (split / zoom / close)
--   prefix (ctrl+b) .... the long tail (new tab/session, rename, resize mode…)
--
-- Needs Settings > Terminal > Keyboard > Option key = "Alt", otherwise
-- alt+h types "˙" and nvim never sees <M-h>.

local PASSTHROUGH = { nvim = true, vim = true }

local function foreground_is_vim(ctx)
  local ok, proc = pcall(rex.call, "block.method", {
    session_id = ctx.session_id,
    block_id = ctx.block_id,
    method = "process",
  })
  local fg = ok and proc and proc.foreground
  return fg and PASSTHROUGH[fg.name] or false
end

---------------------------------------------------------------------------
-- NAVIGATE: ctrl+h/j/k/l. nvim gets the key (return false) and crosses into
-- the next Rex pane itself at an edge (config/nvim/lua/plugins/rex-nav.lua).
---------------------------------------------------------------------------
local function nav(direction)
  return function(ctx)
    if foreground_is_vim(ctx) then
      return false
    end
    rex.call("session.focus_direction", { session_id = ctx.session_id, direction = direction })
    return true
  end
end

rex.bind("ctrl+h", nav("left"))
rex.bind("ctrl+j", nav("down"))
rex.bind("ctrl+k", nav("up"))
rex.bind("ctrl+l", nav("right"))

rex.bind("ctrl+left", "pane.focus.left")
rex.bind("ctrl+down", "pane.focus.down")
rex.bind("ctrl+up", "pane.focus.up")
rex.bind("ctrl+right", "pane.focus.right")

---------------------------------------------------------------------------
-- RESIZE: alt+h/j/k/l. A function binding cannot run client actions, so this
-- is a custom action: in nvim it re-sends the key (nvim's <M-h> resizes its
-- splits), anywhere else it resizes the Rex pane.
---------------------------------------------------------------------------
local RESIZE_KEY = { left = "alt+h", down = "alt+j", up = "alt+k", right = "alt+l" }

rex.action({
  name = "smart_resize",
  title = "Resize (nvim-aware)",
  args = { direction = "string" },
  repeats = true,
  run = function(ctx, args)
    if foreground_is_vim(ctx) then
      rex.client.queue("pane.send_key", { key = RESIZE_KEY[args.direction] })
    else
      rex.client.queue("pane.resize", { direction = args.direction })
    end
  end,
})

rex.bind("alt+h", "smart_resize", { direction = "left" })
rex.bind("alt+j", "smart_resize", { direction = "down" })
rex.bind("alt+k", "smart_resize", { direction = "up" })
rex.bind("alt+l", "smart_resize", { direction = "right" })

---------------------------------------------------------------------------
-- TABS and SESSIONS: ctrl+alt. Rex sessions play the role of herdr workspaces.
---------------------------------------------------------------------------
rex.bind("ctrl+alt+h", "client.tab.previous")
rex.bind("ctrl+alt+l", "client.tab.next")
rex.bind("ctrl+alt+left", "client.tab.previous")
rex.bind("ctrl+alt+right", "client.tab.next")

rex.bind("ctrl+alt+j", "session.next")
rex.bind("ctrl+alt+k", "session.previous")
rex.bind("ctrl+alt+down", "session.next")
rex.bind("ctrl+alt+up", "session.previous")

-- ctrl+alt+shift = move: tabs with h/l, panes with arrows.
rex.bind("ctrl+alt+shift+h", "client.tab.move.backward")
rex.bind("ctrl+alt+shift+l", "client.tab.move.forward")
rex.bind("ctrl+alt+shift+left", "pane.move.left")
rex.bind("ctrl+alt+shift+down", "pane.move.down")
rex.bind("ctrl+alt+shift+up", "pane.move.up")
rex.bind("ctrl+alt+shift+right", "pane.move.right")

rex.bind("ctrl+alt+s", "session.switch")
rex.bind("ctrl+alt+t", "client.tab.new")

---------------------------------------------------------------------------
-- PANE OPS: alt
---------------------------------------------------------------------------
rex.bind("alt+v", "pane.split.right")
rex.bind("alt+-", "pane.split.down")
rex.bind("alt+z", "pane.zoom")
rex.bind("alt+/", "pane.zoom")
rex.bind("ctrl+alt+/", "pane.zoom")
rex.bind("alt+w", "pane.close")

---------------------------------------------------------------------------
-- PREFIX (ctrl+b): the long tail, same letters as herdr
---------------------------------------------------------------------------
rex.bind("ctrl+b>h", "pane.focus.left")
rex.bind("ctrl+b>j", "pane.focus.down")
rex.bind("ctrl+b>k", "pane.focus.up")
rex.bind("ctrl+b>l", "pane.focus.right")
rex.bind("ctrl+b>v", "pane.split.right")
rex.bind("ctrl+b>-", "pane.split.down")
rex.bind("ctrl+b>z", "pane.zoom")
rex.bind("ctrl+b>f", "pane.zoom")
rex.bind("ctrl+b>x", "pane.close")
rex.bind("ctrl+b>=", "pane.balance")

rex.bind("ctrl+b>c", "client.tab.new")
rex.bind("ctrl+b>n", "client.tab.next")
rex.bind("ctrl+b>p", "client.tab.previous")
rex.bind("ctrl+b>shift+x", "client.tab.close")
rex.bind("ctrl+b>,", "client.tab.rename")
rex.bind("ctrl+b>shift+t", "client.tab.rename")
for i = 1, 9 do
  rex.bind("ctrl+b>" .. i, "client.tab.goto", { index = i })
end

rex.bind("ctrl+b>w", "session.switch")
rex.bind("ctrl+b>shift+n", "session.new")
rex.bind("ctrl+b>shift+w", "session.rename")
rex.bind("ctrl+b>shift+d", "session.close")

rex.bind("ctrl+b>shift+r", "client.config.reload")
rex.bind("ctrl+b>shift+s", "client.settings")
rex.bind("ctrl+b>shift+p", "client.palette.toggle")

-- Resize mode: ctrl+b r, then h/j/k/l or arrows, escape to leave.
rex.bind("ctrl+b>r", "client.mode.enter", { name = "resize" })
for key, dir in pairs({ h = "left", j = "down", k = "up", l = "right",
                        left = "left", down = "down", up = "up", right = "right" }) do
  rex.bind("resize/" .. key, "pane.resize", { direction = dir })
end

-- Press ctrl+b twice to send one ctrl+b to the terminal.
rex.bind("ctrl+b>ctrl+b", "pane.send_key", { key = "ctrl+b" })
