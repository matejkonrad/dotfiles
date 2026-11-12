// Syntax colors for diff rows: tree-sitter through a headless Neovim (hl.lua) with the user's colorscheme.
// Per file, the new side (context + added lines) and the old side (context + removed lines) are written
// as two texts, colored in one nvim run per review, and the spans go back onto their rows (`row.spans`).
// Results are kept in memory per (head sha or diff hash, path, side): moving around never runs nvim again.
import { appHome, exec } from "herdr";
import * as fs from "fs/promises";

// Files with more diff lines than this stay plain.
const MAX_LINES = 3000;
// At most this many file sides stay in memory; the oldest go first. A failed run is never kept.
const CACHE_MAX = 600;
const cache = new Map(); // `${rev}|${path}|${side}` → lines | null (null: no parser for it)
function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/** A short hash of the diff's text (the local diff's cache key), in slices: `pause` runs every 8 ms. */
export async function hashFiles(files, pause) {
  let h = 5381, n = 0, started = Date.now();
  const add = (text) => { for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; n += text.length; };
  for (const f of files) {
    add(`${f.path}\n`);
    for (let i = 0; i < f.rows.length; i++) {
      add(`${f.rows[i].text ?? ""}\n`);
      if ((i & 255) === 0 && Date.now() - started > 8) { await pause(); started = Date.now(); }
    }
  }
  return `${n.toString(36)}-${h.toString(36)}`;
}

/** The new and old side of a file as texts, and which row is which line of them. */
function sides(file, rows, start) {
  const out = { n: { lines: [], rows: [] }, o: { lines: [], rows: [] } };
  for (let i = start + 1; i < rows.length && rows[i].f === rows[start].f; i++) {
    const r = rows[i];
    if (r.k === "add" || r.k === "ctx") { out.n.rows.push(i); out.n.lines.push(r.text); }
    if (r.k === "del" || r.k === "ctx") { out.o.rows.push(i); out.o.lines.push(r.text); }
  }
  return out;
}

const asLines = (v) => (Array.isArray(v) ? v.map((l) => (Array.isArray(l) ? l : [])) : null);

/**
 * Colors every file of a review: sets `spans` (and clears `runs`) on its rows.
 * files/rows/fileStart as in tab.js; rev: the head sha or a hash of the local diff. The output is read and
 * applied in slices (`pause` between them); `stale()` true stops it (a newer diff shows).
 * Returns how many files got colors.
 */
export async function highlightAll({ files, rows, fileStart, rev, tag, pause = async () => {}, stale = () => false }) {
  let started = Date.now();
  const breathe = async () => { if (Date.now() - started > 8) { await pause(); started = Date.now(); } };
  const jobs = [];
  files.forEach((file, f) => {
    if (file.status === "removed" && !file.rows.length) return;
    if (file.rows.filter((r) => r.k !== "hunk" && r.k !== "fold" && r.k !== "meta").length > MAX_LINES) return;
    const s = sides(file, rows, fileStart[f]);
    for (const side of ["n", "o"]) {
      if (!s[side].lines.length) continue;
      jobs.push({ id: `${f}${side}`, key: `${rev}|${file.path}|${side}`, path: file.path, map: s[side].rows, lines: s[side].lines });
    }
  });
  const todo = jobs.filter((j) => !cache.has(j.key));
  if (todo.length) {
    const dir = `${appHome()}/data/review/hl`;
    await fs.mkdir(dir, { recursive: true }).catch(() => exec("mkdir", ["-p", dir]));
    const input = todo.map((j, i) => ({ id: j.id, path: `${dir}/${tag}-${i}.txt`, filename: j.path.split("/").pop() }));
    await Promise.all(todo.map((j, i) => fs.writeFile(input[i].path, j.lines.join("\n"))));
    const list = `${dir}/${tag}.json`;
    await fs.writeFile(list, JSON.stringify(input));
    try {
      const r = await exec("nvim", ["--headless", "--clean", "-l", `${appHome()}/mods/review/hl.lua`, list], { timeout: 20_000 })
        .catch(() => null);
      // One JSON line per file side, parsed one at a time. A failed run (nvim missing, a timeout, bad output)
      // leaves the cache alone: the next load tries again.
      if (r?.code === 0) {
        const byId = new Map(todo.map((j) => [j.id, j]));
        for (const line of r.stdout.split("\n")) {
          if (!line) continue;
          let one = null;
          try { one = JSON.parse(line); } catch { continue; }
          const j = byId.get(String(one?.id));
          if (j) remember(j.key, asLines(one.lines));
          await breathe();
        }
      }
    } finally {
      await Promise.all([list, ...input.map((x) => x.path)].map((p) => fs.unlink(p).catch(() => null)));
    }
  }
  let colored = 0;
  const done = new Set();
  for (const j of jobs) {
    if (stale()) return 0;
    const lines = cache.get(j.key);
    if (!lines) continue;
    await breathe();
    done.add(j.path);
    j.map.forEach((rowIndex, i) => {
      const row = rows[rowIndex];
      // A context line is on both sides: the new side's colors win.
      if (row.k === "ctx" && j.id.endsWith("o") && row.spans) return;
      row.spans = lines[i] ?? [];
      row.runs = null;
    });
  }
  colored = done.size;
  return colored;
}

// ---- legible colors on tinted rows ------------------------------------------------
// A dim syntax color (a comment) can vanish on a green or red row. A color below MIN_CONTRAST on what is
// really behind it is mixed toward the theme's foreground just enough; colors that read keep their hue.
const MIN_CONTRAST = 3.5;
const legible = new Map();
function rgba(hex) {
  const h = String(hex).replace("#", "");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}
const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
function luminance(c) {
  const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const hex = (c) => `#${c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;

/** `fg` made readable on `tint` (maybe translucent) over the theme background. */
export function readable(fg, tint, t) {
  if (!tint) return fg;
  const key = `${fg}|${tint}|${t.background}|${t.foreground}`;
  if (legible.has(key)) return legible.get(key);
  let out = fg;
  const f = rgba(fg), base = rgba(t.background), ink = rgba(t.foreground), top = rgba(tint);
  if (f && base && ink && top) {
    const bg = over(top, base);
    let c = f;
    for (let step = 1; step <= 20 && contrast(c, bg) < MIN_CONTRAST; step++) c = [0, 1, 2].map((i) => f[i] + (ink[i] - f[i]) * step / 20).concat(1);
    out = c === f ? fg : hex(c);
  }
  legible.set(key, out);
  return out;
}

/**
 * A row's text as [[text, color, emphasized], ...]: spans in byte columns, applied in order (the last one
 * wins); `row.changed` (character ranges from the word diff) marks the changed words. `tint`: the row's
 * background, so dim colors are lifted to stay readable on it.
 */
export function runsOf(row, t, tint = null) {
  const fg = t.foreground;
  const key = `${tint}|${fg}`;
  if (row.runs && row.runsKey === key) return row.runs;
  row.runsKey = key;
  const text = row.text ?? "";
  if (!text) return (row.runs = [["", fg, false]]);
  let at = null, bytes = text.length;
  if (row.spans?.length && /[^\x00-\x7f]/.test(text)) {
    at = new Array(bytes + 1);
    let b = 0;
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i);
      const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      for (let k = 0; k < n; k++) at[b + k] = i;
      b += n;
      if (cp >= 0x10000) i++;
    }
    bytes = b;
    at[bytes] = text.length;
  }
  const ch = (byte) => (at ? at[Math.min(byte, bytes)] ?? text.length : Math.min(byte, text.length));
  // Runs from the boundaries of spans and changed words: a few segments per line, not one step per character.
  const spans = (row.spans ?? []).map(([s, e, c]) => [ch(s), e < 0 ? text.length : ch(e), c]);
  const changed = row.changed ?? [];
  const cuts = [0, text.length];
  for (const [a, z] of spans) cuts.push(a, z);
  for (const [a, z] of changed) cuts.push(Math.min(a, text.length), Math.min(z, text.length));
  cuts.sort((x, y) => x - y);
  const runs = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k], z = cuts[k + 1];
    if (a === z) continue;
    let color = fg;
    // The last span that covers a segment wins.
    for (let i = spans.length - 1; i >= 0; i--) if (spans[i][0] <= a && z <= spans[i][1]) { color = spans[i][2]; break; }
    const strong = changed.some(([ca, cz]) => ca <= a && z <= cz);
    const last = runs[runs.length - 1];
    if (last && last[1] === color && last[2] === strong) last[0] += text.slice(a, z);
    else runs.push([text.slice(a, z), color, strong]);
  }
  for (const r of runs) r[1] = readable(r[1], tint, t);
  return (row.runs = runs);
}

// ---- word diff ----------------------------------------------------------------------

const TOKENS = /\w+|\s+|[^\w\s]/g;
// Lines with more tokens than this are compared whole (the LCS table is tokens²).
const MAX_TOKENS = 300;

/**
 * The changed words of a removed line and the added line paired with it: sets `changed` (character
 * ranges) on both rows. Common tokens come from a longest common subsequence of the two token lists.
 */
export function wordDiff(del, add) {
  const a = del.text?.match(TOKENS) ?? [], b = add.text?.match(TOKENS) ?? [];
  if (!a.length || !b.length || a.length > MAX_TOKENS || b.length > MAX_TOKENS) return;
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  // Barely anything in common: the whole line is the change, no word marks.
  if (dp[0][0] * 3 < Math.min(n, m)) return;
  const keepA = new Array(n).fill(false), keepB = new Array(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { keepA[i++] = true; keepB[j++] = true; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const ranges = (toks, keep) => {
    const out = [];
    let pos = 0;
    toks.forEach((tok, i) => {
      const end = pos + tok.length;
      if (!keep[i] && tok.trim()) {
        const last = out[out.length - 1];
        if (last && last[1] >= pos - 1 && /^\s*$/.test(toks[i - 1] ?? "x")) last[1] = end;
        else if (last && last[1] === pos) last[1] = end;
        else out.push([pos, end]);
      }
      pos = end;
    });
    return out;
  };
  del.changed = ranges(a, keepA);
  add.changed = ranges(b, keepB);
  del.runs = add.runs = null;
}
