import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCHEMA, gitGuard, validateResult, run } from "../agent-runner.mjs";
import { DISABLED_FEATURES, PROVIDERS, progressOf, sessionOf, codexArgs, claudeArgs, opencodeArgs, childEnv, extractJson, parseOutput, pickProvider } from "../providers.mjs";

async function data(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "herdr-skill-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A fake agent CLI on PATH: records its arguments, stdin and environment, then answers like the real one. */
async function fakeAgent(t, bin, answer, { wait = false, failResume = false } = {}) {
  const dir = await data(t);
  const script = path.join(dir, bin);
  const reply = {
    codex: `console.log(JSON.stringify({ type: "thread.started", thread_id: "S-codex" })); console.log(JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "git show HEAD:x" } }));
fs.writeFileSync(args[args.indexOf("--output-last-message") + 1], ${JSON.stringify(JSON.stringify(answer))});`,
    claude: `console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "S-claude" }));
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", session_id: "S-claude", structured_output: ${JSON.stringify(answer)} }));`,
    opencode: `process.stdout.write(JSON.stringify({ type: "text", sessionID: "S-opencode", part: { type: "text", text: "Here:\\n\`\`\`json\\n" + ${JSON.stringify(JSON.stringify(answer))} + "\\n\`\`\`" } }) + "\\n");`,
  }[bin];
  await fs.writeFile(script, `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
let stdin = ""; process.stdin.on("data", (d) => stdin += d); process.stdin.on("end", () => {
const calls = ${JSON.stringify(path.join(dir, "calls.json"))};
const all = fs.existsSync(calls) ? JSON.parse(fs.readFileSync(calls, "utf8")) : [];
fs.writeFileSync(calls, JSON.stringify([...all, args]));
fs.writeFileSync(${JSON.stringify(path.join(dir, "call.json"))}, JSON.stringify({ args, stdin, env: process.env, cwd: process.cwd(), pid: process.pid }));
${failResume ? 'if (args.includes("resume") || args.includes("--resume") || args.includes("--session")) process.exit(1);' : ""}
${wait ? "setInterval(() => {}, 1000);" : reply}
});
`);
  await fs.chmod(script, 0o755);
  const old = process.env.PATH;
  process.env.PATH = `${dir}:${old}`;
  t.after(() => { process.env.PATH = old; });
  return { call: async () => JSON.parse(await fs.readFile(path.join(dir, "call.json"), "utf8")),
    calls: async () => JSON.parse(await fs.readFile(path.join(dir, "calls.json"), "utf8")) };
}

const FILES = [{ path: "x", rows: [{ k: "add", o: null, n: 1, text: "a" }, { k: "add", o: null, n: 2, text: "b" }] }];
async function request(t, dir, extra = {}) {
  const root = await data(t);
  const file = path.join(dir, "request.json");
  await fs.writeFile(file, JSON.stringify({ action: "ask", root, data: dir, message: "Always use an example",
    thread: { anchor: { path: "x", side: "RIGHT", start_line: 1, line: 2 }, entries: [] }, comparison: { files: FILES }, ...extra }));
  return { file, root };
}
const NOTED = { answer: [{ type: "text", md: "Noted", ref: null }], walkthrough: null };

test("Codex runs without the user's config: no MCP servers, plugins, memories or hooks, read-only", () => {
  const args = codexArgs({ model: "gpt-x", effort: "medium", schemaFile: "s", resultFile: "r", root: "/repo" });
  for (const flag of ["--ignore-user-config", "--ignore-rules", "--json"]) assert.ok(args.includes(flag), flag);
  assert.ok(args.includes('sandbox_mode="read-only"'));
  assert.deepEqual(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
  assert.ok(args.includes("project_doc_max_bytes=0"));
  for (const feature of ["memories", "plugins", "apps", "browser_use", "computer_use", "hooks"]) {
    assert.ok(DISABLED_FEATURES.includes(feature));
    assert.ok(args.some((a, i) => a === "--disable" && args[i + 1] === feature), feature);
  }
  assert.deepEqual(args.slice(args.indexOf("-m"), args.indexOf("-m") + 2), ["-m", "gpt-x"]);
  assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("Claude runs isolated and read-only: no MCP, settings, plugins or hooks; no edit or web tools", () => {
  const args = claudeArgs({ model: null, effort: null, schema: SCHEMA });
  const value = (flag) => args[args.indexOf(flag) + 1];
  for (const flag of ["-p", "--safe-mode", "--restricted", "--strict-mcp-config", "--disable-slash-commands", "--verbose"]) assert.ok(args.includes(flag), flag);
  assert.equal(value("--mcp-config"), '{"mcpServers":{}}');
  assert.equal(value("--permission-mode"), "dontAsk");
  assert.equal(value("--permission-prompts"), "none");
  assert.equal(value("--output-format"), "stream-json");
  assert.deepEqual(JSON.parse(value("--json-schema")), SCHEMA);
  assert.deepEqual(value("--tools").split(","), ["Read", "Grep", "Glob", "Bash"]);
  const allowed = value("--allowedTools").split(",");
  assert.ok(allowed.every((a) => ["Read", "Grep", "Glob"].includes(a) || /^Bash\(git (show|log|diff|blame|grep|ls-files|cat-file|rev-parse):\*\)$/.test(a)), "only read-only git in Bash");
  for (const tool of ["Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task"]) assert.ok(value("--disallowedTools").split(",").includes(tool), tool);
  assert.ok(!args.includes("--dangerously-skip-permissions") && !args.includes("bypassPermissions"));
  assert.ok(!args.includes("--model"), "the model is optional");
  assert.deepEqual(claudeArgs({ model: "opus", schema: SCHEMA }).slice(-2), ["--model", "opus"]);
});

test("OpenCode uses the plan agent with edits and web denied, and is never the default", () => {
  const args = opencodeArgs({ model: null, promptFile: "/p.md" });
  assert.deepEqual(args.slice(0, 5), ["run", "--format", "json", "--agent", "plan"]);
  const env = childEnv("opencode", {});
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.permission.edit, "deny");
  assert.equal(config.permission.bash["*"], "deny");
  assert.equal(PROVIDERS.find((p) => p.id === "opencode").isolated, false);
  assert.equal(pickProvider(null, ["opencode"]), null);
  assert.equal(pickProvider("opencode", ["opencode"]), "opencode", "only when the user picks it");
  assert.equal(pickProvider(null, ["codex", "claude"]), "claude");
  assert.equal(pickProvider("codex", ["codex", "claude"]), "codex");
  assert.equal(pickProvider("claude", ["codex"]), "codex", "a saved provider that is gone falls back");
});

test("the child environment drops the app's and a parent agent's variables", () => {
  const env = childEnv("claude", { PATH: "/bin", HERDR_ENV: "1", HC_TERMINAL_ID: "t1", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", ANTHROPIC_API_KEY: "k" });
  assert.deepEqual(Object.keys(env).filter((k) => /HERDR|HC_|CLAUDECODE|ENTRYPOINT/.test(k)), []);
  assert.equal(env.PATH, "/bin");
  assert.equal(env.ANTHROPIC_API_KEY, "k");
});

test("fenced JSON: the last block that parses wins; prose around it is ignored; none is an error", () => {
  assert.deepEqual(extractJson('Sure.\n```json\n{"a":1}\n```\nand\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```\n```json\n{broken\n```'), { a: 1 });
  assert.deepEqual(extractJson('The answer is {"a":3} here'), { a: 3 });
  assert.throws(() => extractJson("no json here"), /did not return the JSON/);
  assert.deepEqual(parseOutput("claude", { stdout: JSON.stringify({ subtype: "success", result: '```json\n{"a":4}\n```' }) }), { a: 4 });
  assert.throws(() => parseOutput("claude", { stdout: JSON.stringify({ subtype: "error_max_turns", is_error: true }) }), /Claude failed/);
});

for (const bin of ["codex", "claude", "opencode"]) {
  test(`${bin}: a thread question returns the same result shape`, async (t) => {
    const dir = await data(t);
    const agent = await fakeAgent(t, bin, NOTED);
    const { file, root } = await request(t, dir, { provider: bin });
    const result = await run(file);
    assert.deepEqual(result, { answer: [{ type: "text", md: "Noted" }], walkthrough: null, provider: bin, session: { provider: bin, id: `S-${bin}` } });
    const call = await agent.call();
    assert.equal(await fs.realpath(call.cwd), await fs.realpath(root));
    const prompt = bin === "opencode" ? "" : call.stdin;
    if (bin !== "opencode") assert.match(prompt, /untrusted source material/);
    if (bin === "opencode") assert.ok(call.args.includes("-f"));
    if (bin === "claude") assert.ok(call.args.includes("--safe-mode"));
    if (bin === "codex") assert.ok(call.args.includes("--ignore-user-config"));
  });
}

for (const bin of ["codex", "claude"]) {
  test(`${bin}: cancelling kills the agent's process group and stops the run`, async (t) => {
    const dir = await data(t);
    const agent = await fakeAgent(t, bin, null, { wait: true });
    const { file } = await request(t, dir, { provider: bin });
    const running = run(file);
    let call = null;
    for (let i = 0; i < 200 && !call; i++) { call = await agent.call().catch(() => null); if (!call) await new Promise((r) => setTimeout(r, 25)); }
    const { pid } = call;
    await fs.writeFile(`${file}.cancel`, "cancel");
    await assert.rejects(running, /Cancelled/);
    let alive = true;
    for (let i = 0; i < 100 && alive; i++) { try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 25)); } catch { alive = false; } }
    assert.equal(alive, false, "the agent process is gone");
  });
}

test("code excerpts outside the diff cannot apply; ranges are made exact", () => {
  const req = { action: "ask", comparison: { files: [{ path: "x", rows: [{ k: "del", o: 5, n: null }, { k: "add", o: null, n: 5 }] }] } };
  const ok = validateResult({ answer: [{ type: "code", ref: { path: "x", side: "LEFT", start_line: 9, line: 5 } }], walkthrough: null }, req);
  assert.deepEqual(ok.answer[0].ref, { path: "x", side: "LEFT", start_line: 5, line: 5 });
  assert.throws(() => validateResult({ answer: [{ type: "code", ref: { path: "x", side: "LEFT", start_line: 7, line: 7 } }], walkthrough: null }, req), /outside this diff/);
});

test("only generation returns a walkthrough, and every step needs an excerpt", () => {
  const req = { action: "generate", comparison: { files: FILES } };
  const step = { title: "Flow", blocks: [{ type: "text", md: "Changed", ref: null }, { type: "code", md: "", ref: { path: "x", side: "RIGHT", start_line: 1, line: 2 } }] };
  const value = { answer: [], walkthrough: { summary: "Change", steps: [step] } };
  assert.equal(validateResult(value, req).walkthrough.steps.length, 1);
  assert.equal(validateResult(JSON.parse(JSON.stringify(value)), { ...req, action: "ask" }).walkthrough, null, "a thread never replaces the walkthrough");
  assert.equal(SCHEMA.properties.learning, undefined, "no learning in the schema");
  const prose = { answer: [], walkthrough: { summary: "Change", steps: [{ title: "Only words", blocks: [{ type: "text", md: "x", ref: null }] }] } };
  assert.throws(() => validateResult(prose, req), /no code excerpt/);
});

test("the git guard runs read-only subcommands and refuses options that write or execute", async (t) => {
  const { execFile } = await import("node:child_process");
  const run = (cwd, ...args) => new Promise((resolve) => execFile(path.join(dir, "git"), args, { cwd }, (e, stdout, stderr) => resolve({ code: e?.code ?? 0, stdout, stderr })));
  const work = await data(t), repo = await data(t);
  const dir = await gitGuard(work);
  await new Promise((r) => execFile("git", ["init", "-q", repo], r));
  assert.equal((await run(repo, "rev-parse", "--is-inside-work-tree")).stdout.trim(), "true");
  assert.equal((await run(repo, "-C", repo, "rev-parse", "--is-inside-work-tree")).stdout.trim(), "true");
  for (const bad of [["diff", "--output=/tmp/x"], ["grep", "-Ocat", "x"], ["grep", "--open-files-in-pager=sh", "x"], ["-c", "core.pager=sh", "log"], ["commit", "-m", "x"], ["push"], ["log", "--ext-diff"]]) {
    const r = await run(repo, ...bad);
    assert.equal(r.code, 2, bad.join(" "));
    assert.match(r.stderr, /not allowed|only show/);
  }
});

test("resume argv per provider keeps every isolation flag", () => {
  const c = codexArgs({ schemaFile: "s", resultFile: "r", root: "/repo", session: "S1" });
  assert.deepEqual(c.slice(0, 2), ["exec", "resume"]);
  assert.deepEqual(c.slice(-2), ["S1", "-"]);
  for (const flag of ["--ignore-user-config", "--ignore-rules", 'sandbox_mode="read-only"', "project_doc_max_bytes=0"]) assert.ok(c.includes(flag), flag);
  assert.ok(!c.includes("-C") && !c.includes("--sandbox"), "exec resume takes neither; cwd and the config override do it");
  const cl = claudeArgs({ schema: SCHEMA, session: "S2" });
  assert.equal(cl[cl.indexOf("--resume") + 1], "S2");
  assert.ok(cl.includes("--safe-mode") && cl.includes("--restricted"));
  const o = opencodeArgs({ promptFile: "/p", session: "S3" });
  assert.equal(o[o.indexOf("--session") + 1], "S3");
});

for (const bin of ["codex", "claude", "opencode"]) {
  test(`${bin}: a follow-up resumes the thread's session; a failed resume starts a new one`, async (t) => {
    const dir = await data(t);
    const agent = await fakeAgent(t, bin, NOTED, { failResume: true });
    const { file } = await request(t, dir, { provider: bin, session: { provider: bin, id: "OLD" } });
    const result = await run(file);
    const calls = await agent.calls();
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes("OLD"), "resumes first");
    assert.ok(!calls[1].includes("OLD"), "then a new session");
    assert.equal(result.session.id, `S-${bin}`);
  });
}

test("a session of another provider is not resumed", async (t) => {
  const dir = await data(t);
  const agent = await fakeAgent(t, "claude", NOTED);
  const { file } = await request(t, dir, { provider: "claude", session: { provider: "codex", id: "C1" } });
  await run(file);
  assert.equal((await agent.calls()).length, 1);
  assert.ok(!(await agent.calls())[0].includes("--resume"));
});

test("progress: one short line per tool, from each CLI's events", () => {
  assert.equal(progressOf("claude", { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/r/src/tab.js" } }] } }), "Reading tab.js");
  assert.equal(progressOf("claude", { type: "assistant", message: { content: [{ type: "tool_use", name: "Grep", input: { pattern: "mobileView" } }] } }), "Searching 'mobileView'");
  assert.equal(progressOf("codex", { type: "item.started", item: { type: "command_execution", command: "git show abc:x.js" } }), "Running git show abc:x.js");
  assert.equal(sessionOf("codex", { type: "thread.started", thread_id: "T" }), "T");
  assert.equal(sessionOf("claude", { type: "system", session_id: "C" }), "C");
});

test("the runner stops its agent when the host removes the request, and at the host's deadline", async (t) => {
  const dir = await data(t);
  const agent = await fakeAgent(t, "claude", null, { wait: true });
  const { file } = await request(t, dir, { provider: "claude" });
  const running = run(file);
  let call = null;
  for (let i = 0; i < 200 && !call; i++) { call = await agent.call().catch(() => null); if (!call) await new Promise((r) => setTimeout(r, 25)); }
  const started = Date.now();
  await fs.rm(file);
  await assert.rejects(running, /stopped waiting/);
  assert.ok(Date.now() - started < 1500, "within a second");

  const late = await request(t, dir, { provider: "claude", deadline: Date.now() + 1500 });
  const before = Date.now();
  await assert.rejects(run(late.file), /took too long/);
  assert.ok(Date.now() - before < 4000, "the deadline holds");
});
