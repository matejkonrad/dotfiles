import type { EngineInterface, Register } from 'claude-code'

const FORK_COMMANDS = ['fork', 'clone'] as const

/** Where this session runs: the herdr TUI, the Herdr desktop app, or neither. */
export type Herdr =
  | { kind: 'tui'; workspaceId: string }
  | { kind: 'app'; terminalId: string }
  | null

/** Reads `HERDR_ENV|HERDR_WORKSPACE_ID|HC_TERMINAL_ID`. The TUI wins when both are set. */
export function readHerdr(envLine: string): Herdr {
  const [herdrEnv = '', workspaceId = '', terminalId = ''] = envLine.split('|')
  if (herdrEnv === '1' && workspaceId) return { kind: 'tui', workspaceId }
  if (terminalId) return { kind: 'app', terminalId }
  return null
}

/** e.g. `{"result":{"root_pane":{"pane_id":"p12"}}}` → "p12" */
export function readPaneId(herdrOutput: string): string | null {
  try {
    const parsed: unknown = JSON.parse(herdrOutput)
    const paneId =
      typeof parsed === 'object' && parsed !== null && 'result' in parsed &&
      typeof parsed.result === 'object' && parsed.result !== null && 'root_pane' in parsed.result &&
      typeof parsed.result.root_pane === 'object' && parsed.result.root_pane !== null &&
      'pane_id' in parsed.result.root_pane
        ? parsed.result.root_pane.pane_id
        : null
    return typeof paneId === 'string' && paneId !== '' ? paneId : null
  } catch {
    return null
  }
}

/** e.g. `hc get t1` → `{"labels":{"herdr.space":"sp1",...}}` → "sp1" */
export function readSpaceId(hcGetOutput: string): string | null {
  try {
    const parsed: unknown = JSON.parse(hcGetOutput)
    const labels =
      typeof parsed === 'object' && parsed !== null && 'labels' in parsed ? parsed.labels : null
    const spaceId =
      typeof labels === 'object' && labels !== null && 'herdr.space' in labels ? labels['herdr.space'] : null
    return typeof spaceId === 'string' && spaceId !== '' ? spaceId : null
  } catch {
    return null
  }
}

async function findHerdr($: EngineInterface): Promise<Herdr> {
  const run = await $.process.run(['sh', '-c', 'printf "%s|%s|%s" "$HERDR_ENV" "$HERDR_WORKSPACE_ID" "$HC_TERMINAL_ID"'])
  return readHerdr(run.stdout)
}

async function forkArgv($: EngineInterface): Promise<string[]> {
  // Notice: --fork-session makes the new tab a copy with its own session id, so this session stays as it is.
  return ['claude', '--resume', await $.session.id(), '--fork-session', '--model', await $.session.model()]
}

async function openForkInHerdrTab($: EngineInterface, workspaceId: string, label: string): Promise<string> {
  const cwd = await $.session.cwd()
  const tab = await $.process.run([
    'herdr', 'tab', 'create', '--workspace', workspaceId, '--cwd', cwd, '--label', label, '--focus',
  ])
  const paneId = tab.exitCode === 0 ? readPaneId(tab.stdout) : null
  if (!paneId) {
    return `Could not open a herdr tab: ${tab.stderr.trim() || tab.stdout.trim() || `herdr exited ${tab.exitCode}`}`
  }

  const started = await $.process.run(['herdr', 'pane', 'run', paneId, ...(await forkArgv($))])
  if (started.exitCode !== 0) {
    return `Opened herdr tab "${label}" (pane ${paneId}), but could not start the fork: ${started.stderr.trim()}`
  }

  return `Forked this session into herdr tab "${label}" (pane ${paneId}).`
}

async function openForkInAppTab($: EngineInterface, terminalId: string, label: string): Promise<string> {
  const self = await $.process.run(['hc', 'get', terminalId])
  const spaceId = self.exitCode === 0 ? readSpaceId(self.stdout) : null
  if (!spaceId) {
    return `Could not find this terminal's Herdr space: ${self.stderr.trim() || `hc get exited ${self.exitCode}`}`
  }

  // An unknown herdr.tab id makes Herdr open a new tab. Started with hc from this terminal, the
  // fork keeps this session as its parent in the Agents list; --outlive-parent keeps it alive after us.
  const tabId = `tbfork${(await $.clock.now()).toString(36)}`
  const started = await $.process.run([
    'hc', 'run', '--bg', '--no-notify', '--outlive-parent', '--keep', '--cwd', await $.session.cwd(),
    '--label', `herdr.space=${spaceId}`, '--label', `herdr.tab=${tabId}`, '--', ...(await forkArgv($)),
  ])
  if (started.exitCode !== 0) {
    return `Could not start the fork in Herdr: ${started.stderr.trim() || `hc run exited ${started.exitCode}`}`
  }

  // Herdr opens the tab a moment after hc run returns; rename and select fail until then.
  if (!(await waitForTab($, tabId))) {
    return `Started the fork, but its Herdr tab ${tabId} did not show up, so it keeps its default name.`
  }
  const renamed = await $.process.run(['herdr-app', 'do', 'tab.rename', '--id', tabId, '--name', label])
  if (renamed.exitCode !== 0) {
    return `Forked this session into Herdr tab ${tabId}, but could not name it "${label}": ${failure(renamed)}`
  }
  const selected = await $.process.run(['herdr-app', 'do', 'tab.select', '--id', tabId])
  if (selected.exitCode !== 0) {
    return `Forked this session into Herdr tab "${label}", but could not show it: ${failure(selected)}`
  }
  return `Forked this session into Herdr tab "${label}".`
}

const TAB_WAIT_TRIES = 10
const TAB_WAIT_MS = 300

/** True when `herdr-app ls` output lists a tab with this id. */
export function hasTab(lsOutput: string, tabId: string): boolean {
  try {
    const parsed: unknown = JSON.parse(lsOutput)
    const spaces =
      typeof parsed === 'object' && parsed !== null && 'spaces' in parsed && Array.isArray(parsed.spaces)
        ? parsed.spaces
        : []
    return spaces.some(
      (space: unknown) =>
        typeof space === 'object' && space !== null && 'tabs' in space && Array.isArray(space.tabs) &&
        space.tabs.some((tab: unknown) => typeof tab === 'object' && tab !== null && 'id' in tab && tab.id === tabId),
    )
  } catch {
    return false
  }
}

async function waitForTab($: EngineInterface, tabId: string): Promise<boolean> {
  for (let i = 0; i < TAB_WAIT_TRIES; i++) {
    const ls = await $.process.run(['herdr-app', 'ls'])
    if (ls.exitCode === 0 && hasTab(ls.stdout, tabId)) return true
    if (i < TAB_WAIT_TRIES - 1) await $.clock.sleep(TAB_WAIT_MS)
  }
  return false
}

function failure(run: { exitCode: number; stdout: string; stderr: string }): string {
  return run.stderr.trim() || run.stdout.trim() || `exit ${run.exitCode}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const existing = new Set((await $.command.list()).map(command => command.name))
    if (!existing.has('clone')) {
      await $.command.register({ name: 'clone', description: 'Fork this session into a new herdr tab' })
    }
    return next(e)
  })

  for (const command of FORK_COMMANDS) {
    on('command.run', { command }, async ($, e, next) => {
      const herdr = await findHerdr($)
      if (!herdr) return next(e)

      const label = e.args.trim() || command
      return {
        text: herdr.kind === 'tui'
          ? await openForkInHerdrTab($, herdr.workspaceId, label)
          : await openForkInAppTab($, herdr.terminalId, label),
      }
    })
  }
}
