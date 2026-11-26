import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const BLOCK = { plugin: 'mermaid-terminal', surface: 'terminal', component: 'CodeBlock' } as const
const SOURCE = 'flowchart TD\n  A[nvim] --> B[rex]\n'

// The first 24 bytes of a 644 x 1084 PNG: signature, IHDR length, IHDR, size.
const PNG_HEAD = btoa(
  String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x84, 0, 0, 4, 0x3c),
)

// Stands in for the host: an environment, a file system, and mmdc.
function host(on: On, env: string, mmdcExit: number) {
  const files = new Set<string>()
  const ran: string[][] = []
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_DATA: '/data' } }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    if (e.argv[0] === '/usr/bin/env') {
      return { value: { exitCode: 0, stdout: env, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const out = e.argv[e.argv.indexOf('-o') + 1]
    if (mmdcExit === 0 && out) {
      files.add(out)
    }
    return {
      value: { exitCode: mmdcExit, stdout: '', stderr: mmdcExit ? 'Parse error' : '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('fs.stat', (_, e) => {
    const known = files.has(e.path) || e.path.endsWith('/mmdc') || e.path.endsWith('Google Chrome')
    if (!known) {
      throw new Error(`ENOENT ${e.path}`)
    }
    return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }
  })
  on('fs.write', (_, e) => {
    files.add(e.path)
    return { value: undefined }
  })
  on('fs.read', () => ({ value: { base64: PNG_HEAD } }))
  return { files, ran }
}

test('in Rex a closed mermaid fence draws as an image', async ($, on) => {
  const { ran } = host(on, 'TERM_PROGRAM=rex\nCLAUDE_CODE_FORCE_TERMINAL_IMAGES=1\nHOME=/h\n', 0)
  const ui = await $.ui.mount({ ...BLOCK, props: { language: 'mermaid', source: SOURCE, isClosed: true } })
  const image = await ui.find({ type: 'Image' })
  expect(image).toBeDefined()
  // 644 px at 2x is 322 CSS px: 38 cells across, 1084/644 tall at 2.1 per cell.
  expect(image?.props.columns).toBe(38)
  expect(image?.props.rows).toBe(30)
  expect(ran.some(argv => argv[0]?.endsWith('/mmdc'))).toBe(true)
  await ui.unmount()
})

test('inside tmux it draws box-drawing text and never runs mmdc', async ($, on) => {
  const { ran } = host(on, 'TERM_PROGRAM=rex\nCLAUDE_CODE_FORCE_TERMINAL_IMAGES=1\nTMUX=/tmp/t,1,0\nHOME=/h\n', 0)
  const ui = await $.ui.mount({ ...BLOCK, props: { language: 'mermaid', source: SOURCE, isClosed: true } })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(ran.some(argv => argv[0]?.endsWith('/mmdc'))).toBe(false)
  await ui.unmount()
})

test('in Rex without the image override it draws box-drawing text', async ($, on) => {
  const { ran } = host(on, 'TERM_PROGRAM=rex\nHOME=/h\n', 0)
  const ui = await $.ui.mount({ ...BLOCK, props: { language: 'mermaid', source: SOURCE, isClosed: true } })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(ran.some(argv => argv[0]?.endsWith('/mmdc'))).toBe(false)
  await ui.unmount()
})

test('a failed render falls back to box-drawing text', async ($, on) => {
  host(on, 'TERM_PROGRAM=rex\nCLAUDE_CODE_FORCE_TERMINAL_IMAGES=1\nHOME=/h\n', 1)
  const ui = await $.ui.mount({ ...BLOCK, props: { language: 'mermaid', source: SOURCE, isClosed: true } })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('an open fence keeps streaming its source', async ($, on) => {
  host(on, 'TERM_PROGRAM=rex\n', 0)
  const ui = await $.ui.mount({ ...BLOCK, props: { language: 'mermaid', source: '', isClosed: false } })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})
