-- Hammerspoon config — replaces Karabiner Elements.
--
-- Key layout (matches the old Karabiner setup — Caps Lock and Control swapped):
--   * Caps Lock    -> Left Control  (Control in the easy-to-reach home spot)
--   * Left Control -> Hyper         (a real, system-wide cmd+ctrl+alt modifier)
--
-- hidutil only does 1:1 remaps, so it can't turn a key into a modifier combo.
-- We route Left Control -> F18 (an unused key) at the OS level, then an eventtap
-- below stamps cmd+ctrl+alt onto whatever you press while F18 is held. Because
-- those are *real* modifier flags, every app — Rectangle Pro, etc. — sees a
-- genuine cmd+ctrl+alt+<key> combo, not just Hammerspoon-internal bindings.
--
-- NOTE: Karabiner Elements must be quit for this to work — if it's running it
-- grabs the keyboard first and the remaps below won't take.

-- Expose the `hs` command-line tool (lets you run `hs -c "..."` from a shell).
require("hs.ipc")

-- OS-level remaps (idempotent; re-applied on every reload, which also covers
-- login since Hammerspoon loads at startup):
--   Caps Lock    (0x700000039) -> Left Control (0x7000000E0)
--   Left Control (0x7000000E0) -> F18          (0x70000006D)
hs.execute(
	[[hidutil property --set '{"UserKeyMapping":[{"HIDKeyboardModifierMappingSrc":0x700000039,"HIDKeyboardModifierMappingDst":0x7000000E0},{"HIDKeyboardModifierMappingSrc":0x7000000E0,"HIDKeyboardModifierMappingDst":0x70000006D}]}']]
)

-- Turn F18 (our remapped Left Control) into a real, system-wide Hyper modifier:
-- while it's held, stamp cmd+ctrl+alt onto every other key so any app sees a
-- genuine cmd+ctrl+alt+<key> combo. Requires Accessibility permission.
-- NOTE: eventtaps/watchers must be kept in a variable that outlives init.lua,
-- or Hammerspoon's garbage collector will quietly stop them. Globals do that.
local F18 = hs.keycodes.map.f18
local hyperHeld = false

hyperTap = hs.eventtap.new({ hs.eventtap.event.types.keyDown, hs.eventtap.event.types.keyUp }, function(e)
	-- Track and swallow F18 itself — it should never reach any app.
	if e:getKeyCode() == F18 then
		hyperHeld = e:getType() == hs.eventtap.event.types.keyDown
		return true
	end

	-- While Hyper is held, force cmd+ctrl+alt on (keeping any real shift/fn).
	if hyperHeld then
		local f = e:getFlags()
		e:setFlags({ cmd = true, ctrl = true, alt = true, shift = f.shift, fn = f.fn })
	end
	return false
end)
hyperTap:start()

-- The Hyper modifier, for binding our own shortcuts (same combo other apps see).
local hyper = { "cmd", "ctrl", "alt" }
local function bind(key, fn)
	hs.hotkey.bind(hyper, key, fn)
end

-- Launch or focus specific apps (focuses if already running).
bind("s", function()
	hs.application.launchOrFocus("Ghostty")
end)
bind("d", function()
	hs.application.launchOrFocus("Helium")
end)

-- Build a stable, alphabetical list of dock apps to cycle through.
local function dockApps()
	local apps = {}
	for _, app in ipairs(hs.application.runningApplications()) do
		if app:kind() == 1 then -- 1 = regular app with a dock icon
			table.insert(apps, app)
		end
	end
	table.sort(apps, function(a, b)
		return a:name():lower() < b:name():lower()
	end)
	return apps
end

local function cycle(dir)
	local apps = dockApps()
	if #apps == 0 then
		return
	end
	local front = hs.application.frontmostApplication()
	local idx = 1
	for i, app in ipairs(apps) do
		if front and app:pid() == front:pid() then
			idx = i
			break
		end
	end
	local nextIdx = ((idx - 1 + dir) % #apps) + 1
	apps[nextIdx]:activate()
end

bind("l", function()
	cycle(1)
end) -- next
bind("h", function()
	cycle(-1)
end) -- previous

-- Disable Cmd+H (hide window): swallow the keystroke before any app sees it.
disableCmdH = hs.eventtap.new({ hs.eventtap.event.types.keyDown }, function(e)
	local f = e:getFlags()
	if f.cmd and not (f.alt or f.ctrl or f.shift or f.fn) and e:getKeyCode() == hs.keycodes.map.h then
		return true -- consume the event
	end
	return false
end)
disableCmdH:start()

-- Auto-reload this config when it changes on disk (global, so it isn't GC'd).
configWatcher = hs.pathwatcher.new(hs.configdir .. "/init.lua", function(files)
	for _, file in ipairs(files) do
		if file:sub(-4) == ".lua" then
			hs.reload()
			return
		end
	end
end)
configWatcher:start()

hs.alert.show("Hammerspoon config loaded")
