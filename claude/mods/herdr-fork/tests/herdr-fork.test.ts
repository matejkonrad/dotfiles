import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hasTab, readHerdr, readPaneId, readSpaceId } from '../hooks/register'

test('reads the new pane id from herdr tab create', async () => {
  expect(readPaneId('{"result":{"root_pane":{"pane_id":"p12"}}}')).toBe('p12')
})

test('gives no pane id for output herdr did not mean as a tab', async () => {
  expect(readPaneId('error: no such workspace')).toBeNull()
  expect(readPaneId('{"result":{}}')).toBeNull()
})

test('the herdr TUI wins over the app, and plain terminals are neither', async () => {
  expect(readHerdr('1|w3|t7')).toEqual({ kind: 'tui', workspaceId: 'w3' })
  expect(readHerdr('||t7')).toEqual({ kind: 'app', terminalId: 't7' })
  expect(readHerdr('||')).toBeNull()
})

test('reads the Herdr space from hc get', async () => {
  expect(readSpaceId('{"address":"t1","labels":{"herdr.space":"sp9","herdr.tab":"tb1"}}')).toBe('sp9')
  expect(readSpaceId('{"address":"t1","labels":{}}')).toBeNull()
  expect(readSpaceId('not json')).toBeNull()
})

test('finds a tab id in herdr-app ls', async () => {
  const ls = '{"spaces":[{"id":"sp9","tabs":[{"id":"tb1"},{"id":"tbfork1000"}]}]}'
  expect(hasTab(ls, 'tbfork1000')).toBe(true)
  expect(hasTab(ls, 'tbother')).toBe(false)
  expect(hasTab('not json', 'tb1')).toBe(false)
})

type Answer = { exitCode: number; stdout: string; stderr?: string }

/** Answers process.run by the env line given, and records every other command.
 *  `answer` can override the reply to a command; `lsTabs` is what herdr-app ls lists. */
function recordRuns(
  on: On,
  envLine: string,
  options: { lsTabs?: string[]; answer?: (argv: string[]) => Answer | undefined } = {},
): { runs: string[][]; clock: ReturnType<typeof mock.clock> } {
  const runs: string[][] = []
  const clock = mock.clock(on, { now: 36 ** 3 })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.cwd', async () => ({ value: '/src/app' }))
  on('session.model', async () => ({ value: 'opus' }))
  on('process.run', async (_, e) => {
    const argv = [...e.argv]
    const ok = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (argv[0] === 'sh') return ok(envLine)
    runs.push(argv)
    const custom = options.answer?.(argv)
    if (custom) {
      return {
        value: { exitCode: custom.exitCode, stdout: custom.stdout, stderr: custom.stderr ?? '',
          isStdoutTruncated: false, isStderrTruncated: false },
      }
    }
    if (argv[0] === 'hc' && argv[1] === 'get') return ok('{"labels":{"herdr.space":"sp9"}}')
    if (argv[0] === 'herdr' && argv[1] === 'tab') return ok('{"result":{"root_pane":{"pane_id":"p12"}}}')
    if (argv[0] === 'herdr-app' && argv[1] === 'ls') {
      const tabs = (options.lsTabs ?? ['tbfork1000']).map(id => ({ id }))
      return ok(JSON.stringify({ spaces: [{ id: 'sp9', tabs }] }))
    }
    return ok('{}')
  })
  return { runs, clock }
}

const run = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }) as const

test('in the Herdr app, /fork opens a connected tab in this space', async ($, on) => {
  const { runs } = recordRuns(on, '||t1')
  const result = await $.command.run(run('fork', 'try b'))
  expect(result).toEqual({ text: 'Forked this session into Herdr tab "try b".' })
  expect(runs).toEqual([
    ['hc', 'get', 't1'],
    ['hc', 'run', '--bg', '--no-notify', '--outlive-parent', '--keep', '--cwd', '/src/app',
      '--label', 'herdr.space=sp9', '--label', 'herdr.tab=tbfork1000',
      '--', 'claude', '--resume', 'sess-1', '--fork-session', '--model', 'opus'],
    ['herdr-app', 'ls'],
    ['herdr-app', 'do', 'tab.rename', '--id', 'tbfork1000', '--name', 'try b'],
    ['herdr-app', 'do', 'tab.select', '--id', 'tbfork1000'],
  ])
})

test('in the Herdr app, /fork waits for the tab, then reports when it never shows up', async ($, on) => {
  const { runs, clock } = recordRuns(on, '||t1', { lsTabs: [] })
  const pending = $.command.run(run('fork', 'late'))
  for (let i = 0; i < 10; i++) await clock.advance(300)
  const result = await pending
  expect(result).toEqual({
    text: 'Started the fork, but its Herdr tab tbfork1000 did not show up, so it keeps its default name.',
  })
  expect(runs.filter(argv => argv[1] === 'ls').length).toBe(10)
  expect(runs.some(argv => argv[2] === 'tab.rename')).toBe(false)
})

test('in the Herdr app, /fork reports a failed rename', async ($, on) => {
  const { runs } = recordRuns(on, '||t1', {
    answer: argv => (argv[2] === 'tab.rename' ? { exitCode: 1, stdout: '{"error":"no tab"}' } : undefined),
  })
  const result = await $.command.run(run('fork', 'x'))
  expect(result).toEqual({
    text: 'Forked this session into Herdr tab tbfork1000, but could not name it "x": {"error":"no tab"}',
  })
  expect(runs.some(argv => argv[2] === 'tab.select')).toBe(false)
})

test('in the herdr TUI, /clone keeps the herdr tab path', async ($, on) => {
  const { runs } = recordRuns(on, '1|w3|t1')
  const result = await $.command.run(run('clone', ''))
  expect(result).toEqual({ text: 'Forked this session into herdr tab "clone" (pane p12).' })
  expect(runs).toEqual([
    ['herdr', 'tab', 'create', '--workspace', 'w3', '--cwd', '/src/app', '--label', 'clone', '--focus'],
    ['herdr', 'pane', 'run', 'p12', 'claude', '--resume', 'sess-1', '--fork-session', '--model', 'opus'],
  ])
})

test('outside herdr, /fork runs no herdr commands', async ($, on) => {
  const { runs } = recordRuns(on, '||')
  on('command.run', async () => ({ text: 'built-in fork' }))
  const result = await $.command.run(run('fork', ''))
  expect(result).toEqual({ text: 'built-in fork' })
  expect(runs).toEqual([])
})
