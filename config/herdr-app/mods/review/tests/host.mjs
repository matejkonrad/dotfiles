// Loads the mod's real modules in node: `herdr`, `gpui-kit`, `gpui-base` and `fs/promises` (as the mod imports
// them) resolve to fakes driven by `host`. Import this first, then the mod with a dynamic import().
import { registerHooks } from "node:module";

const MOD = new URL("../", import.meta.url).href;
const TESTS = new URL("./", import.meta.url).href;
const FAKES = { herdr: "herdr.mjs", "gpui-kit": "gpui-kit.mjs", "gpui-base": "gpui-base.mjs", "fs/promises": "fs.mjs" };

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ?? "";
    if (FAKES[specifier] && parent.startsWith(MOD) && !parent.startsWith(TESTS)) return { url: new URL(`./fakes/${FAKES[specifier]}`, import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});

export { host, reset, el, drawn, textarea, theme, cx, click, render } from "./fakes/state.mjs";
