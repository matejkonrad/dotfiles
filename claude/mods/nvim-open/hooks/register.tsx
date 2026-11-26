import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Roots } from '../types'

// One button per worktree this session works in: the session's own folder,
// plus every worktree Claude edits a file in. A press opens Neovim on that
// worktree in a new Rex or herdr tab, or focuses the Neovim already open there.

const roots = atom({ plugin: 'nvim-open', key: 'roots' } as const, [] as Roots)

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

type Host =
  | { kind: 'rex'; session: string; block: string }
  | { kind: 'tui'; workspaceId: string; paneId: string }
  | { kind: 'app'; terminalId: string }
  | null

/**
 * Reads `HERDR_ENV|HERDR_WORKSPACE_ID|HERDR_PANE_ID|REX_SESSION|REX_BLOCK|HC_TERMINAL_ID`.
 * Same order as fork: herdr TUI, then Rex, then the Herdr app.
 */
export function readHost(envLine: string): Host {
  const [herdrEnv = '', workspaceId = '', paneId = '', rexSession = '', rexBlock = '', terminalId = ''] =
    envLine.split('|')
  if (herdrEnv === '1' && workspaceId) return { kind: 'tui', workspaceId, paneId }
  if (rexSession) return { kind: 'rex', session: rexSession, block: rexBlock }
  if (terminalId) return { kind: 'app', terminalId }
  return null
}

/** The new pane's id from `rex split --json` or `herdr pane split` output, or null. */
export function readNewPane(output: string): string | null {
  try {
    const parsed = JSON.parse(output)
    const id =
      parsed?.block_ids?.[0] ?? parsed?.block_id ??
      parsed?.result?.pane?.pane_id ?? parsed?.result?.pane_id ?? parsed?.result?.root_pane?.pane_id
    return typeof id === 'string' && id !== '' ? id : null
  } catch {
    return null
  }
}

// The last Neovim pane this mod opened, so the next worktree stacks below it
// instead of splitting the Claude pane again. Module memory: a reload forgets it.
let lastRexNvim: string | null = null
let lastHerdrNvim: string | null = null

export function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path
}

/** Adds `root` to the list once, keeping the first-seen order. */
export function addRoot(list: string[], root: string): string[] {
  return list.includes(root) ? list : [...list, root]
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : '/'
}

function failure(run: { exitCode: number; stdout: string; stderr: string }): string {
  return run.stderr.trim() || run.stdout.trim() || `exit ${run.exitCode}`
}

// Folder -> worktree root (or null outside git). Module memory, so a reload clears it.
const rootCache = new Map<string, string | null>()

async function worktreeRoot($: EngineInterface, dir: string): Promise<string | null> {
  if (rootCache.has(dir)) return rootCache.get(dir) ?? null
  const run = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'])
  const root = run.exitCode === 0 ? run.stdout.trim() || null : null
  rootCache.set(dir, root)
  return root
}

async function track($: EngineInterface, dir: string): Promise<void> {
  const root = await worktreeRoot($, dir)
  if (root) await update($, roots, list => addRoot(list, root))
}

async function findHost($: EngineInterface): Promise<Host> {
  const run = await $.process.run([
    'sh', '-c',
    'printf "%s|%s|%s|%s|%s|%s" "$HERDR_ENV" "$HERDR_WORKSPACE_ID" "$HERDR_PANE_ID" "$REX_SESSION" "$REX_BLOCK" "$HC_TERMINAL_ID"',
  ])
  return readHost(run.stdout)
}

/**
 * The Neovim that config/nvim/lua/config/autocmds.lua starts in a Rex pane
 * listens on /tmp/nvim-rex-<sha256(REX_SESSION ":" root)[:16]>.sock and writes
 * its block id beside it. Focus that pane when it is still alive.
 */
async function focusRexNvim($: EngineInterface, session: string, root: string): Promise<boolean> {
  const run = await $.process.run([
    'sh', '-c',
    'key=$(printf "%s" "$1:$2" | shasum -a 256 | cut -c1-16); ' +
      '[ -S "/tmp/nvim-rex-$key.sock" ] && [ -s "/tmp/nvim-rex-$key.block" ] && ' +
      'nvim --server "/tmp/nvim-rex-$key.sock" --remote-expr 1 >/dev/null 2>&1 && ' +
      'rex focus -s "$1" "$(cat "/tmp/nvim-rex-$key.block")"',
    'sh', session, root,
  ])
  return run.exitCode === 0
}

/** First Neovim: right of the Claude pane. Each later one: below the last Neovim. */
async function openInRex($: EngineInterface, session: string, claudeBlock: string, root: string): Promise<string> {
  if (await focusRexNvim($, session, root)) return `Focused Neovim for ${basename(root)}.`
  const split = (anchor: string, direction: 'right' | 'below') =>
    $.process.run([
      'rex', 'split', '-s', session, '-b', anchor, '--split', direction, '-c', root,
      '--label', `nvim ${basename(root)}`, '--json', '--', 'nvim', '.',
    ])
  let run = lastRexNvim ? await split(lastRexNvim, 'below') : null
  // The last Neovim pane can be closed by now: fall back to the Claude pane.
  if (!run || run.exitCode !== 0) run = await split(claudeBlock, 'right')
  if (run.exitCode !== 0) return `Could not open a Rex pane: ${failure(run)}`
  lastRexNvim = readNewPane(run.stdout) ?? lastRexNvim
  return `Opened ${basename(root)} in Neovim next to this session.`
}

async function openInHerdrTui($: EngineInterface, claudePane: string, root: string): Promise<string> {
  const split = (anchor: string, direction: 'right' | 'down') =>
    $.process.run(['herdr', 'pane', 'split', anchor, '--direction', direction, '--cwd', root, '--focus'])
  let made = lastHerdrNvim ? await split(lastHerdrNvim, 'down') : null
  if (!made || made.exitCode !== 0) made = await split(claudePane, 'right')
  const paneId = made.exitCode === 0 ? readNewPane(made.stdout) : null
  if (!paneId) return `Could not open a herdr pane: ${failure(made)}`
  lastHerdrNvim = paneId
  const run = await $.process.run(['herdr', 'pane', 'run', paneId, 'nvim .'])
  return run.exitCode === 0
    ? `Opened ${basename(root)} in Neovim next to this session.`
    : `Opened a herdr pane, but Neovim did not start: ${failure(run)}`
}

async function openInHerdrApp($: EngineInterface, terminalId: string, root: string): Promise<string> {
  const self = await $.process.run(['hc', 'get', terminalId])
  let spaceId: string | null = null
  try {
    spaceId = JSON.parse(self.stdout)?.labels?.['herdr.space'] ?? null
  } catch {
    spaceId = null
  }
  if (!spaceId) return `Could not find this terminal's Herdr space: ${failure(self)}`
  // An unknown herdr.tab id makes Herdr open a new tab for the command.
  const tabId = `tbnvim${(await $.clock.now()).toString(36)}`
  const run = await $.process.run([
    'hc', 'run', '--bg', '--no-notify', '--outlive-parent', '--cwd', root,
    '--label', `herdr.space=${spaceId}`, '--label', `herdr.tab=${tabId}`, '--', 'nvim', '.',
  ])
  return run.exitCode === 0
    ? `Opened ${basename(root)} in Neovim in a new Herdr tab.`
    : `Could not start Neovim in Herdr: ${failure(run)}`
}

async function openNvim($: EngineInterface, root: string): Promise<string> {
  const host = await findHost($)
  switch (host?.kind) {
    case 'rex':
      return openInRex($, host.session, host.block, root)
    case 'tui':
      return openInHerdrTui($, host.paneId, root)
    case 'app':
      return openInHerdrApp($, host.terminalId, root)
    default:
      return 'Not in Rex or herdr, so there is no tab to open Neovim in.'
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await track($, await $.session.cwd())
    await $.command.register({
      name: 'nvim',
      description: 'Open a worktree of this session in Neovim',
      argumentHint: '[worktree name or path]',
    })
    return next(e)
  })

  // Claude moves into a worktree with EnterWorktree or edits files in one.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const tool = 'tool' in e ? e.tool : ''
    if (EDIT_TOOLS.has(tool) && 'file_path' in e && typeof e.file_path === 'string') {
      await track($, dirname(e.file_path))
    } else if (tool === 'EnterWorktree') {
      await track($, await $.session.cwd())
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    await track($, await $.session.cwd())
    return next(e)
  })

  on('command.run', { command: 'nvim' }, async ($, e) => {
    const arg = e.args.trim()
    const list = await read($, roots)
    let root: string | null = arg ? list.find(r => basename(r) === arg) ?? null : list[0] ?? null
    if (!root && arg) root = await worktreeRoot($, arg.startsWith('/') ? arg : `${await $.session.cwd()}/${arg}`)
    if (!root) return { text: arg ? `No worktree found for "${arg}".` : 'This session is not in a git worktree.' }
    await update($, roots, l => addRoot(l, root))
    return { text: await openNvim($, root) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, roots)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    // Letters, not digits: a bare digit typed into an empty prompt presses a
    // band Button. A letter presses only after ctrl+x tab moves focus here.
    const HOTKEYS = ['n', 'm', 'b', 'v', 'c', 'x', 'z']
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>nvim </Text>
        {list.map((root, i) => {
          const hotkey = HOTKEYS[i]
          return (
            <Button
              key={`nvim:${root}`}
              label={hotkey ? `${hotkey}: ${basename(root)}` : basename(root)}
              {...(hotkey ? { hotkey } : {})}
              onPress={async () => $.ui.toast(await openNvim($, root))}
            />
          )
        })}
      </Box>
    )
  })
}
