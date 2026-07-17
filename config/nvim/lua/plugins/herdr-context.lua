-- Send code context (references, selections, diagnostics, hunks, symbols) from
-- Neovim to a live herdr agent's prompt — the herdr-native replacement for
-- sidekick's tmux mux, which is inert without tmux.
--
-- Stages context WITHOUT submitting (submit = false): the payload lands in the
-- target agent's input editor so you can review/add to it, then hit Enter
-- yourself. Multiline payloads use bracketed paste for claude/codex.
--
-- herdr side installed with: herdr plugin install makyinmars/herdr-context.nvim
-- Only active inside a herdr pane (needs HERDR_PANE_ID / HERDR_SOCKET_PATH).
--
--   <leader>ac  compose bundle (two-pane picker: selection/symbol/hunk/diags…)
--   <leader>ay  send reference only        @path#L10-L20
--   <leader>aY  send reference + code
--   <leader>ad  send diagnostics
--   <leader>at  choose target agent
--   <leader>aa  toggle live agent drawer
--   <leader>ar  refresh agent list
return {
  "makyinmars/herdr-context.nvim",
  cond = vim.env.HERDR_ENV == "1",
  lazy = false, -- keeps :checkhealth herdr-context discoverable before first mapping
  opts = {
    submit = false, -- stage context; you press Enter in the agent yourself
    focus_after_send = false,
    target_scope = "workspace", -- rank/limit candidate agents to this workspace
    remember_target = "session",
  },
  keys = {
    { "<leader>ac", function() require("herdr-context").compose() end, mode = { "n", "v" }, desc = "Compose Herdr Context" },
    { "<leader>ay", function() require("herdr-context").reference() end, mode = { "n", "v" }, desc = "Send Reference to Herdr Agent" },
    { "<leader>aY", function() require("herdr-context").send() end, mode = { "n", "v" }, desc = "Send Context to Herdr Agent" },
    { "<leader>ad", function() require("herdr-context").diagnostics() end, mode = { "n", "v" }, desc = "Send Diagnostics to Herdr Agent" },
    { "<leader>at", function() require("herdr-context").select_target() end, desc = "Select Herdr Agent" },
    { "<leader>aa", function() require("herdr-context").agents() end, desc = "Toggle Herdr Agents" },
    { "<leader>ar", function() require("herdr-context").refresh() end, desc = "Refresh Herdr Agents" },
  },
}
