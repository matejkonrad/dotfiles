import type { EngineInterface, Register } from 'claude-code'

import { withDiagrams } from './mermaid.mjs'

// Draws each closed ```mermaid fence in Claude's replies as a picture, rendered
// by mermaid-cli (`brew install mermaid-cli`) through the installed Google
// Chrome, where Claude Code draws kitty graphics (kitty, Ghostty, and Rex with
// CLAUDE_CODE_FORCE_TERMINAL_IMAGES). Anywhere else, or when the render fails, it falls back to the
// box-drawing renderer in mermaid.mjs, and past that to the raw source.

const MMDC = '/opt/homebrew/bin/mmdc'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const RENDER_TIMEOUT_MS = 8_000

// mmdc renders at 2x. A terminal cell is about 8.5 CSS px wide and 2.1 times
// as tall as it is wide; the picture scales to fill its box of cells.
const SCALE = 2
const CELL_PX = 8.5
const CELL_ASPECT = 2.1
const MAX_CELLS = 255

// Fesper (config/nvim/colors/fesper.lua). The background stays transparent.
const MERMAID_CONFIG = {
  theme: 'base',
  themeVariables: {
    darkMode: true,
    background: '#1A1A1A',
    fontFamily: 'Menlo, monospace',
    fontSize: '15px',
    primaryColor: '#232323',
    primaryTextColor: '#B3B3B3',
    primaryBorderColor: '#FFC799',
    secondaryColor: '#212121',
    secondaryTextColor: '#B3B3B3',
    secondaryBorderColor: '#A0A0A0',
    tertiaryColor: '#2A2A2A',
    tertiaryTextColor: '#B3B3B3',
    tertiaryBorderColor: '#A0A0A0',
    lineColor: '#A0A0A0',
    textColor: '#B3B3B3',
    edgeLabelBackground: '#1A1A1A',
    clusterBkg: '#212121',
    clusterBorder: '#2A2A2A',
    noteBkgColor: '#2A2A2A',
    noteTextColor: '#B3B3B3',
    noteBorderColor: '#FFC799',
    actorBkg: '#232323',
    actorTextColor: '#B3B3B3',
    actorBorder: '#FFC799',
    actorLineColor: '#A0A0A0',
    signalColor: '#B3B3B3',
    signalTextColor: '#B3B3B3',
    labelBoxBkgColor: '#232323',
    labelTextColor: '#B3B3B3',
    errorBkgColor: '#FF8080',
  },
}

const PUPPETEER_CONFIG = {
  executablePath: CHROME,
  headless: 'shell',
  args: ['--no-first-run', '--disable-gpu'],
}

const GUIDANCE_IMAGES = [
  '# Diagrams',
  'This terminal draws ```mermaid code fences in your replies as rendered images (mermaid-cli).',
  'When a reply explains a flow, an architecture, a sequence of calls, a state machine, or how parts connect, draw it as a mermaid diagram instead of ASCII art.',
  'Every mermaid diagram type renders (flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, gantt). Keep labels short, and prefer `flowchart TD` over `LR` for more than four nodes so the image stays readable in a narrow pane.',
].join('\n')

const GUIDANCE_TEXT = [
  '# Diagrams',
  'This terminal draws ```mermaid code fences in your replies as box-drawing diagrams.',
  'When a reply explains a flow, an architecture, a sequence of calls, or how parts connect, draw it as a mermaid `flowchart` or `sequenceDiagram` instead of ASCII art.',
  'Only flowchart/graph and sequenceDiagram are drawn; other mermaid types show as raw code.',
  'Keep node labels short (under about 30 characters) so the diagram fits a narrow pane, and prefer `flowchart TD` when there are more than four nodes.',
  'A diagram that does not fit the pane width shows as raw code. Do not put a labeled arrow into a node that has more than one incoming arrow: that also shows as raw code.',
].join('\n')

type Setup = { images: boolean; dir: string }

type Picture = { file: string; width: number; height: number }

// FNV-1a over the text, twice with different seeds: a cache key, not security.
function hash(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

// Width and height from a PNG's IHDR chunk (bytes 16 to 24).
function pngSize(base64: string): { width: number; height: number } | undefined {
  const bytes = atob(base64)
  if (bytes.length < 24 || bytes.slice(1, 4) !== 'PNG') {
    return undefined
  }
  const u32 = (at: number) =>
    ((bytes.charCodeAt(at) << 24) | (bytes.charCodeAt(at + 1) << 16) | (bytes.charCodeAt(at + 2) << 8) | bytes.charCodeAt(at + 3)) >>> 0
  return { width: u32(16), height: u32(20) }
}

// Whether Claude Code's Image element draws pixels here. Claude Code allows
// kitty graphics only when XTVERSION names kitty or ghostty, unless
// CLAUDE_CODE_FORCE_TERMINAL_IMAGES is set (.zshrc sets it in Rex, which is
// built on libghostty). MERMAID_TERMINAL_IMAGES=0 or 1 overrides this guess.
function drawsImages(env: Record<string, string>): boolean {
  const forced = env.MERMAID_TERMINAL_IMAGES
  if (forced === '0' || forced === '1') {
    return forced === '1'
  }
  if (env.TMUX || env.ZELLIJ || env.HERDR_ENV === '1') {
    return false
  }
  if (env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES) {
    return true
  }
  const term = env.TERM ?? ''
  return env.TERM_PROGRAM === 'ghostty' || term.includes('kitty') || term.includes('ghostty') || Boolean(env.KITTY_WINDOW_ID)
}

// The box-drawing version of one diagram, or undefined when it cannot draw it.
function textDiagram(source: string, columns: number): string | undefined {
  const fenced = '```mermaid\n' + source.replace(/\n$/, '') + '\n```'
  const drawn: string = withDiagrams(fenced, columns)
  if (drawn === fenced) {
    return undefined
  }
  const lines = drawn.split('\n')
  return lines.slice(1, -1).join('\n')
}

// Module state: the module reloads whole, so these start over on a reload.
let setup: Promise<Setup> | undefined
const renders = new Map<string, Promise<Picture | undefined>>()
let guidedSession: string | undefined

function getSetup($: EngineInterface): Promise<Setup> {
  setup ??= (async () => {
    const env = await $.process.hookEnv()
    const host = await $.process.run(['/usr/bin/env'])
    const hostEnv: Record<string, string> = {}
    for (const line of host.stdout.split('\n')) {
      const at = line.indexOf('=')
      if (at > 0) {
        hostEnv[line.slice(0, at)] = line.slice(at + 1)
      }
    }
    const dir = env.CLAUDE_PLUGIN_DATA ?? `${hostEnv.HOME}/.cache/mermaid-terminal`
    const hasMmdc = (await $.fs.stat(MMDC).catch(() => undefined)) !== undefined
    const hasChrome = (await $.fs.stat(CHROME).catch(() => undefined)) !== undefined
    if (hasMmdc && hasChrome) {
      await $.fs.write(`${dir}/mermaid.json`, JSON.stringify(MERMAID_CONFIG))
      await $.fs.write(`${dir}/puppeteer.json`, JSON.stringify(PUPPETEER_CONFIG))
    }
    return { images: hasMmdc && hasChrome && drawsImages(hostEnv), dir }
  })()
  return setup
}

async function renderOnce($: EngineInterface, s: Setup, key: string, source: string): Promise<Picture | undefined> {
  const file = `${s.dir}/png/${key}.png`
  const cached = await $.fs.stat(file).catch(() => undefined)
  if (!cached) {
    await $.fs.write(`${s.dir}/png/${key}.mmd`, source)
    const result = await $.process
      .run(
        [
          MMDC,
          '-i', `${s.dir}/png/${key}.mmd`,
          '-o', file,
          '-c', `${s.dir}/mermaid.json`,
          '-p', `${s.dir}/puppeteer.json`,
          '-b', 'transparent',
          '-s', String(SCALE),
          '-q',
        ],
        { timeoutMs: RENDER_TIMEOUT_MS },
      )
      .catch(() => undefined)
    if (!result || result.exitCode !== 0) {
      return undefined
    }
  }
  const { base64 } = await $.fs.read(file, { as: 'bytes', length: 32 })
  const size = pngSize(base64)
  return size && { file, ...size }
}

// One render per diagram: the open and closed asks, and a fence repeated in
// another reply, share it. A failed render is tried again on the next ask.
function render($: EngineInterface, s: Setup, source: string): Promise<Picture | undefined> {
  const key = hash(JSON.stringify(MERMAID_CONFIG) + '\n' + source)
  let pending = renders.get(key)
  if (!pending) {
    pending = renderOnce($, s, key, source)
    renders.set(key, pending)
    void pending.then(p => {
      if (p === undefined) {
        renders.delete(key)
      }
    })
  }
  return pending
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const session = await $.session.id()
    if (session === guidedSession) {
      return next(e)
    }
    guidedSession = session
    const s = await getSetup($)
    return next({ ...e, context: [...(e.context ?? []), s.images ? GUIDANCE_IMAGES : GUIDANCE_TEXT] })
  })

  on(
    'ui.render',
    { component: 'CodeBlock', surface: 'terminal', props: { language: 'mermaid' } },
    async ($, e, next) => {
      if (e.component !== 'CodeBlock' || !e.props.isClosed) {
        return next(e)
      }
      const columns = Math.max(20, (e.viewport?.columns ?? 80) - 4)
      const s = await getSetup($)

      if (s.images) {
        const picture = await render($, s, e.props.source)
        if (picture) {
          const natural = Math.ceil(picture.width / SCALE / CELL_PX)
          let cols = Math.min(columns, natural, MAX_CELLS)
          let rows = Math.round((cols * picture.height) / picture.width / CELL_ASPECT)
          if (rows > MAX_CELLS) {
            cols = Math.max(1, Math.floor((cols * MAX_CELLS) / rows))
            rows = MAX_CELLS
          }
          const { Image } = $.ui.resolve(e)
          return (
            <Image
              source={{ file: picture.file, format: 'png' }}
              columns={cols}
              rows={Math.max(1, rows)}
              alt="mermaid diagram"
            />
          )
        }
      }

      const text = textDiagram(e.props.source, columns)
      return text === undefined ? next(e) : next({ ...e, props: { ...e.props, language: '', source: text } })
    },
  )
}
