#!/usr/bin/env node
// Scroll cost in the native runtime: a 5k-row diff with drafts, a GitHub thread, an agent thread and the
// walkthrough open. Each "tick" is one wheel step followed by what the app does for it (render()).
//   node scroll-bench.mjs
import * as fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureMain } from "./fixtures.mjs";

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files = `Array.from({length:5},(_,f)=>({path:"src/big-"+f+".ts",status:"modified",additions:500,deletions:500,rows:[{k:"hunk",text:"@@"},...Array.from({length:1000},(_,i)=>i%2?{k:"add",o:null,n:i,text:"  const result"+i+" = await transform(input, "+i+"); // changed"}:{k:"del",o:i+1,n:null,text:"  const result"+i+" = await compute(input, "+i+");"})]}))`;
const walk = `{v:2,at:5,current:"v1",threads:[{id:"T1",title:"Why transform?",at:3,readAt:0,anchor:{path:"src/big-0.ts",side:"RIGHT",start_line:11,line:13,snippet:[],comparisonKey:"fixture-key"},entries:[{id:"q",role:"question",body:"Why?",at:1},{id:"a",role:"answer",provider:"claude",at:2,blocks:[{type:"text",md:"Because \`transform\` is faster."},{type:"code",ref:{path:"src/big-0.ts",side:"RIGHT",start_line:11,line:13}}]}]}],
 versions:[{id:"v1",at:1,comparisonKey:"fixture-key",provider:"claude",walkthrough:{summary:"Every call now uses transform. The results stay the same.",steps:Array.from({length:4},(_,s)=>({title:"Step "+s+" moves calls to transform",blocks:[{type:"text",md:"The **calls** in \`big-"+s+"\` now use \`transform\`."},{type:"code",ref:{path:"src/big-"+s+".ts",side:"RIGHT",start_line:21,line:21}},{type:"text",md:"Callers see the same values."}]}))}}]}`;
const setup = `const T = this.impl, A = T.agent;
A.record = ${walk}; A.focused = false;
const N = Array.from({length:20},(_,i)=>({id:"n"+i,path:"src/big-"+(i%5)+".ts",side:"RIGHT",line:1+i*40,body:"Draft "+i,sha:"head"})); T.notes = () => N;
T.meta.threads = [{id:"g1",path:"src/big-1.ts",side:"RIGHT",line:101,resolved:false,outdated:false,comments:[{author:{login:"a"},createdAt:new Date().toISOString(),body:"Why?"}]}];
`;
// Timed inside render(): the runtime takes element callbacks only while it builds a frame, and one frame has an
// execution budget, so each scenario is its own check run: a warm render, one tick, the timed render.
// What one wheel tick redraws: before the columns were nested views, the whole tab; now only that column.
const SCENARIOS = { "whole tab (one tick before)": "T.render(cx)", "diff column (diff tick now)": 'T.column("diff", cx)',
  "Agent panel column (agent tick now)": 'T.column("agent", cx)', "file list column (file tick now)": 'T.column("files", cx)',
  "diff column, warm (second tick)": 'T.column("diff", cx); rows = 0; T.scroll.top += 60; t1 = Date.now(); T.column("diff", cx)',
  "Agent panel, warm (second tick)": 'T.column("agent", cx); A.scroll.top += 60; t1 = Date.now(); T.column("agent", cx)' };
const bench = (call) => `const T = this.impl, A = T.agent;
let rows = 0; const rowEl = T.rowEl.bind(T); T.rowEl = (...a) => { rows++; return rowEl(...a); };
T.scroll.height = 900; T.scroll.raw = 900; A.scroll.height = 800; A.scroll.raw = 800; T.fileScroll.height = 900; T.fileScroll.raw = 900;
T.scroll.top = 2000; A.scroll.top = 300;
let t1 = Date.now(); ${call};
console.error("  ms " + this.label + ": " + (Date.now() - t1) + " ms, " + rows + " diff rows built");`;
const target = await fs.mkdtemp(path.join(tmpdir(), "herdr-review-bench-"));
try {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.isFile() && (/\.(js|mjs|lua)$/.test(entry.name) || entry.name === "mod.json")) await fs.copyFile(path.join(source, entry.name), path.join(target, entry.name));
  }
  for (const [label, tick] of Object.entries(SCENARIOS)) {
    await fs.writeFile(path.join(target, "main.js"), fixtureMain([["bench", files, setup]])
      .replace("render(cx) { return this.impl.render(cx); }", `render(cx) { if (!this.benched) { this.benched = true; this.label = ${JSON.stringify(label)}; ${bench(tick)} } return div(); }`));
    try {
      const r = spawnSync("herdr-app", ["check", target], { encoding: "utf8" });
      const all = `${r.stdout}\n${r.stderr}`.split("\n");
      if (process.env.DEBUG) process.stdout.write(`${r.stdout}\n${r.stderr}`.slice(0, 2000));
      process.stdout.write(`${all.filter((l) => /  ms /.test(l)).join("\n") || `${label}: ${all.filter((l) => /interrupted|^    at/.test(l)).slice(0, 3).join(" ")}`}\n`);
    } catch (e) { process.stdout.write(`${label}: ${String(e.stdout ?? "").split("\n").filter((l) => /  ms |interrupted/.test(l)).join(" ")} ${String(e.stderr ?? "").split("\n").filter((l) => /interrupted|^    at/.test(l)).slice(0, 3).join(" ")}\n`); }
  }
} catch (e) { process.stdout.write(String(e.stdout ?? "") + String(e.stderr ?? e)); }
finally { await fs.rm(target, { recursive: true, force: true }); }
