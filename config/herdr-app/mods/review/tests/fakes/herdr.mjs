import { host, theme as fakeTheme } from "./state.mjs";

export const shared = (key) => {
  host.reads++;
  host.readsByKey[key] = (host.readsByKey[key] ?? 0) + 1;
  const text = host.store.get(key);
  return text === undefined ? null : JSON.parse(text);
};
export const setShared = (key, value) => { host.writes++; host.store.set(key, JSON.stringify(value)); };
export const spaces = () => host.spaces;
export const panes = () => host.panes;
export const agents = () => host.agents;
export const terminals = () => host.terminals;
export const focused = () => host.focused;
export const props = () => host.props;
export const layout = () => host.layout;
export const keys = () => host.keys;
export const window = () => ({ platform: "macos" });
export const settings = () => host.settings;
export const theme = () => host.theme ?? fakeTheme;
export const appHome = () => host.appHome;
export const home = () => host.home;
export const run = (name, args) => { host.runs.push([name, args]); };
export const notify = (n) => { host.notices.push(n); };
export const openOverlay = (o) => { host.overlays.push(o); return "o1"; };
export const exec = (...args) => host.exec(...args);
export const hc = (...args) => host.hc(...args);
export const nextCommand = () => (host.nextCommand ? host.nextCommand() : new Promise(() => {}));
export const knownAgents = async () => host.knownAgents ?? [];
export async function readTextFile(path) {
  if (host.readFails) throw new Error(host.readFails);
  return host.files.has(path) ? host.files.get(path) : null;
}
/** Compare-and-swap like the host: `expected` (when given) must be the file's text now (null: no file). */
export async function writeTextFile(path, text, expected) {
  if (host.writeFails) throw new Error(host.writeFails);
  if (expected !== undefined && (host.files.get(path) ?? null) !== expected) throw new Error("changed on disk");
  host.files.set(path, text);
}
