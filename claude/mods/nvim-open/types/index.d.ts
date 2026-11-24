/** Worktree roots, in the order this session first touched them. */
export type Roots = string[]

declare module 'claude-code' {
  interface PluginState {
    'nvim-open': { roots: Roots }
  }
}
