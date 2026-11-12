// Host calls can fail with null (`throw null` reaches Herdr as `Null"null"` and stops a hot reload). The mod's
// entry must survive that: init never throws, render throws only Errors, and the command loop ends quietly.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import { asError, attempt } from "../errors.mjs";

const source = (await fs.readFile(new URL("../main.js", import.meta.url), "utf8"))
  .replace(/^import [\s\S]*?;\n/gm, "").replace("export default class Review", "globalThis.Review = class Review");

function load({ impl, nextCommand }) {
  const div = () => { const e = new Proxy({}, { get: (_t, k) => (k === "kids" ? [] : () => e) }); return e; };
  const ctx = vm.createContext({ console: { error() {} }, asError, inFrame: (fn) => fn(), div, theme: () => ({}), appHome: () => "/x", props: () => ({}),
    nextCommand, fs: { mkdir: async () => { throw null; }, writeFile: async () => {} },
    View: class {}, Panel: impl, ReviewTab: impl, Launcher: impl });
  vm.runInContext(source, ctx);
  return ctx.Review;
}
const tasks = [];
const cx = { spawn(fn) { tasks.push(fn(cx)); }, notify() {} };

test("init survives a constructor that throws null, and shows the error", async () => {
  const Review = load({ impl: class { constructor() { throw null; } }, nextCommand: () => Promise.reject(null) });
  const view = new Review();
  assert.doesNotThrow(() => view.init({}, cx));
  assert.equal(view.impl, null);
  assert.ok(view.initError instanceof Error);
  assert.doesNotThrow(() => view.render(cx));
  await Promise.all(tasks.splice(0));
});

test("render rethrows null as an Error; the command loop ends when nextCommand rejects with null", async () => {
  let calls = 0;
  const Review = load({ impl: class { render() { throw null; } command() { throw null; } }, nextCommand: () => (calls++ ? Promise.reject(null) : Promise.resolve("refresh")) });
  const view = new Review();
  view.init({}, cx);
  assert.throws(() => view.render(cx), (e) => e instanceof Error && /render/.test(e.message));
  await Promise.all(tasks.splice(0));
  assert.equal(calls, 2, "one command handled (its null throw reported), then the loop ended");
});

test("asError keeps Errors and names what failed otherwise; attempt swallows null rejections", async () => {
  const e = new Error("x");
  assert.equal(asError(e), e);
  assert.match(asError(null, "load").message, /^load: a host call failed/);
  assert.equal(asError({ message: "m" }).message, "m");
  assert.equal(await attempt(Promise.reject(null), 7), 7);
});
