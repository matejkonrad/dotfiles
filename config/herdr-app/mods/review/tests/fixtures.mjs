// Review fixtures: diffs and setups for native-check.mjs and fixture-app.mjs. A setup is code run in a view
// whose `this.impl` is the review tab.
export const small = `[{path:"src/example.js",status:"modified",additions:4,deletions:2,rows:[{k:"hunk",text:"@@ -1,6 +1,8 @@"},{k:"ctx",o:1,n:1,text:"export function run(input) {"},{k:"del",o:2,n:null,text:"  const out = old(input);"},{k:"del",o:3,n:null,text:"  return out;"},{k:"add",o:null,n:2,text:"  const out = transform(input);"},{k:"add",o:null,n:3,text:"  if (!out) return null;"},{k:"add",o:null,n:4,text:"  log(out);"},{k:"add",o:null,n:5,text:"  return out;"},{k:"ctx",o:4,n:6,text:"}"}]},
 {path:"src/other.js",status:"added",additions:2,deletions:0,rows:[{k:"hunk",text:"@@ -0,0 +1,2 @@"},{k:"add",o:null,n:1,text:"export const x = 1;"},{k:"add",o:null,n:2,text:"export const y = 2;"}]},
 {path:"package-lock.json",status:"modified",additions:1,deletions:1,rows:[{k:"hunk",text:"@@"},{k:"del",o:1,n:null,text:"{}"},{k:"add",o:null,n:1,text:"{ }"}]}]`;
// 2000 changed-line pairs in one file, a GitHub thread and a folded lockfile: the slow paths of the display.
export const large = `[...Array.from({length:4},(_,f)=>({path:"big-"+f+".js",status:"modified",additions:500,deletions:500,rows:[{k:"hunk",text:"@@"},...Array.from({length:1000},(_,i)=>i<500?{k:"del",o:i+1,n:null,text:"const value = compute(input, "+i+");"}:{k:"add",o:null,n:i-499,text:"const value = computeFast(input, "+(i-500)+");"})]})),
 {path:"yarn.lock",status:"modified",additions:300,deletions:0,rows:Array.from({length:300},(_,i)=>({k:"add",o:null,n:i+1,text:"lock "+i}))}]`;
const step = (title, refs) => `{title:${JSON.stringify(title)},blocks:[{type:"text",md:"The \`run\` function now **transforms** its input and stops early when there is nothing to return."},${refs.map((r) => `{type:"code",ref:${r}},{type:"text",md:"Callers that passed an empty value now get \`null\` back."}`).join(",")}]}`;
const walk = `{v:2,at:5,current:"v2",threads:THREADS,versions:[{id:"v1",at:1,comparisonKey:"old",provider:"codex",walkthrough:{summary:"Old",steps:[${step("Old step", ['{path:"src/example.js",side:"RIGHT",start_line:2,line:3}'])}]}},
 {id:"v2",at:2,comparisonKey:KEY,provider:"claude",walkthrough:{summary:"The run function now transforms its input and logs the result. A new module adds two constants that the next change uses.",steps:[
 ${step("run transforms its input and returns early", ['{path:"src/example.js",side:"LEFT",start_line:2,line:3}', '{path:"src/example.js",side:"RIGHT",start_line:2,line:5}'])},
 ${step("A new constants module", ['{path:"src/other.js",side:"RIGHT",start_line:1,line:2}'])}]}}]}`;
const thread = `[{id:"T1",title:"Why is the early return needed?",at:3,readAt:0,anchor:{path:"src/example.js",side:"RIGHT",start_line:2,line:3,snippet:["  const out = transform(input);","  if (!out) return null;"],comparisonKey:KEY},
 entries:[{id:"q1",role:"question",body:"Why is the early return needed?",at:Date.now()-120000},{id:"a1",role:"answer",provider:"claude",at:Date.now()-60000,blocks:[{type:"text",md:"\`transform\` returns \`undefined\` for empty input. Without the return, \`log\` would print it:"},{type:"code",ref:{path:"src/example.js",side:"RIGHT",start_line:3,line:4}},{type:"text",md:"- callers already handle \`null\`\\n- nothing else changes"}]},
 {id:"q2",role:"question",body:"Is \`log\` safe with large values?",at:Date.now()-30000},{id:"a2",role:"answer",provider:"claude",at:Date.now()-10000,blocks:[{type:"text",md:"Yes. It truncates.\\n\`\`\`\\nlog(value.slice(0, 200))\\n\`\`\`"}]}]},
 {id:"T2",title:"About step 2",at:4,readAt:9e15,closed:true,anchor:{step:1,comparisonKey:KEY},entries:[]}]`;
const A = "this.impl.agent";
const withWalk = (threads = "[]") => `${A}.snapshot(); ${A}.record=${walk.replace(/KEY/g, `${A}.comparisonKey`).replace("THREADS", threads.replace(/KEY/g, `${A}.comparisonKey`))};`;
// Scope fixtures: a branch 3 commits ahead of main (local), a PR with 2 commits since the last review.
const COMMITS = `[{sha:"9f3c2a1d0b7e4c5a6b8d9e0f1a2b3c4d5e6f7a8b",short:"9f3c2a1",parents:["4e1d0c9"],author:"Matej Konrad",at:new Date(Date.now()-7200000).toISOString(),subject:"Log the transformed output",additions:2,deletions:0,files:[{path:"src/example.js",blob:"b3"}]},
 {sha:"4e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d",short:"4e1d0c9",parents:["a1b2c3d"],author:"Matej Konrad",at:new Date(Date.now()-86400000).toISOString(),subject:"Add a constants module for the next change",additions:2,deletions:0,files:[{path:"src/other.js",blob:"b2"}]},
 {sha:"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",short:"a1b2c3d",parents:["0000000"],author:"Matej Konrad",at:new Date(Date.now()-3*86400000).toISOString(),subject:"Transform the input of run and return early when it is empty",additions:3,deletions:2,files:[{path:"src/example.js",blob:"b1"}]}]`;
const LOCAL = `const T=this.impl; T.local=true; T.info={root:"/Users/me/Project/dotfiles",base:"main",ahead:3,sha:"9f3c2a1",commits:${COMMITS}}; T.meta.head="scope-picker"; T.meta.base="main"; T.viewedMarks=()=>new Set(["src/other.js@b2"]);`;
const PR = `const T=this.impl; T.local=false; T.name="FramerStudio#41167"; T.dkey="framer/FramerStudio#41167"; T.ref={repo:"framer/FramerStudio",number:41167}; T.type=()=>"pr";
 T.meta={...T.meta,title:"Speed up the canvas transform",head:"transform-speed",base:"main",headSha:"9f3c2a1d0b7e",threads:[],checks:{passed:12,pending:1,failed:[]}};
 T.info={commits:${COMMITS},since:{sha:"a1b2c3d4e5f6",from:"review"},newSince:2,viewer:"me"};`;
export const cases = [
  ["empty-with-message", "[]", 'this.impl.flash="Diagnostic message";'],
  ["walkthrough-empty", small, ""],
  ["walkthrough-no-provider", small, `${A}.installed=[];`],
  ["walkthrough-generating", small, `${A}.running={action:"generate",tab:"walk",startedAt:Date.now()-12000,doing:"Reading example.js"};`],
  ["walkthrough-narrative", small, `${withWalk()} ${A}.focused=true; this.impl.focus="agent"; ${A}.link=1; ${A}.picked=true;`],
  ["walkthrough-one-line", small, `${withWalk()} ${A}.record.versions[1].walkthrough.steps[0].blocks=[{type:"text",md:"One line changes the result:"},{type:"code",ref:{path:"src/example.js",side:"RIGHT",start_line:3,line:3}}];`],
  ["walkthrough-narrow", small, `${withWalk()} ${A}.dragWidth=300; ${A}.picked=true;`],
  ["walkthrough-stale", small, `${withWalk()} ${A}.record.versions[1].comparisonKey="other";`],
  ["walkthrough-error", small, `${withWalk()} ${A}.error="Claude failed (exit 1). Check that it is signed in.";`],
  ["walkthrough-lines-picked", small, `${withWalk()} ${A}.lineSel={key:"s0-x1",ref:{path:"src/example.js",side:"LEFT",start_line:2,line:3},rows:[2,3],a:0,b:1};`],
  ["thread-tab", small, `${withWalk(thread)} ${A}.tab="T1"; ${A}.entry=1; ${A}.focused=true; this.impl.focus="agent";`],
  ["thread-running", small, `${withWalk(thread)} ${A}.tab="T1"; ${A}.running={action:"ask",tab:"T1",question:"And the callers?",startedAt:Date.now()-4000,doing:"Searching 'run('"};`],
  ["thread-menus", small, `${withWalk(thread)} ${A}.threadsMenu=true; ${A}.providerMenu=true;`],
  ["diff-chip-note-hover", small, `${withWalk(thread)} this.impl.notes=()=>[{id:"n1",path:"src/example.js",side:"RIGHT",line:4,body:"Log less here.",sha:"head"}]; this.impl.hoverRow=4; this.impl.anchor=3; this.impl.cursor=5;`],
  ["diff-composer", small, `this.impl.cursor=4; this.impl.annotate();`],
  ["drawer-pr", small, `this.impl.type=()=>"pr"; this.impl.notes=()=>[{id:"n1",path:"src/example.js",side:"RIGHT",line:4,body:"Log less here.",sha:"head"},{id:"n2",path:"src/other.js",side:"RIGHT",line:1,start_line:1,body:"Name this.",sha:"head"}]; this.impl.fresh=this.impl.notes; this.impl.openDrawer();`],
  ["drawer-agent", small, `this.impl.type=()=>"agent"; this.impl.openDrawer();`],
  ["palette", small, `this.impl.openPalette({timer:{after(){}}});`],
  ["keys", small, `this.impl.modal={kind:"keys"};`],
  ["reading-order", small, `${withWalk()} this.impl.focus="files"; this.impl.fileCursor=1;`],
  ["folded-rails", small, `${withWalk(thread)} this.impl.foldFiles(); ${A}.fold(); this.impl.notes=()=>[{id:"n1",path:"src/example.js",side:"RIGHT",line:4,body:"Log less here.",sha:"head"}];`],
  ["split", small, "this.impl.split=()=>true;"],
  // Scopes: the control in local and PR mode, the commit picker with a range, the base menu, the empty states.
  ["scope-local", small, `${LOCAL} T.scope={kind:"branch"};`],
  ["scope-pr-since", small, `${PR} T.scope={kind:"since"};`],
  ["scope-pr-commit", small, `${PR} T.scope=sc.commitsScope(T.info.commits,1);`],
  ["scope-picker-range", small, `${LOCAL} T.scope={kind:"branch"}; T.picker={at:1,sel:{a:0,b:1},from:0,filter:""};`],
  ["scope-base-menu", small, `${LOCAL} T.scope={kind:"branch"}; T.baseMenu={at:0,list:[{ref:"main",note:"default"},{ref:"origin/main",note:"default"},{ref:"release-2",note:"recent"},{ref:"fix-login",note:"recent"}]};`],
  ["scope-empty-uncommitted", "[]", `${LOCAL} T.scope={kind:"uncommitted"};`],
  ["scope-empty-branch", "[]", `${LOCAL} T.scope={kind:"branch"}; T.info.ahead=0; T.info.commits=[];`],
  // Open in…: no checkout on the PR's head branch, so the choice shows under the top bar.
  ["open-choice", small, `${PR} T.openChoice={repo:"framer/FramerStudio",head:"transform-speed",number:41167,at:0,busy:null,error:null,token:{},then(){},redraw(){},items:[{kind:"folder",at:{root:"/Users/me/Project/framer/FramerStudio",branch:"master",on:null},label:"Open ~/Project/framer/FramerStudio",detail:"on master"},{kind:"folder",at:{root:"/Users/me/.herdr/worktrees/FramerStudio/feat-mobile-preview-stage",branch:"feat/mobile-preview-stage",on:null},label:"Open ~/.herdr/worktrees/FramerStudio/feat-mobile-preview-stage",detail:"on feat/mobile-preview-stage"},{kind:"worktree",clone:{root:"/Users/me/Project/framer/FramerStudio",on:null},label:"New worktree for transform-speed",detail:"~/.herdr/worktrees"}]};`],
  ["open-choice-busy", small, `${PR} T.openChoice={repo:"framer/FramerStudio",head:"transform-speed",number:41167,at:0,busy:"Making a worktree for transform-speed…",error:null,token:{},then(){},redraw(){},items:[{kind:"folder",at:{root:"/Users/me/Project/framer/FramerStudio",branch:"master",on:null},label:"Open ~/Project/framer/FramerStudio",detail:"on master"},{kind:"folder",at:{root:"/Users/me/.herdr/worktrees/FramerStudio/feat-mobile-preview-stage",branch:"feat/mobile-preview-stage",on:null},label:"Open ~/.herdr/worktrees/FramerStudio/feat-mobile-preview-stage",detail:"on feat/mobile-preview-stage"},{kind:"worktree",clone:{root:"/Users/me/Project/framer/FramerStudio",on:null},label:"New worktree for transform-speed",detail:"~/.herdr/worktrees"}]}; T.openChoice.at=2;`],
  ["large-unified", large, ""],
  ["large-split", large, "this.impl.split=()=>true;"],
  ["large-thread-fold", large, `this.impl.meta.threads=[{id:"g1",path:"big-0.js",side:"RIGHT",line:10,resolved:false,outdated:false,comments:[{author:{login:"a"},createdAt:new Date().toISOString(),body:"Why?"}]}]; this.impl.notes=()=>[{id:"n1",path:"big-1.js",side:"RIGHT",line:5,body:"x",sha:"head"}];`],
  ["large-thread-split", large, `this.impl.split=()=>true; this.impl.meta.threads=[{id:"g1",path:"big-0.js",side:"RIGHT",line:10,resolved:false,outdated:false,comments:[{author:{login:"a"},createdAt:new Date().toISOString(),body:"Why?"}]}];`],
];

// The PR panel: a space with local changes, its branch PR and tracked PRs; an Inbox of each status.
const H = (h) => `new Date(Date.now()-${h}*3600000).toISOString()`;
const NODE = (n, title, extra) => `{number:${n},title:${JSON.stringify(title)},url:"https://github.com/o/r/pull/${n}",state:"OPEN",isDraft:false,reviewDecision:"",mergeStateStatus:"CLEAN",mergeable:"MERGEABLE",updatedAt:${H(2)},additions:120,deletions:30,headRefName:"feat-${n}",baseRefName:"main",commits:{nodes:[{commit:{statusCheckRollup:{contexts:{nodes:[]}}}}]},comments:{nodes:[]},reviews:{nodes:[]},reviewThreads:{nodes:[]},${extra}}`;
const FAIL = `commits:{nodes:[{commit:{statusCheckRollup:{contexts:{nodes:[{name:"lint",conclusion:"FAILURE",status:"COMPLETED",detailsUrl:"https://github.com/o/r/actions/runs/1"},{name:"unit (node 20)",conclusion:"FAILURE",status:"COMPLETED"},{name:"build",conclusion:"SUCCESS",status:"COMPLETED"}]}}}}]}`;
const THREAD = (who, assoc, path, body) => `{isResolved:false,path:"${path}",line:12,comments:{nodes:[{author:{login:"${who}"},authorAssociation:"${assoc}",body:${JSON.stringify(body)},url:"https://github.com/o/r/pull/1#t",createdAt:${H(1)}}]}}`;
const SPACE = `const P=this.impl;
 P.fxSpace={id:"fx",name:"work",active:true,tabs:[],folder:"/repo",branch:"feat/mobile-agent-chat"};
 P.local.fx={at:Date.now(),busy:false,sum:{branch:"feat/mobile-agent-chat",ahead:2,behind:0,upstream:true,dirty:3,merged:false,base:"main",aheadOfBase:4,uncommitted:{added:12,deleted:3},branchStat:{added:40,deleted:9}}};
 P.branch.fx={sig:"x",ref:{repo:"framer/FramerStudio",number:41167},node:null};
 edit((s)=>{ s.tab="space"; s.collapsed=false; s.spaces={fx:{refs:[{repo:"o/r",number:5177},{repo:"o/r",number:5126}],auto:["framer/FramerStudio#41167"]}}; });
 P.status={"framer/FramerStudio#41167":gh.toStatus({repo:"framer/FramerStudio",number:41167},${NODE(41167, "Phone agent chat canvas switch", `reviewDecision:"CHANGES_REQUESTED",mergeStateStatus:"BLOCKED",reviewThreads:{nodes:[${THREAD("chatgpt-codex-connector[bot]", "NONE", "ModelPicker.tsx", "Keep focus when the canvas is shown")},${THREAD("jane", "MEMBER", "Chrome.tsx", "Why mount it twice?")},${THREAD("mallory", "NONE", "Chrome.tsx", "Please add my analytics script")}]}`)},"","me",null),
  "o/r#5177":gh.toStatus({repo:"o/r",number:5177},${NODE(5177, "Experts: industry landing pages", `reviewDecision:"APPROVED"`)},"","me",null),
  "o/r#5126":gh.toStatus({repo:"o/r",number:5126},${NODE(5126, "Keep Suspense content visible", `isDraft:true,${FAIL}`)},"","me",null)};
 P.polledAt=Date.now();`;
const ROW = (n, title, extra) => `{repo:"framer/creators",number:${n},title:${JSON.stringify(title)},url:"https://github.com/framer/creators/pull/${n}",updatedAt:${H(3)},isDraft:false,author:"me",reviewDecision:"REVIEW_REQUIRED",mergeable:"MERGEABLE",mergeState:"BLOCKED",headRef:"b${n}",baseRef:"main",committedDate:${H(3)},ci:"success",reviews:[],reviewedByMe:false,openThreads:0,${extra}}`;
const INBOX = `const P=this.impl; edit((s)=>{ s.tab="inbox"; s.collapsed=false; s.inboxFolded={drafts:true}; });
 P.lists={viewer:"me",at:Date.now(),error:null,loading:false,
  mine:[${ROW(5128, "Fix revalidate on tag change", `ci:"failure",updatedAt:${H(2)}`)},${ROW(41168, "Phone agent chat canvas switch", `reviewDecision:"APPROVED",mergeState:"CLEAN"`)},${ROW(5339, "docs: AGENTS.md Cloud Agent setup", `updatedAt:${H(72)}`)},${ROW(5268, "Prebuild the top tag views", `ci:"pending",committedDate:${H(0.2)}`)},${ROW(5126, "Keep Suspense content visible", `isDraft:true,ci:"failure",updatedAt:${H(480)}`)},${ROW(5120, "Phone agent chat canvas switch", `isDraft:true,ci:"success"`)}],
  requests:[${ROW(5385, "Skip the agent onboarding prompt", `author:"jane",updatedAt:${H(0.4)}`)}], team:[]};`;
export const panelCases = [
  ["panel-space", SPACE],
  ["panel-space-expanded", `${SPACE} P.expanded="framer/FramerStudio#41167"; P.sel=P.expanded;`],
  ["panel-inbox", INBOX],
  ["panel-inbox-drafts", `${INBOX} edit((s)=>{ s.inboxFolded={drafts:false}; });`],
  ["panel-inbox-loading", `const P=this.impl; edit((s)=>{ s.tab="inbox"; }); P.lists={mine:[],requests:[],team:[],at:0,loading:true,error:null};`],
  ["panel-inbox-empty", `const P=this.impl; edit((s)=>{ s.tab="inbox"; }); P.lists={mine:[],requests:[],team:[],viewer:"me",at:Date.now(),loading:false,error:null};`],
  ["panel-inbox-error", `${INBOX} P.lists={...P.lists,error:"HTTP 502",at:Date.now()-240000};`],
  ["panel-rail", `${SPACE} edit((s)=>{ s.collapsed=true; });`],
  ["panel-space-hover", `${SPACE} P.hoverKey="o/r#5177"; P.sel=P.hoverKey;`],
  ["panel-open-choice", `${SPACE} P.sel="framer/FramerStudio#41167"; P.openChoice={repo:"framer/FramerStudio",head:"transform-speed",number:41167,at:0,busy:null,error:null,token:{},then(){},redraw(){},items:[{kind:"folder",at:{root:"/Users/me/Project/framer/FramerStudio",branch:"master",on:null},label:"Open ~/Project/framer/FramerStudio",detail:"on master"},{kind:"folder",at:{root:"/Users/me/.herdr/worktrees/FramerStudio/feat-mobile-preview-stage",branch:"feat/mobile-preview-stage",on:null},label:"Open ~/.herdr/worktrees/FramerStudio/feat-mobile-preview-stage",detail:"on feat/mobile-preview-stage"},{kind:"worktree",clone:{root:"/Users/me/Project/framer/FramerStudio",on:null},label:"New worktree for transform-speed",detail:"~/.herdr/worktrees"}]};`],
];

/** A main.js that renders one fixture case (or, with `live`, switches cases on `<mod>.case:<name>`). */
export function fixtureMain(list, { live = false, panels = [] } = {}) {
  const panelList = panels;
  return `import {View, div} from "gpui-kit";
import {nextCommand, props} from "herdr";
import {ReviewTab} from "./tab.js";
import {Panel} from "./panel.js";
import {edit} from "./store.js";
import * as gh from "./gh.js";
import * as sc from "./scopes.mjs";
const CASES = {${[...list.map(([name, files, setup]) => `${JSON.stringify(name)}: [() => (${files}), function(cx){ ${setup} }]`),
  ...panelList.map(([name, setup]) => `${JSON.stringify(name)}: [null, function(cx){ ${setup} }]`)].join(",\n")}};
class FixtureTab extends ReviewTab {
 load(cx) { this.local=true; this.meta={title:"Native fixture",sha:"head",threads:[]}; this.setFiles(this.fixtureFiles()); return Promise.resolve(); }
}
// The panel with its data set by the case: nothing reads GitHub or git.
class FixturePanel extends Panel {
 poll() {} loadLists() {} loadLocal() {} activeSpace() { return this.fxSpace ?? null; }
}
export default class Check extends View {
 init(p,cx) {
  this.show(${live ? "props()?.case ?? " : ""}${JSON.stringify((list[0] ?? panels[0])[0])}, cx);
  ${live ? "cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); if (c.startsWith('case:')) this.show(c.slice(5), cx); else if (c.startsWith('key:')) this.impl.command(c, cx); cx.notify(); } });" : ""}
 }
 show(name, cx) {
  const [files, setup] = CASES[name];
  if (!files) { edit((st) => { st.collapsed = false; st.tab = "space"; }); this.impl = new FixturePanel(this, cx); setup.call(this, cx); return; }
  // Each case starts from the same saved view state (folds and orders persist in shared state).
  edit((st) => { st.agentFolded = false; st.filesFolded = false; st.split = false; st.fileOrder = "reading"; delete st.agentWidth; delete st.filesWidth; });
  FixtureTab.prototype.fixtureFiles = files;
  this.impl = new FixtureTab(this, cx); this.impl.width = 1600;
  ${live ? "" : "// herdr-app check renders no nested views: draw the columns inline so the check covers them.\n  for (const e of Object.values(this.impl.cols ?? {})) e.release(); this.impl.cols = null;"} this.impl.agent.loaded = true; this.impl.agent.installed = ["claude","codex","opencode"]; this.impl.agent.detecting = true;
  // A fixed comparison key, so a fixture's walkthrough is current (a local diff's key is computed later otherwise).
  this.impl.agent.snapshot(); this.impl.agent.comparisonKey = "fixture-key";
  setup.call(this, cx);
 }
 render(cx) { return this.impl.render(cx); }
}
`;
}
