import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

/** Starts a session drawn on `surfaces`, and returns what the plugin registered and opened. */
function recordStart(on: On, surfaces: RenderSurface[]): string[] {
  const calls: string[] = []
  mock.store(on)
  mock.env(on, {})
  mock.clock(on, { now: Date.parse('2026-10-13T12:00:00Z') })
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  on('session.surfaces', async () => ({ value: surfaces }))
  on('session.root', async () => ({ value: '/src/creators' }))
  on('session.id', async () => ({ value: 'session-1' }))
  on('ui.status', async () => ({ value: undefined }))
  on('command.register', async (_, e) => {
    calls.push(`command ${e.name}`)
    return { value: { command: e.name } }
  })
  on('tool.register', async (_, e) => {
    calls.push(`tool ${e.name}`)
    return { value: { tool: e.name } }
  })
  on('process.run', async () => ({
    value: { exitCode: 1, stdout: '', stderr: 'not mocked', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  return calls
}

test('registers its command and tool in a terminal session', async ($, on) => {
  const calls = recordStart(on, ['terminal'])
  await $.session.start({ cwd: '/src/creators', surface: 'terminal', isInteractive: true })
  // Waits for the first poll, which the start leaves running.
  await $.command.run({ command: 'pr-watch', args: 'refresh', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(calls).toEqual(['command pr-watch', 'tool watch_prs'])
})

test('stays out of a desktop session, which tracks PRs itself', async ($, on) => {
  const calls = recordStart(on, ['desktop'])
  await $.session.start({ cwd: '/src/creators', surface: 'desktop', isInteractive: true })
  expect(calls).toEqual([])
})
