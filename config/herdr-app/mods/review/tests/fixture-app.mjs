#!/usr/bin/env node
// A home for a second, separate Herdr window that shows only review fixtures (for screenshots without touching
// the person's own window):  node fixture-app.mjs <home>; then HERDR_APP_HOME=<home> herdr-app
// and HERDR_APP_HOME=<home> herdr-app do review-fixture.case:<name>.
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cases, panelCases, fixtureMain } from "./fixtures.mjs";

// --source <mod folder>: render another copy of the mod (an install backup, for a before/after).
const at = process.argv.indexOf("--source");
const source = at > 0 ? path.resolve(process.argv[at + 1]) : path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = path.resolve(process.argv[2]);
const mod = path.join(home, "mods/review-fixture");
await fs.mkdir(mod, { recursive: true });
await fs.mkdir(path.join(home, "layouts"), { recursive: true });
for (const entry of await fs.readdir(source, { withFileTypes: true })) {
  if (entry.isFile() && /\.(js|mjs|lua|svg)$/.test(entry.name)) await fs.copyFile(path.join(source, entry.name), path.join(mod, entry.name));
}
await fs.writeFile(path.join(mod, "mod.json"), JSON.stringify({ place: "none", title: "review-fixture", focusable: true }));
await fs.writeFile(path.join(mod, "main.js"), fixtureMain(cases, { live: true, panels: panelCases }));
// The workspace-chrome icons the review uses (only the icons: no mod to dock).
await fs.mkdir(path.join(home, "icons/workspace-chrome"), { recursive: true });
const chrome = path.join(homedir(), ".config/herdr-app/mods/workspace-chrome");
for (const name of (await fs.readdir(chrome).catch(() => [])).filter((n) => n.endsWith(".svg"))) {
  await fs.mkdir(path.join(home, "mods/workspace-chrome"), { recursive: true });
  await fs.copyFile(path.join(chrome, name), path.join(home, "mods/workspace-chrome", name));
}
// One layout per case: a layout switch starts the mod fresh with that case.
// The panel sits at the right of an empty block, as in a layout.
await fs.mkdir(path.join(home, "mods/fx-fill"), { recursive: true });
await fs.writeFile(path.join(home, "mods/fx-fill/mod.json"), JSON.stringify({ place: "none", title: "fx-fill" }));
await fs.writeFile(path.join(home, "mods/fx-fill/main.js"), 'import { View, div } from "gpui-kit";\nimport { theme } from "herdr";\nexport default class Fill extends View { render() { return div().size_full().bg(theme().canvas); } }\n');
// The panel's icons are read from mods/review (its install name).
await fs.mkdir(path.join(home, "mods/review"), { recursive: true });
for (const entry of await fs.readdir(source)) if (entry.endsWith(".svg")) await fs.copyFile(path.join(source, entry), path.join(home, "mods/review", entry));
for (const [name] of panelCases) await fs.writeFile(path.join(home, `layouts/fx-${name}.json`), JSON.stringify({ id: "root", type: "row", children: [
  { id: "fill", type: "block", content: { mod: "fx-fill" } },
  { id: "fixture", type: "block", size: { px: 340 }, content: { mod: "review-fixture", props: { case: name } } }] }, null, 2));
for (const [name] of cases) await fs.writeFile(path.join(home, `layouts/fx-${name}.json`), JSON.stringify({ id: "root", type: "column", children: [
  { id: "fixture", type: "block", content: { mod: "review-fixture", props: { case: name } } }] }, null, 2));
const settings = JSON.parse(await fs.readFile(path.join(homedir(), ".config/herdr-app/settings.json"), "utf8").catch(() => "{}"));
await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ ...settings, sounds: { enabled: false } }, null, 2));
process.stdout.write(`${home}\n${cases.map((c) => c[0]).join(" ")}\n`);
