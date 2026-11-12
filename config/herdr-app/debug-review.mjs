#!/usr/bin/env node
// Read native stack traces/state directly; screenshots are for design.
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
const root = path.join(homedir(), ".config/herdr-app/data/review-debug");
const files = await Promise.all((await fs.readdir(root).catch(() => [])).filter((name) => name.endsWith(".json"))
  .map(async (name) => ({ file: path.join(root, name), at: (await fs.stat(path.join(root, name))).mtimeMs })));
files.sort((a, b) => b.at - a.at);
if (!files.length) process.stdout.write("No captured errors. Run `herdr-app do review.debug` to capture current state.\n");
for (const { file } of process.argv.includes("--all") ? files : files.slice(0, 2)) process.stdout.write(`${file}\n${await fs.readFile(file, "utf8")}\n`);
