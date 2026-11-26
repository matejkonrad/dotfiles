// Types for mermaid.mjs, the box-drawing renderer.
export function withDiagrams(markdown: string, columns: number, report?: (outcome: 'drawn' | 'kept' | 'threw') => void): string
export const mermaidFence: RegExp
export function remember(cache: Map<string, string>, key: string, value: string): void
