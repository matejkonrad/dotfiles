#!/usr/bin/env node
// Installs the review mod from this folder: the installed mod becomes an exact copy of the source.
// The new copy is built next to it and swapped in with one rename, so Herdr's hot reload never sees a mix
// of old and new files. The replaced copy is kept as a backup; only the last 3 backups stay.
//   node config/herdr-app/install-review.mjs [--target <mods/review>]
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1]; };
const source = path.join(path.dirname(fileURLToPath(import.meta.url)), "mods/review");
const target = path.resolve(option("--target") ?? path.join(homedir(), ".config/herdr-app/mods/review"));
const home = path.dirname(path.dirname(target));
const backups = path.join(home, "data/review-install-backups");
const KEEP_BACKUPS = 3;
// Source files that are not part of the mod.
const SKIP = new Set(["tests", ".gitignore", "gpui-kit.d.ts", "jsconfig.json"]);
// Files Herdr writes into the mod folder itself: carried over to the new copy.
const APP_OWNED = ["gpui-kit.d.ts", "jsconfig.json"];

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }

async function list(dir, prefix = "", skip = SKIP) {
  const out = new Map();
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (skip.has(entry.name) || entry.name.endsWith(".error")) continue;
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) for (const [k, v] of await list(path.join(dir, entry.name), relative, skip)) out.set(k, v);
    else if (entry.isFile()) out.set(relative, await fs.readFile(path.join(dir, entry.name)));
  }
  return out;
}

export async function install() {
  const manifest = path.join(home, "installed.json");
  if (await exists(manifest) && "review" in JSON.parse(await fs.readFile(manifest, "utf8"))) throw new Error("The review mod is shipped by Herdr. Clone it before installing custom changes.");
  const want = await list(source);
  const have = await list(target, "", new Set(APP_OWNED));
  const updated = [...want].filter(([k, v]) => !have.has(k) || !have.get(k).equals(v)).map(([k]) => k);
  const removed = [...have.keys()].filter((k) => !want.has(k));
  if (!updated.length && !removed.length) return { updated, removed, backup: null };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const staging = path.join(home, "data", `review-install-${stamp}`);
  try {
    for (const [relative, bytes] of want) {
      await fs.mkdir(path.dirname(path.join(staging, relative)), { recursive: true });
      await fs.writeFile(path.join(staging, relative), bytes);
    }
    await fs.mkdir(staging, { recursive: true });
    for (const name of APP_OWNED) if (await exists(path.join(target, name))) await fs.copyFile(path.join(target, name), path.join(staging, name));
    let backup = null;
    if (await exists(target)) {
      backup = path.join(backups, stamp);
      await fs.mkdir(backups, { recursive: true });
      await fs.rename(target, backup);
      // A rename keeps the folder's old time; the backup is dated now, so pruning keeps it.
      const now = new Date();
      await fs.utimes(backup, now, now);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(staging, target);
    await prune();
    return { updated, removed, backup };
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/** Only the newest backups stay. */
export async function prune(keep = KEEP_BACKUPS) {
  // Oldest first by time: names from older installers sort differently.
  const names = await Promise.all((await fs.readdir(backups).catch(() => [])).map(async (name) => ({ name, at: (await fs.stat(path.join(backups, name))).mtimeMs })));
  names.sort((a, b) => a.at - b.at);
  for (const { name } of names.slice(0, Math.max(0, names.length - keep))) await fs.rm(path.join(backups, name), { recursive: true, force: true });
}

/**
 * The "Review this space" palette entry is a second, tiny mod (mods/review-here). Its files are written in
 * place: it has no state, and a half-written copy only means one more reload.
 */
export async function installHere() {
  const from = path.join(path.dirname(source), "review-here");
  const to = path.join(path.dirname(target), "review-here");
  const updated = [];
  await fs.mkdir(to, { recursive: true });
  for (const name of await fs.readdir(from)) {
    const want = await fs.readFile(path.join(from, name));
    const have = await fs.readFile(path.join(to, name)).catch(() => null);
    if (have && have.equals(want)) continue;
    await fs.writeFile(path.join(to, name), want);
    updated.push(name);
  }
  return updated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await install();
  result.here = await installHere();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
