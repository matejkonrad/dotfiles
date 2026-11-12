// Agent CLIs the review can ask, each run read-only and as isolated from the user's own setup as its CLI allows.
// Pure: argv, environment and output parsing only. agent-runner.mjs spawns them.

/** In the order the panel picks a default: the first installed one that is isolated. */
export const PROVIDERS = [
  { id: "claude", name: "Claude", bin: "claude", isolated: true },
  { id: "codex", name: "Codex", bin: "codex", isolated: true },
  // opencode loads its global plugins and AGENTS.md whatever we pass; it is offered, never picked by default.
  { id: "opencode", name: "OpenCode", bin: "opencode", isolated: false },
];

export const providerOf = (id) => PROVIDERS.find((p) => p.id === id) ?? null;

/** The provider to use: the saved one when installed, else the first installed isolated one. */
export function pickProvider(saved, installed) {
  if (saved && installed.includes(saved)) return saved;
  return PROVIDERS.find((p) => p.isolated && installed.includes(p.id))?.id ?? null;
}

// ---- Codex ----------------------------------------------------------------------------------

// Everything Codex could reach beyond reading the checkout. The user's config.toml is not loaded at all
// (MCP servers, plugins, memories, hooks); these features are on by default even without it.
export const DISABLED_FEATURES = ["apps", "browser_use", "browser_use_external", "computer_use", "in_app_browser", "memories",
  "plugins", "remote_plugin", "plugin_discovery_prefetch", "skill_mcp_dependency_install", "multi_agent", "hooks", "image_generation"];

/**
 * A new session, or (session) a follow-up in the thread's session. `exec resume` takes no --sandbox or -C:
 * the sandbox comes from the config override and the folder from the process's cwd.
 */
export function codexArgs({ model, effort, schemaFile, resultFile, root, session = null }) {
  const common = ["--ignore-user-config", "--ignore-rules",
    ...(model ? ["-m", model] : []), ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
    "-c", 'approval_policy="never"', "-c", 'sandbox_mode="read-only"', "-c", "project_doc_max_bytes=0",
    ...DISABLED_FEATURES.flatMap((f) => ["--disable", f]),
    "--json", "--output-schema", schemaFile, "--output-last-message", resultFile];
  return session ? ["exec", "resume", ...common, session, "-"]
    : ["exec", ...common, "--sandbox", "read-only", "--color", "never", "-C", root, "-"];
}

/** Top-level `model` and `model_reasoning_effort` of a config.toml, without reading anything else from it. */
export function codexDefaults(toml) {
  const out = {};
  for (const line of String(toml ?? "").split("\n")) {
    if (/^\s*\[/.test(line)) break;
    const m = /^\s*(model|model_reasoning_effort)\s*=\s*"([^"]*)"\s*(#.*)?$/.exec(line);
    if (m) out[m[1] === "model" ? "model" : "effort"] = m[2];
  }
  return out;
}

// ---- Claude Code ----------------------------------------------------------------------------

// Read-only git: enough to read a PR's commits (`git show <sha>:<path>`) when the checkout is elsewhere.
export const CLAUDE_GIT = ["show", "log", "diff", "blame", "grep", "ls-files", "cat-file", "rev-parse"].map((c) => `Bash(git ${c}:*)`);
export const CLAUDE_TOOLS = ["Read", "Grep", "Glob", "Bash"];
export const CLAUDE_DENIED = ["Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite"];

/**
 * --safe-mode: no CLAUDE.md, skills, plugins, hooks, MCP servers or custom agents; --restricted: no user, project
 * or local settings files (so no settings hooks) and file tools stay in the checkout. dontAsk with prompts "none"
 * denies every tool call that is not allowed here, so nothing can edit, fetch or start agents.
 */
export function claudeArgs({ model, effort, schema, session = null }) {
  return ["-p", "--output-format", "stream-json", "--verbose", "--json-schema", JSON.stringify(schema),
    ...(session ? ["--resume", session] : []),
    "--safe-mode", "--restricted", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--tools", CLAUDE_TOOLS.join(","),
    "--allowedTools", ["Read", "Grep", "Glob", ...CLAUDE_GIT].join(","),
    "--disallowedTools", CLAUDE_DENIED.join(","),
    "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--disable-slash-commands", "--no-chrome",
    ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])];
}

// ---- OpenCode -------------------------------------------------------------------------------

export function opencodeArgs({ model, promptFile, session = null }) {
  return ["run", "--format", "json", "--agent", "plan", ...(model ? ["-m", model] : []), ...(session ? ["--session", session] : []),
    "-f", promptFile, "Follow the instructions in the attached file. Reply with the fenced JSON block only."];
}

/** Inline config: the plan agent, no edits, no web, and only read-only git in the shell. */
export const OPENCODE_CONFIG = { permission: { edit: "deny", webfetch: "deny",
  bash: { "*": "deny", "git show *": "allow", "git log *": "allow", "git diff *": "allow", "git blame *": "allow", "git grep *": "allow" } } };

// ---- shared -----------------------------------------------------------------------------------

/**
 * The child's environment: no variables of the app or a parent agent session leak in (a nested `claude` that sees
 * them reports to the parent's terminal), plus the provider's own switches.
 */
export function childEnv(id, env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(HERDR_|HC_|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$|CLAUDE_CODE_SSE_PORT$|OPENCODE_)/.test(k)) continue;
    out[k] = v;
  }
  if (id === "claude") Object.assign(out, { DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" });
  if (id === "opencode") Object.assign(out, { OPENCODE_CONFIG_CONTENT: JSON.stringify(OPENCODE_CONFIG), OPENCODE_DISABLE_AUTOUPDATE: "1" });
  return out;
}

/** Providers without a schema mode answer with one fenced JSON block; the last one that parses wins. */
export function extractJson(text) {
  const s = String(text ?? "");
  const blocks = [...s.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const b of blocks.reverse()) { try { return JSON.parse(b); } catch { /* the next one */ } }
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(s.slice(start, end + 1)); } catch { /* below */ } }
  throw new Error("The agent did not return the JSON block. Try again.");
}

/** The answer object from a provider's output: Codex's result file, Claude's JSON, OpenCode's event lines. */
export function parseOutput(id, { stdout = "", resultText = null } = {}) {
  if (id === "codex") return JSON.parse(resultText);
  if (id === "claude") {
    const events = String(stdout).trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const out = events.findLast((e) => e.type === "result") ?? events.at(-1);
    if (!out) throw new Error("Claude returned nothing.");
    if (out.is_error || out.subtype && out.subtype !== "success") throw new Error(`Claude failed: ${String(out.result ?? out.subtype).slice(0, 200)}`);
    if (out.structured_output && typeof out.structured_output === "object") return out.structured_output;
    return extractJson(out.result);
  }
  // OpenCode prints one JSON event per line; the reply is the text parts.
  const texts = [];
  for (const line of String(stdout).split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const part = e.part ?? e;
    if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
    if (e.type === "error") throw new Error(`OpenCode failed: ${String(e.error?.message ?? e.message ?? "error").slice(0, 200)}`);
  }
  return extractJson(texts.join("\n"));
}

// ---- sessions and progress ------------------------------------------------------------------------

/** The session id in one output event (each CLI prints it near the start), or null. */
export function sessionOf(id, e) {
  if (!e || typeof e !== "object") return null;
  if (id === "codex") return e.type === "thread.started" ? e.thread_id ?? null : null;
  if (id === "claude") return typeof e.session_id === "string" ? e.session_id : null;
  return e.sessionID ?? e.part?.sessionID ?? e.session_id ?? null;
}

const short = (text, n = 48) => { const s = String(text ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const base = (p) => String(p ?? "").split("/").pop();

/** What the agent does now, from one output event, as a short line ("Reading tab.js"), or null. */
export function progressOf(id, e) {
  if (!e || typeof e !== "object") return null;
  const tool = (name, input = {}) => {
    const n = String(name ?? "").toLowerCase();
    if (n === "read") return `Reading ${base(input.file_path ?? input.filePath ?? input.path)}`;
    if (n === "grep") return `Searching '${short(input.pattern, 32)}'`;
    if (n === "glob") return `Listing ${short(input.pattern, 32)}`;
    if (n === "bash") return `Running ${short(input.command, 40)}`;
    return name ? `Using ${name}` : null;
  };
  if (id === "claude") {
    const use = e.type === "assistant" ? (e.message?.content ?? []).filter((c) => c.type === "tool_use").at(-1) : null;
    if (use) return tool(use.name, use.input);
    if (e.type === "assistant" && (e.message?.content ?? []).some((c) => c.type === "text")) return "Writing the answer";
    return null;
  }
  if (id === "codex") {
    const item = e.item;
    if (e.type === "item.started" && item?.type === "command_execution") return `Running ${short(item.command, 40)}`;
    if (e.type === "item.started" && item?.type === "reasoning") return "Thinking";
    if (e.type === "item.completed" && item?.type === "agent_message") return "Writing the answer";
    return null;
  }
  const part = e.part ?? e;
  if (part?.type === "tool" || e.type === "tool_use") return tool(part.tool ?? part.name, part.state?.input ?? part.input);
  return null;
}
