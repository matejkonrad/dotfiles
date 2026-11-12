import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const installer = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../install-review.mjs");

test("the installer mirrors the source, keeps app files and the last 3 backups", async (t) => {
  const home = await fs.mkdtemp(path.join(tmpdir(), "herdr-install-test-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const target = path.join(home, "mods/review");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "old-file.js"), "gone after install");
  await fs.writeFile(path.join(target, "walkthrough-runner.py"), "leftover");
  await fs.writeFile(path.join(target, "gpui-kit.d.ts"), "app owned");
  for (const name of ["a", "b", "c", "d"]) await fs.mkdir(path.join(home, "data/review-install-backups", name), { recursive: true });
  await fs.mkdir(path.join(home, "data/walkthrough"), { recursive: true });
  await fs.writeFile(path.join(home, "data/walkthrough/keep.json"), "{}");
  const result = JSON.parse(execFileSync("node", [installer, "--target", target], { encoding: "utf8" }));
  assert.ok(result.removed.includes("old-file.js"));
  const files = await fs.readdir(target);
  assert.ok(files.includes("main.js") && files.includes("agent-runner.mjs") && files.includes("agent-skill"));
  assert.ok(!files.includes("old-file.js") && !files.includes("walkthrough-runner.py") && !files.includes("tests"));
  assert.equal(await fs.readFile(path.join(target, "gpui-kit.d.ts"), "utf8"), "app owned");
  assert.equal((await fs.readdir(path.join(home, "data/review-install-backups"))).length, 3);
  assert.equal(await fs.readFile(path.join(home, "data/walkthrough/keep.json"), "utf8"), "{}");
  const again = JSON.parse(execFileSync("node", [installer, "--target", target], { encoding: "utf8" }));
  assert.deepEqual([again.updated.length, again.removed.length], [0, 0], "a second install changes nothing");
});
