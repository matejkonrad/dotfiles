import type { Register } from 'claude-code'

import { mermaidFence, remember, withDiagrams } from './mermaid.mjs'

const DEFAULT_COLUMNS = 80

const GUIDANCE = {
  id: 'mermaid-terminal:guidance',
  scope: 'session',
  text: [
    '# Diagrams',
    'This terminal draws ```mermaid code fences in your replies as box-drawing diagrams.',
    'When a reply explains a flow, an architecture, a sequence of calls, or how parts connect, draw it as a mermaid `flowchart` or `sequenceDiagram` instead of ASCII art.',
    'Only flowchart/graph and sequenceDiagram are drawn; other mermaid types show as raw code.',
    'Keep node labels short (under about 30 characters) so the diagram fits a narrow pane, and prefer `flowchart TD` when there are more than four nodes.',
  ].join('\n'),
} as const

export const register: Register = on => {
  // Rendering is pure but not free, so cache by width + text.
  const cache = new Map<string, string>()

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, GUIDANCE] }
  })

  on(
    'ui.render',
    { component: 'AssistantMessage', surface: 'terminal', props: { text: mermaidFence } },
    ($, e, next) => {
      if (e.component !== 'AssistantMessage') {
        return next(e)
      }

      const columns = e.viewport?.columns ?? DEFAULT_COLUMNS
      const key = `${columns}\n${e.props.text}`
      const text = cache.get(key) ?? withDiagrams(e.props.text, columns)
      remember(cache, key, text)

      return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
    },
  )
}
