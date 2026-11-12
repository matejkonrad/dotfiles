// fs/promises as the mod sees it: writes and removals are recorded in host.fs, files live in host.files.
import { host } from "./state.mjs";
export async function writeFile(path, text) { host.fs.written.push([path, String(text)]); host.files.set(path, String(text)); }
export async function readFile(path) { if (!host.files.has(path)) throw new Error(`ENOENT ${path}`); return host.files.get(path); }
export async function unlink(path) { host.fs.removed.push(path); host.files.delete(path); }
export async function rm(path) { host.fs.removed.push(path); host.files.delete(path); }
export async function mkdir(path) { host.fs.dirs.push(path); }
export async function rename(from, to) { if (!host.files.has(from)) throw new Error(`ENOENT ${from}`); host.files.set(to, host.files.get(from)); host.files.delete(from); }
export async function readdir(dir) { return [...new Set([...host.files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split("/")[0]))]; }
export async function stat(path) { if (!host.files.has(path)) throw new Error(`ENOENT ${path}`); return { mtimeMs: host.mtimes?.get(path) ?? Date.now(), size: host.files.get(path).length }; }
