#!/usr/bin/env node
// Renders review views with the real native renderer and its execution budget (`herdr-app check`), from fixtures.
// Each case sets up the tab, then renders once; a throw or an interrupted render fails the check.
import * as fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const only = process.argv[2] ?? null;
import { cases, panelCases, fixtureMain } from "./fixtures.mjs";
const target = await fs.mkdtemp(path.join(tmpdir(), "herdr-review-native-"));
try {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.isFile() && (/\.(js|mjs|lua|svg)$/.test(entry.name) || entry.name === "mod.json")) await fs.copyFile(path.join(source, entry.name), path.join(target, entry.name));
  }
  for (const [name, files, setup] of cases) {
    if (only && !name.includes(only)) continue;
    await fs.writeFile(path.join(target, "main.js"), fixtureMain([[name, files, setup]]));
    process.stdout.write(`Checking ${name}\n`);
    execFileSync("herdr-app", ["check", target], { stdio: "inherit" });
  }
  for (const [name, setup] of panelCases) {
    if (only && !name.includes(only)) continue;
    await fs.writeFile(path.join(target, "main.js"), fixtureMain([], { panels: [[name, setup]] }));
    process.stdout.write(`Checking ${name}\n`);
    execFileSync("herdr-app", ["check", target], { stdio: "inherit" });
  }
} finally { await fs.rm(target, { recursive: true, force: true }); }
