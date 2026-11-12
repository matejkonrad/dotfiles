// No UI dependencies: comparison identity, validated code excerpts, walkthrough versions and threads.
export function comparison(meta, files, local) {
  return {
    local, sha: meta?.sha ?? null, baseSha: meta?.baseSha ?? null,
    root: meta?.root ?? null, scope: meta?.scope ?? null, from: meta?.from ?? null,
    files: files.map((f) => ({ path: f.path, previous: f.previous ?? null, status: f.status,
      rows: f.rows.map((r) => ({ k: r.k, o: r.o ?? null, n: r.n ?? null, text: r.text ?? "", count: r.count ?? null })) })),
  };
}

export const sameComparison = (a, b) => Boolean(a && b) && (a === b || JSON.stringify(a) === JSON.stringify(b));

export function validReference(ref, files) {
  if (!ref || !["LEFT", "RIGHT"].includes(ref.side) || !Number.isInteger(ref.line) || ref.line < 1) return false;
  const f = files.find((f) => f.path === ref.path);
  return Boolean(f?.rows.some((r) => ref.side === "LEFT"
    ? r.k !== "add" && r.o === ref.line : r.k !== "del" && r.n === ref.line));
}


// ---- code excerpts -----------------------------------------------------------------------------
// A walkthrough step or an answer is a list of blocks: {type: "text", md} or {type: "code", ref}. A code ref is
// a line range on one side of one file, {path, side, start_line, line}; the host shows the real diff lines.
export const MAX_EXCERPT = 20;

/** The file rows of an excerpt (indexes into file.rows), or null when the range is not in the diff. */
export function excerptRows(ref, files) {
  const f = files.find((x) => x.path === ref?.path);
  if (!f) return null;
  const on = (r, line) => (ref.side === "LEFT" ? r.k !== "add" && r.o === line : r.k !== "del" && r.n === line);
  const end = f.rows.findIndex((r) => on(r, ref.line));
  if (end < 0) return null;
  let start = ref.start_line != null ? f.rows.findIndex((r) => on(r, ref.start_line)) : end;
  if (start < 0 || start > end) start = end;
  // One hunk only: an excerpt never crosses a hunk header or a fold.
  for (let i = end; i > start; i--) if (!["add", "del", "ctx"].includes(f.rows[i].k)) { start = i + 1; break; }
  if (end - start + 1 > MAX_EXCERPT) start = end - MAX_EXCERPT + 1;
  const out = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

const isCode = (r) => r && (r.k === "add" || r.k === "del" || r.k === "ctx");
const indentOf = (text) => (/^\s*/.exec(String(text ?? "").replace(/\t/g, "    "))[0].length);
const blank = (text) => !String(text ?? "").trim();

/** Which file version holds a side's unchanged lines: {rev, path}; rev "worktree" is the local working tree. */
export function sideSource(side, file, meta, local) {
  const path = side === "LEFT" ? file.previous ?? file.path : file.path;
  if (local) return { rev: side === "LEFT" ? meta?.from ?? "HEAD" : "worktree", path };
  const rev = side === "LEFT" ? meta?.baseSha : meta?.sha;
  return rev ? { rev, path } : null;
}

/**
 * What an excerpt shows: the referenced lines with context, so a one-line ref still reads. Items are
 * {kind: "row", i, hot} (a diff row of file.rows), {kind: "file", n, text} (an unchanged line read from the file,
 * outside the hunk) and {kind: "gap"} (lines skipped between two refs). Context: up to `ctx` lines around the
 * refs, the whole hunk when it is small, back to the enclosing header (the nearest line above with less
 * indentation), at least `min` lines; beyond the hunk from `lines(side)` (the file's lines, 1-based) when given.
 * `cap` bounds what shows at first; `more` is how many lines a "Show more" adds.
 */
export function excerptPlan(refs, file, { lines = null, ctx = 3, min = 6, cap = 16, expanded = false } = {}) {
  const side = refs[0]?.side;
  const rows = file.rows;
  const hot = new Set();
  for (const ref of refs) for (const i of excerptRows(ref, [file]) ?? []) hot.add(i);
  if (!hot.size) return null;
  const num = (r) => (side === "LEFT" ? (r.k === "add" ? null : r.o) : (r.k === "del" ? null : r.n));
  // Hot rows grouped by hunk, in order.
  const sorted = [...hot].sort((a, b) => a - b);
  const groups = [];
  for (const i of sorted) {
    const g = groups.at(-1);
    let same = g && i <= g.he;
    if (!g || !same) {
      let hs = i, he = i;
      // The hunk around the refs, looked for only as far as an excerpt can reach.
      while (hs > 0 && isCode(rows[hs - 1]) && i - hs < cap * 2) hs--;
      while (he < rows.length - 1 && isCode(rows[he + 1]) && he - i < cap * 2) he++;
      if (g && g.hs === hs) same = true;
      else { groups.push({ hs, he, a: i, b: i }); continue; }
    }
    g.b = Math.max(g.b, i);
  }
  const items = [];
  groups.forEach((g, gi) => {
    const { hs, he, a, b } = g;
    let lo = Math.max(hs, a - ctx), hi = Math.min(he, b + ctx);
    if (he - hs + 1 <= cap) { lo = hs; hi = he; }
    // The enclosing header: the nearest line above with less indentation (a function, an if), within the cap.
    const want = indentOf(rows[a].text);
    let header = false;
    for (let i = a - 1; i >= hs && b - i + 1 <= cap; i--) {
      if (!blank(rows[i].text) && indentOf(rows[i].text) < want) { lo = Math.min(lo, i); header = true; break; }
    }
    if (!want) header = true;
    while (hi - lo + 1 < min && (lo > hs || hi < he)) { if (lo > hs) lo--; if (hi - lo + 1 < min && hi < he) hi++; }
    const block = [];
    for (let i = lo; i <= hi; i++) block.push({ kind: "row", i, hot: hot.has(i) });
    // Beyond the hunk: unchanged lines from the file itself.
    const L = lines?.(side);
    if (L) {
      const firstNum = block.map((x) => num(rows[x.i])).find((n) => n != null);
      if (lo === hs && firstNum > 1) {
        const need = Math.max(0, ctx - (a - lo));
        const room = cap - (hi - lo + 1);
        let from = firstNum - need;
        if (!header) {
          for (let n = firstNum - 1; n >= 1 && firstNum - n <= room; n--) {
            if (!blank(L[n - 1]) && indentOf(L[n - 1]) < want) { from = Math.min(from, n); break; }
          }
        }
        from = Math.max(1, from, firstNum - room);
        const above = [];
        for (let n = from; n < firstNum; n++) if (L[n - 1] !== undefined) above.push({ kind: "file", n, text: L[n - 1] });
        block.unshift(...above);
      }
      const lastNum = [...block].reverse().map((x) => (x.kind === "row" ? num(rows[x.i]) : x.n)).find((n) => n != null);
      if (hi === he && lastNum != null) {
        const need = Math.max(0, ctx - (hi - b));
        for (let n = lastNum + 1; n <= lastNum + need && n <= L.length; n++) block.push({ kind: "file", n, text: L[n - 1] });
      }
    }
    if (gi > 0) items.push({ kind: "gap" });
    items.push(...block);
  });
  const total = items.length;
  if (expanded || total <= cap) return { side, items, more: 0 };
  const firstHot = items.findIndex((x) => x.hot);
  const start = Math.max(0, Math.min(firstHot - ctx, total - cap));
  return { side, items: items.slice(start, start + cap), more: total - cap };
}

/** Consecutive code blocks on the same file and side become one excerpt (refs: [...]). */
export function mergeCodeBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    const last = out.at(-1);
    if (b.type === "code" && last?.type === "code" && last.refs[0].path === b.ref.path && last.refs[0].side === b.ref.side) last.refs.push(b.ref);
    else out.push(b.type === "code" ? { ...b, refs: [b.ref] } : b);
  }
  return out;
}

/** A ref as the model may send it (a single line, a reversed range, a start outside the diff), made exact. */
export function normalizeRef(ref, files) {
  if (!ref || !["LEFT", "RIGHT"].includes(ref.side)) return null;
  const line = Number.isInteger(ref.line) ? ref.line : null;
  let start = Number.isInteger(ref.start_line) ? ref.start_line : line;
  if (line == null) return null;
  const valid = (n) => validReference({ path: ref.path, side: ref.side, line: n }, files);
  let end = line;
  if (start > end) [start, end] = [end, start];
  if (!valid(end) && valid(start)) end = start;
  if (!valid(end)) return null;
  if (!valid(start)) start = end;
  return { path: ref.path, side: ref.side, start_line: start, line: end };
}

/** Blocks with every code ref checked against the diff. Throws on a ref outside the diff. */
export function validateBlocks(blocks, files, { needCode = false } = {}) {
  if (!Array.isArray(blocks)) throw new Error("The agent returned no answer blocks.");
  const out = [];
  for (const b of blocks) {
    if (b?.type === "code") {
      const ref = normalizeRef(b.ref, files);
      if (!ref) throw new Error(`Code reference is outside this diff: ${b.ref?.path}:${b.ref?.line} (${b.ref?.side}). Try again.`);
      out.push({ type: "code", ref });
    } else if (b?.type === "text" && String(b.md ?? "").trim()) out.push({ type: "text", md: String(b.md).trim() });
  }
  if (needCode && !out.some((b) => b.type === "code")) throw new Error("A walkthrough step has no code excerpt.");
  return out;
}

/** Older steps ({body, references}) as blocks: the prose, then one excerpt per reference. */
export function stepBlocks(step) {
  if (Array.isArray(step?.blocks)) return step.blocks;
  return [{ type: "text", md: step?.body ?? "" }, ...(step?.references ?? []).map((r) => ({ type: "code", ref: { start_line: r.line, ...r } }))];
}

export function validateWalkthrough(value, files) {
  if (!value || typeof value.summary !== "string" || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 8) {
    throw new Error("The agent returned an incomplete walkthrough. Try generating again.");
  }
  return { summary: value.summary, steps: value.steps.map((step) => {
    if (!step?.title) throw new Error("A walkthrough step has no title.");
    return { title: String(step.title), blocks: validateBlocks(stepBlocks(step), files, { needCode: true }) };
  }) };
}

/** Every code ref of a step, in order. */
export const stepRefs = (step) => stepBlocks(step).filter((b) => b.type === "code").map((b) => b.ref);

// ---- threads -------------------------------------------------------------------------------------
// A thread: {id, title, at, anchor, entries: [{id, role: "question" | "answer", body | blocks, at, provider}], readAt}.
// An anchor: {path, side, start_line, line, snippet: [texts], comparisonKey, step?} (step: a walkthrough step's thread).
export const MAX_THREADS = 40;
export const MAX_ENTRIES = 40;
export const newId = (p = "t") => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A short title from the question: its first sentence, at most 48 characters. */
export function threadTitle(question) {
  const first = String(question ?? "").replace(/\s+/g, " ").trim().split(/(?<=[?.!])\s/)[0] ?? "";
  if (!first) return "Question";
  return first.length > 48 ? `${first.slice(0, 47).replace(/\s+\S*$/, "")}…` : first;
}

/** The anchor's lines as they are in this diff now (texts), or null when its lines are gone. */
export function anchorTexts(anchor, files) {
  if (!anchor?.path) return null;
  const f = files.find((x) => x.path === anchor.path);
  const rows = excerptRows(anchor, files);
  return rows && f ? rows.map((i) => f.rows[i].text ?? "") : null;
}

/** Stale: the diff moved on (another comparison) and the anchored lines changed or are gone. */
export function anchorStale(anchor, files, comparisonKey) {
  if (!anchor?.path || anchor.comparisonKey === comparisonKey) return false;
  const now = anchorTexts(anchor, files);
  return !now || JSON.stringify(now) !== JSON.stringify(anchor.snippet ?? []);
}

/** Which thread entries go to the agent: all recent ones up to a budget; the number left out is stated. */
export function recentEntries(entries, budget = 24000) {
  let size = 0;
  const out = [];
  for (const e of [...entries].reverse()) {
    const n = JSON.stringify(e).length;
    if (size + n > budget && out.length) break;
    out.unshift(e);
    size += n;
  }
  return { omitted: entries.length - out.length, entries: out };
}

/** The plain text of an answer (for a review note): the prose, with each excerpt as `path:lines`. */
export function blocksText(blocks) {
  return (blocks ?? []).map((b) => b.type === "code" ? `\`${b.ref.path}:${b.ref.start_line !== b.ref.line ? `${b.ref.start_line}-` : ""}${b.ref.line}\`` : b.md).join("\n\n");
}

// ---- records ---------------------------------------------------------------------------------------
// A review's record: {v: 2, at, versions: [{id, at, comparisonKey, provider, walkthrough}], current, threads}.
// A closed thread keeps its place (closed: true) and can be reopened. Versions are oldest first; `current` is the id shown.
export const MAX_VERSIONS = 10;

/** Any saved record (v1: one walkthrough and a chat) as a v2 record. The old chat becomes one thread. */
export function upgradeRecord(saved, keyOf = (c) => c) {
  if (!saved || typeof saved !== "object") return null;
  if (saved.v === 2) return sanitizeRecord(saved);
  const key = saved.comparisonKey ?? (saved.comparison ? keyOf(saved.comparison) : null);
  const versions = [...(saved.versions ?? []), ...(saved.walkthrough ? [{ comparisonKey: key, walkthrough: saved.walkthrough, at: saved.at }] : [])]
    .map((v, i) => ({ id: v.id ?? `v${i + 1}`, at: v.at ?? 0, comparisonKey: v.comparisonKey ?? key, provider: v.provider ?? "codex", walkthrough: v.walkthrough }));
  const threads = [];
  const messages = saved.messages ?? [];
  if (messages.length) threads.push({ id: "t-earlier", title: "Earlier conversation", at: messages[0].at ?? 0, readAt: Date.now(),
    anchor: { step: 0, comparisonKey: key },
    entries: messages.map((m) => m.role === "user" ? { id: m.id ?? newId("e"), role: "question", body: m.body, at: m.at ?? 0 }
      : { id: m.id ?? newId("e"), role: "answer", blocks: [{ type: "text", md: m.body }, ...(m.references ?? []).map((r) => ({ type: "code", ref: { start_line: r.line, ...r } }))], at: m.at ?? 0, provider: "codex" }) });
  return sanitizeRecord({ v: 2, at: saved.at ?? 0, versions, current: versions.at(-1)?.id ?? null, threads });
}

const isRef = (r) => Boolean(r) && typeof r.path === "string" && (r.side === "LEFT" || r.side === "RIGHT") && Number.isInteger(r.line);
const cleanBlocks = (blocks) => (Array.isArray(blocks) ? blocks : [])
  .filter((b) => b && (b.type === "code" ? isRef(b.ref) : b.type === "text" && typeof (b.md ?? b.body ?? "") === "string"));

/**
 * A record as the panel can draw it: versions, steps, threads and entries that do not have the shape they
 * need (an old build, a hand edit, a cut-off write) are left out, never thrown on in render.
 */
export function sanitizeRecord(r) {
  if (!r || typeof r !== "object") return null;
  const versions = (Array.isArray(r.versions) ? r.versions : [])
    .filter((v) => v && typeof v.id === "string" && v.walkthrough && Array.isArray(v.walkthrough.steps ?? null))
    .map((v) => ({ ...v, walkthrough: { ...v.walkthrough, summary: String(v.walkthrough.summary ?? ""),
      steps: v.walkthrough.steps.filter((st) => st && typeof st === "object").map((st) => ({ ...st, title: String(st.title ?? ""), blocks: cleanBlocks(stepBlocks(st)) })) } }));
  const threads = (Array.isArray(r.threads) ? r.threads : [])
    .filter((t) => t && typeof t.id === "string" && t.anchor && typeof t.anchor === "object" && Array.isArray(t.entries))
    .map((t) => ({ ...t, title: String(t.title ?? "Thread"),
      entries: t.entries.filter((e) => e && typeof e.id === "string" && (e.role === "question" ? typeof e.body === "string" : e.role === "answer"))
        .map((e) => (e.role === "answer" ? { ...e, blocks: cleanBlocks(e.blocks ?? [{ type: "text", md: e.body ?? "" }]) } : e)) }));
  return capThreads({ ...r, v: 2, versions, threads, current: typeof r.current === "string" ? r.current : null });
}

/** At most MAX_THREADS threads: the oldest closed ones go first, then the oldest. */
export function capThreads(record) {
  while (record.threads.length > MAX_THREADS) {
    const closed = record.threads.findIndex((t) => t.closed);
    record.threads.splice(closed >= 0 ? closed : 0, 1);
  }
  return record;
}

export const currentVersion = (record) => record?.versions?.find((v) => v.id === record.current) ?? record?.versions?.at(-1) ?? null;

/**
 * Two copies saved one record (two tabs, two windows): every version and thread of both, every entry of a
 * thread both have; the title, read and closed marks of the newer copy.
 */
export function mergeRecords(mine, theirs) {
  if (!theirs) return mine;
  if (!mine) return theirs;
  const newer = (mine.at ?? 0) >= (theirs.at ?? 0) ? mine : theirs;
  const byId = (lists) => { const m = new Map(); for (const list of lists) for (const x of list ?? []) if (!m.has(x.id)) m.set(x.id, x); return m; };
  const versions = [...byId([newer.versions, mine.versions, theirs.versions]).values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-MAX_VERSIONS);
  const theirsThreads = new Map((theirs.threads ?? []).map((t) => [t.id, t]));
  const mineThreads = new Map((mine.threads ?? []).map((t) => [t.id, t]));
  const ids = [...new Set([...(mine.threads ?? []), ...(theirs.threads ?? [])].map((t) => t.id))];
  const threads = ids.map((id) => {
    const a = mineThreads.get(id), b = theirsThreads.get(id);
    if (!a || !b) return a ?? b;
    const base = newer === mine ? a : b;
    const entries = [...byId([a.entries, b.entries]).values()].sort((x, y) => (x.at ?? 0) - (y.at ?? 0)).slice(-MAX_ENTRIES);
    return { ...base, entries };
  }).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-MAX_THREADS);
  return { ...newer, versions, threads };
}

/** Inline markdown of a line as runs: [{text, code?, bold?, italic?}]. Unclosed marks stay plain text. */
export function inlineRuns(line) {
  const out = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|(?<![\w_])_([^_\s][^_]*)_(?!\w)/g;
  let at = 0;
  for (const m of String(line).matchAll(re)) {
    if (m.index > at) out.push({ text: line.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], code: true });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ text: m[2] ?? m[3], bold: true });
    else out.push({ text: m[4] ?? m[5], italic: true });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  // Straight quotes become typographic ones outside code.
  for (const r of out) if (!r.code) r.text = r.text.replace(/(^|[\s(\[{])"/g, "$1“").replace(/"/g, "”").replace(/(^|[\s(\[{])'/g, "$1‘").replace(/'/g, "’");
  return out;
}

// ---- what the panel shows of threads and refs ------------------------------------------------------

const lastAnswerAt = (th) => th.entries.filter((e) => e.role === "answer").at(-1)?.at ?? 0;
export const unread = (th) => lastAnswerAt(th) > (th.readAt ?? 0);
/** "12" or "12–15". */
export const refLines = (ref) => (ref.start_line != null && ref.start_line !== ref.line ? `${ref.start_line}–${ref.line}` : `${ref.line}`);
/** One range over refs of one file and side: the first line to the last. */
export const rangeOfRefs = (refs) => ({ path: refs[0].path, side: refs[0].side,
  start_line: Math.min(...refs.map((r) => r.start_line ?? r.line)), line: Math.max(...refs.map((r) => r.line)) });
/** A step's excerpts as the panel shows them: next-to-next code blocks of one file merged, each with its refs. */
export const excerptsOf = (step) => mergeCodeBlocks(stepBlocks(step)).filter((b) => b.type === "code").map((b) => ({ ...rangeOfRefs(b.refs), refs: b.refs }));
export const refLabel = (ref) => `${ref.path.split("/").pop()}:${refLines(ref)}`;
