import type { EngineInterface, Register } from 'claude-code'

const FORK_COMMANDS = ['fork', 'clone'] as const

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

/** The herdr workspace this session runs in, or null outside herdr. */
async function findHerdrWorkspace($: EngineInterface): Promise<string | null> {
  const run = await $.process.run(['sh', '-c', 'printf "%s %s" "$HERDR_ENV" "$HERDR_WORKSPACE_ID"'])
  const [herdrEnv, workspaceId] = run.stdout.split(' ')
  return herdrEnv === '1' && workspaceId ? workspaceId : null
}

async function openForkInHerdrTab($: EngineInterface, workspaceId: string, label: string): Promise<string> {
  const sessionId = await $.session.id()
  const cwd = await $.session.cwd()
  const model = await $.session.model()

  const tab = await $.process.run([
    'herdr', 'tab', 'create', '--workspace', workspaceId, '--cwd', cwd, '--label', label, '--focus',
  ])
  const paneId = tab.exitCode === 0 ? readPaneId(tab.stdout) : null
  if (!paneId) {
    return `Could not open a herdr tab: ${tab.stderr.trim() || tab.stdout.trim() || `herdr exited ${tab.exitCode}`}`
  }

  // Notice: --fork-session makes the new tab a copy with its own session id, so this session stays as it is.
  const started = await $.process.run([
    'herdr', 'pane', 'run', paneId, 'claude', '--resume', sessionId, '--fork-session', '--model', model,
  ])
  if (started.exitCode !== 0) {
    return `Opened herdr tab "${label}" (pane ${paneId}), but could not start the fork: ${started.stderr.trim()}`
  }

  return `Forked this session into herdr tab "${label}" (pane ${paneId}).`
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
      const workspaceId = await findHerdrWorkspace($)
      if (!workspaceId) return next(e)

      const label = e.args.trim() || command
      return { text: await openForkInHerdrTab($, workspaceId, label) }
    })
  }
}
