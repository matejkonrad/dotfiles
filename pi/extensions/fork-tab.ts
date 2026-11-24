// /clone [label]: copy this pi session and open the copy in a new herdr/Rex/Herdr-app tab.
// pi's own /fork stays as it is (it branches in this terminal). The tab logic is shared with
// the Codex and Cursor hooks in ~/.local/bin/fork-tab.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

function run(argv: string[]): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile(argv[0], argv.slice(1), (error, stdout, stderr) => {
      const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0
      resolve({ code, out: `${stdout}${stderr}`.trim() })
    })
  })
}

/** Writes a copy of the session file with a new session id, next to the original. */
async function copySession(file: string): Promise<string> {
  const [header, ...rest] = (await readFile(file, 'utf8')).split('\n')
  const id = randomUUID()
  const copy = { ...JSON.parse(header), id, timestamp: new Date().toISOString(), parentSession: file }
  const target = path.join(path.dirname(file), `${new Date().toISOString().replace(/[:.]/g, '-')}_${id}.jsonl`)
  await writeFile(target, [JSON.stringify(copy), ...rest].join('\n'))
  return target
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand('clone', {
    description: 'Copy this session into a new herdr/Rex tab',
    handler: async (args, ctx) => {
      const file = ctx.sessionManager.getSessionFile()
      if (!file) {
        ctx.ui.notify('This session has no file yet, so there is nothing to copy.', 'error')
        return
      }
      const copy = await copySession(file)
      const label = args.trim() || 'clone'
      const { code, out } = await run(['fork-tab', label, ctx.cwd, '--', 'pi', '--session', copy])
      ctx.ui.notify(out || `fork-tab exited ${code}`, code === 0 ? 'info' : 'error')
    },
  })
}
