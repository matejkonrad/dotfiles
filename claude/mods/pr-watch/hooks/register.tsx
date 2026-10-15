import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { FailedCheck, PrComment, PrRef, PrStatus } from '../types'

const PANE = 'pr-watch'
const POLL_MS = 60_000
const COMMENTS_SHOWN = 8
const COMMENT_TEXT_CHARS = 1500
const NARROW_COLUMNS = 64
// The auto-fix lease lapses after three missed polls, so a closed session hands auto-fix to the next one.
const LEASE_MS = 3 * POLL_MS
const SCOPE_TTL_MS = 30 * 24 * 60 * 60_000

const prs = atom({ plugin: 'pr-watch', key: 'prs' } as const, [])
const selectedPr = atom({ plugin: 'pr-watch', key: 'selectedPr' } as const, null)
const openComment = atom({ plugin: 'pr-watch', key: 'openComment' } as const, null)
const autoFix = atom({ plugin: 'pr-watch', key: 'autoFix' } as const, [])
const scope = atom({ plugin: 'pr-watch', key: 'scope' } as const, null)
const showResolved = atom({ plugin: 'pr-watch', key: 'showResolved' } as const, false)

// Bots that only post noise (stack lists, deploy previews, migration reminders), not reviews.
const NOISE_AUTHORS = /graphite|vercel|github-actions|mergetron|linear/i
// Codex re-posts a status table on every run, and wraps its inline findings in a review whose body only
// introduces them; neither says anything the inline comments do not.
const NOISE_BODIES = /codex-pull-request-review-summary|^\s*#*\s*💡 Codex Review/
const FAILED_CONCLUSIONS = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
const PR_COMMANDS = /\b(gh pr create|gh pr edit|gh stack|gt submit|gt ss)\b/

const keyOf = (pr: PrRef) => `${pr.repo}#${pr.number}`

/** e.g. "framer/FramerCreatorsService#1039" → "FCS#1039", "framer/creators#5037" → "creators#5037" */
export function shortName(pr: PrRef): string {
  const repo = pr.repo.split('/').pop() ?? pr.repo
  const initials = repo.replace(/[^A-Z]/g, '')
  return `${repo.length > 12 && initials.length >= 2 ? initials : repo}#${pr.number}`
}

/** e.g. "framer/creators#5037", a github.com pull URL, or a Graphite PR URL. */
export function parsePrRefs(text: string, { urlsOnly = false } = {}): PrRef[] {
  const refs: PrRef[] = []
  const patterns = [
    /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g,
    /app\.graphite\.(?:dev|com)\/github\/pr\/([\w.-]+\/[\w.-]+)\/(\d+)/g,
    ...(urlsOnly ? [] : [/(?:^|\s)([\w.-]+\/[\w.-]+)#(\d+)/g]),
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const [, repo, number] = match
      if (!repo || !number) continue
      const ref = { repo, number: Number(number) }
      if (!refs.some(one => keyOf(one) === keyOf(ref))) refs.push(ref)
    }
  }
  return refs
}

type GhCheck = {
  conclusion?: string | null
  status?: string | null
  state?: string | null
  name?: string
  context?: string
  detailsUrl?: string | null
  targetUrl?: string | null
}
type GhComment = { author?: { login?: string } | null; body?: string; url?: string; createdAt?: string }
type GhReview = { author?: { login?: string } | null; body?: string; submittedAt?: string }
type GhPr = {
  title: string
  url: string
  state: string
  isDraft: boolean
  reviewDecision: string | null
  baseRefName?: string
  headRefName?: string
  statusCheckRollup: GhCheck[] | null
  comments: GhComment[] | null
  reviews: GhReview[] | null
}
/** One review thread from GitHub's GraphQL API, with its first comment: the finding itself. */
export type GhThread = {
  isResolved: boolean
  path: string | null
  line: number | null
  comments: { nodes: { author: { login: string } | null; body: string; url: string; createdAt: string }[] }
}
type GhPrDetails = {
  mergeStateStatus: string
  additions: number
  deletions: number
  changedFiles: number
  reviewThreads: { nodes: GhThread[] }
}

const PR_DETAILS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      mergeStateStatus additions deletions changedFiles
      reviewThreads(first: 100) {
        nodes { isResolved path line comments(first: 1) { nodes { author { login } body url createdAt } } }
      }
    }
  }
}`

export function summarizeChecks(rollup: GhCheck[]): PrStatus['checks'] {
  const checks: PrStatus['checks'] = { passed: 0, pending: 0, failed: [] }
  // Notice: a re-run adds a second entry under the same name, and gh lists the latest one last.
  const latestByName = new Map(rollup.map(check => [check.name ?? check.context ?? 'check', check]))
  for (const check of latestByName.values()) {
    const outcome = check.conclusion ?? check.state ?? ''
    if ((check.status && check.status !== 'COMPLETED') || outcome === 'PENDING' || outcome === 'EXPECTED') {
      checks.pending++
      continue
    }
    if (FAILED_CONCLUSIONS.has(outcome)) {
      const failed: FailedCheck = {
        name: check.name ?? check.context ?? 'check',
        url: check.detailsUrl ?? check.targetUrl ?? null,
      }
      checks.failed.push(failed)
      continue
    }
    checks.passed++
  }
  return checks
}

/**
 * Every review comment from someone other than the author: unresolved threads first, then PR comments, review
 * bodies and resolved threads, newest first within each.
 */
export function collectComments(pr: GhPr, threads: GhThread[], me: string): PrComment[] {
  const all: PrComment[] = [
    ...(pr.comments ?? []).map(one => ({
      author: one.author?.login ?? '',
      body: one.body ?? '',
      url: one.url ?? pr.url,
      createdAt: one.createdAt ?? '',
      location: null,
      isResolved: null,
      isNew: false,
    })),
    ...(pr.reviews ?? []).map(one => ({
      author: one.author?.login ?? '',
      body: one.body ?? '',
      url: pr.url,
      createdAt: one.submittedAt ?? '',
      location: null,
      isResolved: null,
      isNew: false,
    })),
    ...threads.flatMap(thread => {
      const [first] = thread.comments.nodes
      if (!first) return []
      return [
        {
          author: first.author?.login ?? '',
          body: first.body,
          url: first.url,
          createdAt: first.createdAt,
          // An outdated thread has no line any more, so we show the file alone.
          location: thread.path ? (thread.line ? `${thread.path}:${thread.line}` : thread.path) : null,
          isResolved: thread.isResolved,
          isNew: false,
        },
      ]
    }),
  ]
  return all
    .filter(
      one =>
        one.author !== '' &&
        one.author !== me &&
        !NOISE_AUTHORS.test(one.author) &&
        one.body.trim() !== '' &&
        !NOISE_BODIES.test(one.body),
    )
    .sort((a, b) => {
      const aOpen = a.isResolved === false ? 0 : 1
      const bOpen = b.isResolved === false ? 0 : 1
      return aOpen - bOpen || b.createdAt.localeCompare(a.createdAt)
    })
}

/**
 * A PR-level bot comment that is only a verdict on the whole PR, not a finding: "No issues found", "Approval
 * recommended", "Auto-approved". We show these on one line instead of as review items.
 */
export function isVerdict(comment: PrComment): boolean {
  if (comment.isResolved !== null) return false
  const firstLine = commentPlainText(comment.body).split('\n')[0] ?? ''
  return /no (major )?issues|didn't find any|approv|lgtm|looks good|bravo|changes recommended|found \d+ (potential )?issues?/i.test(
    firstLine,
  )
}

/**
 * e.g. "✅ Devin Review: No Issues Found" → no issues (good), "Devin Review found 2 potential issues." → 2 issues
 * (attention), "🟡 Changes recommended" → changes recommended (attention)
 */
export function verdictText(comment: PrComment): { text: string; isGood: boolean } {
  const firstLine = (commentPlainText(comment.body).split('\n')[0] ?? '').toLowerCase()
  const found = /found (\d+) (potential )?issues?/.exec(firstLine)
  if (found) return { text: `${found[1]} ${found[1] === '1' ? 'issue' : 'issues'}`, isGood: false }
  if (/changes recommended/.test(firstLine)) return { text: 'changes recommended', isGood: false }
  if (/no (major )?issues|didn't find any/.test(firstLine)) return { text: 'no issues', isGood: true }
  if (/auto-?approved/.test(firstLine)) return { text: 'auto-approved', isGood: true }
  if (/approv/.test(firstLine)) return { text: 'approval recommended', isGood: true }
  return { text: 'looks good', isGood: true }
}

/** e.g. CLEAN → "ready to merge", DIRTY → "merge conflicts", BEHIND → "behind base" */
export function mergeReadiness(pr: Pick<PrStatus, 'state' | 'isDraft' | 'mergeState'>): {
  text: string
  tone: 'success' | 'error' | 'warning' | 'inactive'
} {
  if (pr.state === 'MERGED') return { text: 'merged', tone: 'inactive' }
  if (pr.state === 'CLOSED') return { text: 'closed', tone: 'inactive' }
  if (pr.isDraft) return { text: 'draft', tone: 'inactive' }
  switch (pr.mergeState) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { text: 'ready to merge', tone: 'success' }
    case 'DIRTY':
      return { text: 'merge conflicts', tone: 'error' }
    case 'BEHIND':
      return { text: 'behind base', tone: 'warning' }
    case 'BLOCKED':
      return { text: 'blocked', tone: 'warning' }
    case 'UNSTABLE':
      return { text: 'checks not passing', tone: 'warning' }
    default:
      return { text: 'merge state unknown', tone: 'inactive' }
  }
}

/** e.g. "https://github.com/o/r/actions/runs/38265379047/job/1148" → "38265379047" */
export function runIdOfCheck(url: string | null): string | null {
  return url ? (/\/actions\/runs\/(\d+)/.exec(url)?.[1] ?? null) : null
}

/** e.g. "chatgpt-codex-connector[bot]" → "codex" */
export function shortAuthor(login: string): string {
  const known: Record<string, string> = {
    'chatgpt-codex-connector': 'codex',
    'devin-ai-integration': 'devin',
    'copilot-pull-request-reviewer': 'copilot',
  }
  const name = login.replace(/\[bot\]$/, '')
  return known[name] ?? name
}

/** The comment as plain text paragraphs: no HTML, badges, images or tables. */
export function commentPlainText(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<details[\s\S]*?<\/details>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(line => line.replace(/^#+\s*/, '').replace(/\*\*|__/g, '').replace(/[ \t]+/g, ' ').trim())
    .filter(
      line =>
        !line.startsWith('|') &&
        !/^Reviewed commit/i.test(line) &&
        !/^-{3,}$/.test(line) &&
        !/was this helpful|react with 👍/i.test(line),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * A review comment's priority badge and its first real sentence.
 * e.g. "**<sub><sub>![P1 Badge](…)</sub></sub>  Preserve expert eligibility**\n\nWhen…" → { priority: "P1", text: "Preserve expert eligibility" }
 */
const EMOJI_PRIORITY: Record<string, string> = { '🔴': 'P1', '🟠': 'P1', '🟡': 'P2', '🟢': 'P3' }

export function summarizeComment(body: string): { priority: string | null; text: string } {
  const firstLine = commentPlainText(body).split('\n').find(line => line !== '') ?? ''
  const badge = /!\[(P\d) Badge\]/.exec(body)?.[1] ?? null
  // Devin marks severity with a leading emoji instead of a badge.
  const emoji = /^(🔴|🟠|🟡|🟢)\s*/u.exec(firstLine)
  const emojiPriority = emoji ? (EMOJI_PRIORITY[emoji[1] ?? ''] ?? null) : null
  return { priority: badge ?? emojiPriority, text: emoji ? firstLine.slice(emoji[0].length) : firstLine }
}

/** Orders PRs by repo, and inside a repo as stacks: a PR whose base is another PR's branch follows it, one level deeper. */
export function orderAsStacks(list: PrStatus[]): { repo: string; rows: { pr: PrStatus; depth: number }[] }[] {
  const repos = [...new Set(list.map(one => one.repo))]
  return repos.map(repo => {
    const inRepo = list.filter(one => one.repo === repo)
    const byHead = new Map(inRepo.map(one => [one.headRef, one]))
    const rows: { pr: PrStatus; depth: number }[] = []
    const visit = (pr: PrStatus, depth: number) => {
      rows.push({ pr, depth })
      for (const child of inRepo.filter(one => one.baseRef === pr.headRef && one !== pr)) visit(child, depth + 1)
    }
    for (const root of inRepo.filter(one => !byHead.has(one.baseRef))) visit(root, 0)
    return { repo, rows }
  })
}

/** Cuts text to `width` cells with an ellipsis, and pads it to exactly `width`. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  const chars = [...text]
  if (chars.length <= width) return text + ' '.repeat(width - chars.length)
  return `${chars.slice(0, Math.max(0, width - 1)).join('')}…`
}

function timeAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (Number.isNaN(minutes)) return ''
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 60 / 24)}d ago`
}

/** e.g. 0 → "", 1 → " 1 comment", 3 → " 3 comments" */
function commentCount(count: number): string {
  if (count === 0) return ''
  return ` ${count} comment${count === 1 ? '' : 's'}`
}

// Gruvbox Material dark, the palette of the terminal, nvim and herdr. Colored text on the pane's own background, no
// filled chips: a filled block in a saturated color is louder than anything it labels.
const GRUV = {
  fg: '#d4be98',
  grey: '#928374',
  faint: '#5a524c',
  selection: '#3c3836',
  red: '#ea6962',
  orange: '#e78a4e',
  yellow: '#d8a657',
  green: '#a9b665',
  aqua: '#89b482',
  purple: '#d3869b',
} as const

type CiState = 'merged' | 'closed' | 'gh error' | 'failing' | 'running' | 'passing'

function ciChip(pr: PrStatus): { state: CiState; label: string; color: string } {
  const chip = (state: CiState, glyph: string, color: string) => ({ state, label: `${glyph} ${state}`, color })
  if (pr.state === 'MERGED') return chip('merged', '●', GRUV.purple)
  if (pr.state === 'CLOSED') return chip('closed', '○', GRUV.grey)
  if (pr.error) return chip('gh error', '!', GRUV.red)
  if (pr.checks.failed.length > 0) return chip('failing', '✗', GRUV.red)
  if (pr.checks.pending > 0) return chip('running', '◐', GRUV.yellow)
  return chip('passing', '✓', GRUV.green)
}

/** e.g. "P0" → 0, "P2" → 2, no priority → after every priority */
function priorityRank(priority: string | null): number {
  return priority ? Number(priority.slice(1)) : 9
}

function toneColor(tone: ReturnType<typeof mergeReadiness>['tone']): string {
  return { success: GRUV.green, error: GRUV.red, warning: GRUV.orange, inactive: GRUV.grey }[tone]
}

function priorityColor(priority: string): string {
  if (priority === 'P0' || priority === 'P1') return GRUV.red
  if (priority === 'P2') return GRUV.orange
  return GRUV.aqua
}

/** e.g. "+120 −30 · 8 files", or "" before GitHub said */
function diffSize(pr: PrStatus): string {
  if (pr.additions + pr.deletions === 0) return ''
  return `+${pr.additions} −${pr.deletions} · ${pr.changedFiles} ${pr.changedFiles === 1 ? 'file' : 'files'}`
}

/** e.g. "CHANGES_REQUESTED" → "changes requested", "" → "no review yet" */
function reviewText(pr: PrStatus): string {
  return pr.reviewDecision ? pr.reviewDecision.toLowerCase().replace(/_/g, ' ') : 'no review yet'
}

/** One verdict per reviewer, its newest, and the findings: open threads, then PR-level comments, then resolved threads. */
function splitComments(pr: PrStatus): { verdicts: PrComment[]; findings: PrComment[] } {
  const verdicts = pr.comments
    .filter(isVerdict)
    .filter((one, index, all) => all.findIndex(other => other.author === one.author) === index)
  const findings = pr.comments
    .filter(one => !isVerdict(one))
    .map((one, index) => ({ one, index, priority: priorityRank(summarizeComment(one.body).priority) }))
    .sort((a, b) => threadRank(a.one) - threadRank(b.one) || a.priority - b.priority || a.index - b.index)
    .map(entry => entry.one)
  return { verdicts, findings }
}

function threadRank(comment: PrComment): number {
  return comment.isResolved === false ? 0 : comment.isResolved === null ? 1 : 2
}

/** What auto-fix already asked about per PR, so one failure or comment starts one turn, not one per poll. */
type AutoFixHandled = Record<string, { failedChecks: string; newestComment: string }>

/** e.g. "Test, lint" → a prompt asking Claude to read the logs and fix the cause, without pushing. */
export function ciFixPrompt(pr: PrStatus): string {
  const checks = pr.checks.failed.map(check => (check.url ? `${check.name} (${check.url})` : check.name)).join(', ')
  return [
    `pr-watch auto-fix: CI failed on ${keyOf(pr)} "${pr.title}": ${checks}.`,
    `Read the failed logs (gh run view --log-failed, or the links), find the cause, and fix it on branch ${pr.headRef}.`,
    'Run the related tests. Do not push until I confirm.',
  ].join('\n')
}

/** A prompt listing the unread review comments, asking Claude to judge and fix them, without replying or pushing. */
export function reviewFixPrompt(pr: PrStatus): string {
  const lines = pr.comments.filter(comment => comment.isNew && !isVerdict(comment)).map(comment => {
    const { priority, text } = summarizeComment(comment.body)
    const where = comment.location ? `, ${comment.location}` : ''
    return `- ${priority ? `${priority} ` : ''}${text} (${shortAuthor(comment.author)}${where}) ${comment.url}`
  })
  return [
    `pr-watch auto-fix: new review comments on ${keyOf(pr)} "${pr.title}":`,
    ...lines,
    `Check each one against the code. Fix the valid ones on branch ${pr.headRef}, and tell me which you skipped and why.`,
    'Do not reply to or resolve the threads. Do not push until I confirm.',
  ].join('\n')
}

/** e.g. herdr workspace "w1V" and worktree "/src/app-wt" → "herdr:w1V|/src/app-wt"; outside herdr → "/src/app-wt" */
export function scopeKey(workspace: string | null, worktree: string): string {
  return workspace ? `herdr:${workspace}|${worktree}` : worktree
}

/** e.g. "herdr:w1V|/src/app-wt" → "w1V · app-wt" */
export function scopeLabel(key: string): string {
  const [workspace, worktree = key] = key.startsWith('herdr:') ? key.slice('herdr:'.length).split('|') : [null, key]
  const folder = worktree.split('/').filter(Boolean).pop() ?? worktree
  return workspace ? `${workspace} · ${folder}` : folder
}

/** Whether this session may start auto-fix turns: nobody holds the lease, this session does, or the holder went quiet. */
export function mayHoldLease(lease: AutoFixLease | null, sessionId: string, now: number): boolean {
  return lease === null || lease.sessionId === sessionId || now - lease.at > LEASE_MS
}

type AutoFixLease = { sessionId: string; at: number }

// Notice: a scope's store keys are written by one function each (watched by addRefs/removeRefs, seenAt by markSeen,
// autoFix by setAutoFix and removeRefs, autoFixHandled and lease by runAutoFix), so two sessions in one scope do not overwrite each
// other's field with a stale copy of the whole scope.
const storeKey = (field: 'watched' | 'seenAt' | 'autoFix' | 'autoFixHandled' | 'lease', scope: string) => `${field}:${scope}`

let cachedScope: { root: string; key: string } | null = null

/** The herdr workspace and git worktree this session runs in: every list, read mark and auto-fix belongs to it. */
async function currentScope($: EngineInterface): Promise<string> {
  const root = await $.session.root()
  if (cachedScope?.root === root) return cachedScope.key
  const herdrEnv = await $.env.get('HERDR_ENV')
  const workspace = herdrEnv === '1' ? ((await $.env.get('HERDR_WORKSPACE_ID')) ?? null) : null
  const git = await $.process.run(['git', '-C', root, 'rev-parse', '--show-toplevel'], { timeoutMs: 5_000 })
  const worktree = git.exitCode === 0 ? git.stdout.trim() : root
  cachedScope = { root, key: scopeKey(workspace, worktree) }
  return cachedScope.key
}

/** Drops the old global keys and the scopes no session opened for SCOPE_TTL_MS. */
async function pruneStore($: EngineInterface, scope: string): Promise<void> {
  for (const legacy of ['watched', 'seenAt', 'autoFixPrs', 'autoFixHandled']) await $.store.delete(legacy)
  const now = await $.clock.now()
  // Notice: the store holds JSON, and only this function writes this key.
  const scopes = ((await $.store.get('scopes')) ?? {}) as Record<string, number>
  scopes[scope] = now
  for (const [key, usedAt] of Object.entries(scopes)) {
    if (now - usedAt <= SCOPE_TTL_MS) continue
    delete scopes[key]
    for (const field of ['watched', 'seenAt', 'autoFix', 'autoFixHandled', 'lease'] as const) {
      await $.store.delete(storeKey(field, key))
    }
  }
  await $.store.set('scopes', scopes)
}

async function runAutoFix($: EngineInterface, list: PrStatus[], claim = false): Promise<void> {
  const autoFixKeys = await read($, autoFix)
  if (autoFixKeys.length === 0) return
  const scope = await currentScope($)
  const sessionId = await $.session.id()
  const now = await $.clock.now()
  // Notice: two sessions in one worktree (a fork, a second tab) would each start the same fix turn; the one holding
  // the lease alone does, and renews it every poll. Turning auto-fix on takes the lease.
  // Notice: the store holds JSON, and only this function writes this key.
  const lease = ((await $.store.get(storeKey('lease', scope))) ?? null) as AutoFixLease | null
  if (!claim && !mayHoldLease(lease, sessionId, now)) return
  await $.store.set(storeKey('lease', scope), { sessionId, at: now })
  // Notice: the store holds JSON, and only this function writes this key.
  const handled = ((await $.store.get(storeKey('autoFixHandled', scope))) ?? {}) as AutoFixHandled
  for (const pr of list.filter(one => one.state === 'OPEN' && !one.error && autoFixKeys.includes(keyOf(one)))) {
    const key = keyOf(pr)
    const done = handled[key] ?? { failedChecks: '', newestComment: '' }
    const failedChecks = pr.checks.failed.map(check => check.name).sort().join(',')
    if (failedChecks !== '' && failedChecks !== done.failedChecks) {
      void $.prompt.submit({ text: ciFixPrompt(pr) })
    }
    // Notice: a verdict ("no issues", "approved") gives Claude nothing to fix, so only new findings start a turn.
    const newest = pr.comments
      .filter(one => one.isNew && !isVerdict(one))
      .reduce((max, one) => (one.createdAt > max ? one.createdAt : max), '')
    if (newest !== '' && newest > done.newestComment) {
      void $.prompt.submit({ text: reviewFixPrompt(pr) })
    }
    handled[key] = { failedChecks, newestComment: newest > done.newestComment ? newest : done.newestComment }
  }
  await $.store.set(storeKey('autoFixHandled', scope), handled)
}

async function setAutoFix($: EngineInterface, key: string, isOn: boolean): Promise<void> {
  const keys = await update($, autoFix, current =>
    isOn ? [...current.filter(one => one !== key), key] : current.filter(one => one !== key),
  )
  await $.store.set(storeKey('autoFix', await currentScope($)), keys)
  const name = shortName(parsePrRefs(key)[0] ?? { repo: key, number: 0 })
  $.ui.toast(isOn ? `Auto-fix on for ${name}: new CI failures and review comments start a turn here` : `Auto-fix off for ${name}`)
  if (isOn) await runAutoFix($, await read($, prs), true)
}

async function readAutoFix($: EngineInterface): Promise<string[]> {
  const value = await $.store.get(storeKey('autoFix', await currentScope($)))
  // Notice: the store holds JSON, and only setAutoFix and removeRefs write this key.
  return Array.isArray(value) ? (value as string[]) : []
}

let me = ''

async function watched($: EngineInterface): Promise<PrRef[]> {
  const value = await $.store.get(storeKey('watched', await currentScope($)))
  // Notice: the store holds JSON, and only addRefs and removeRefs write this key.
  return Array.isArray(value) ? (value as PrRef[]) : []
}

async function readSeenAt($: EngineInterface): Promise<Record<string, string>> {
  // Notice: the store holds JSON, and only markSeen writes this key.
  return ((await $.store.get(storeKey('seenAt', await currentScope($)))) ?? {}) as Record<string, string>
}

async function fetchStatus(
  $: EngineInterface,
  pr: PrRef,
  seenAt: Record<string, string>,
  previous: PrStatus | undefined,
): Promise<PrStatus> {
  const fields = 'title,url,state,isDraft,reviewDecision,baseRefName,headRefName,statusCheckRollup,comments,reviews'
  const [owner = '', name = ''] = pr.repo.split('/')
  const [view, graphql] = await Promise.all([
    $.process.run(['gh', 'pr', 'view', String(pr.number), '-R', pr.repo, '--json', fields], { timeoutMs: 30_000 }),
    $.process.run(
      ['gh', 'api', 'graphql', '-f', `query=${PR_DETAILS_QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${pr.number}`],
      { timeoutMs: 30_000 },
    ),
  ])
  if (view.exitCode !== 0) {
    const error = view.stderr.trim().split('\n')[0] || `gh exited ${view.exitCode}`
    // Notice: a failed poll (rate limit, network) keeps what we last knew; a stub saying OPEN would put a closed PR
    // back on the bar.
    if (previous) return { ...previous, error }
    return {
      ...pr,
      title: '',
      url: `https://github.com/${pr.repo}/pull/${pr.number}`,
      state: 'UNKNOWN',
      isDraft: false,
      reviewDecision: '',
      baseRef: '',
      headRef: '',
      mergeState: '',
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      checks: { passed: 0, pending: 0, failed: [] },
      comments: [],
      unresolvedThreads: 0,
      newComments: 0,
      error,
    }
  }
  const data: GhPr = JSON.parse(view.stdout) // gh's own --json output
  // The GraphQL call only adds threads and merge state; when it fails the row still shows CI and comments.
  const details: GhPrDetails | null =
    graphql.exitCode === 0 ? (JSON.parse(graphql.stdout).data?.repository?.pullRequest ?? null) : null
  const threads = details?.reviewThreads.nodes ?? []
  const seen = seenAt[keyOf(pr)] ?? ''
  const comments = collectComments(data, threads, me).map(one => ({ ...one, isNew: one.createdAt > seen }))
  return {
    ...pr,
    title: data.title,
    url: data.url,
    state: data.state,
    isDraft: data.isDraft,
    reviewDecision: data.reviewDecision ?? '',
    baseRef: data.baseRefName ?? '',
    headRef: data.headRefName ?? '',
    mergeState: details?.mergeStateStatus ?? '',
    additions: details?.additions ?? 0,
    deletions: details?.deletions ?? 0,
    changedFiles: details?.changedFiles ?? 0,
    checks: summarizeChecks(data.statusCheckRollup ?? []),
    comments,
    unresolvedThreads: threads.filter(thread => !thread.isResolved).length,
    newComments: comments.filter(one => one.isNew).length,
    error: null,
  }
}

let refreshing: Promise<void> | null = null
let refreshAgain = false

/** One poll at a time: a call during a poll waits for it and one more, which then sees the caller's change. */
function refresh($: EngineInterface): Promise<void> {
  if (refreshing) {
    refreshAgain = true
    return refreshing
  }
  refreshing = (async () => {
    do {
      refreshAgain = false
      await refreshOnce($)
    } while (refreshAgain)
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

async function refreshOnce($: EngineInterface): Promise<void> {
  const scopeNow = await currentScope($)
  if ((await read($, scope)) !== scopeNow) {
    // Notice: the session moved to another worktree (/cd, EnterWorktree): its list and auto-fix are that scope's.
    await update($, scope, () => scopeNow)
    await update($, prs, () => [])
    await update($, selectedPr, () => null)
    const keys = await readAutoFix($)
    await update($, autoFix, () => keys)
  }
  if (!me) {
    const who = await $.process.run(['gh', 'api', 'user', '--jq', '.login'])
    me = who.exitCode === 0 ? who.stdout.trim() : ''
  }
  const refs = await watched($)
  const seenAt = await readSeenAt($)
  const before = new Map((await read($, prs)).map(one => [keyOf(one), one]))
  const polled = await Promise.all(refs.map(ref => fetchStatus($, ref, seenAt, before.get(keyOf(ref)))))
  // Notice: a PR removed while the poll ran must not come back with its result.
  const stillWatched = new Set((await watched($)).map(keyOf))
  const fresh = polled.filter(one => stillWatched.has(keyOf(one)))

  for (const status of fresh) {
    const previous = before.get(keyOf(status))
    if (!previous || status.error) continue
    if (status.checks.failed.length > previous.checks.failed.length) {
      $.ui.toast(`${shortName(status)}: ${status.checks.failed.map(check => check.name).join(', ')} failed`)
    } else if (previous.checks.pending > 0 && status.checks.pending === 0 && status.checks.failed.length === 0) {
      $.ui.toast(`${shortName(status)}: CI passing`)
    }
    if (status.newComments > previous.newComments) {
      const latest = status.comments.filter(one => one.isNew).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      $.ui.toast(`${shortName(status)}: new comment from ${shortAuthor(latest?.author ?? 'a reviewer')}`)
    }
  }

  await update($, prs, () => fresh)
  if ((await read($, selectedPr)) === null && fresh[0]) {
    const first = fresh.find(one => one.checks.failed.length > 0 || one.newComments > 0) ?? fresh[0]
    await update($, selectedPr, () => keyOf(first))
  }
  // Notice: the bar above the prompt shows this now; an older load of the mod may have left a status line.
  $.ui.status(undefined)
  await runAutoFix($, fresh)
}

async function addRefs($: EngineInterface, refs: PrRef[]): Promise<PrRef[]> {
  const current = await watched($)
  const added = refs.filter(ref => !current.some(one => keyOf(one) === keyOf(ref)))
  if (added.length > 0) await $.store.set(storeKey('watched', await currentScope($)), [...current, ...added])
  return added
}

async function removeRefs($: EngineInterface, refs: PrRef[]): Promise<void> {
  const keys = new Set(refs.map(keyOf))
  const kept = (await watched($)).filter(one => !keys.has(keyOf(one)))
  await $.store.set(storeKey('watched', await currentScope($)), kept)
  // The bar and pane drop it now, not after the next poll.
  await update($, prs, list => list.filter(one => !keys.has(keyOf(one))))
  await update($, selectedPr, current => (current !== null && keys.has(current) ? null : current))
  const autoFixKeys = await read($, autoFix)
  if (autoFixKeys.some(one => keys.has(one))) {
    const kept = await update($, autoFix, current => current.filter(one => !keys.has(one)))
    await $.store.set(storeKey('autoFix', await currentScope($)), kept)
  }
}

async function markSeen($: EngineInterface, keys: string[] | null): Promise<void> {
  const seenAt = await readSeenAt($)
  const now = new Date(await $.clock.now()).toISOString()
  for (const one of await read($, prs)) {
    if (keys === null || keys.includes(keyOf(one))) seenAt[keyOf(one)] = now
  }
  await $.store.set(storeKey('seenAt', await currentScope($)), seenAt)
  await refresh($)
}

async function openUrl($: EngineInterface, url: string): Promise<void> {
  await $.process.run(['open', url])
}

/** Re-runs only the failed jobs of every workflow run behind the PR's failed checks. */
async function rerunFailedChecks($: EngineInterface, pr: PrStatus): Promise<void> {
  const runIds = [...new Set(pr.checks.failed.map(check => runIdOfCheck(check.url)).filter(id => id !== null))]
  if (runIds.length === 0) {
    $.ui.toast(`${shortName(pr)}: no GitHub Actions run to re-run`)
    return
  }
  const results = await Promise.all(runIds.map(id => $.process.run(['gh', 'run', 'rerun', id, '--failed', '-R', pr.repo])))
  const failed = results.filter(run => run.exitCode !== 0)
  $.ui.toast(
    failed.length === 0
      ? `${shortName(pr)}: re-running failed checks`
      : `${shortName(pr)}: re-run failed: ${failed[0]?.stderr.trim().split('\n')[0] ?? ''}`,
  )
  await refresh($)
}

async function markReadyForReview($: EngineInterface, pr: PrStatus): Promise<void> {
  const run = await $.process.run(['gh', 'pr', 'ready', String(pr.number), '-R', pr.repo])
  $.ui.toast(run.exitCode === 0 ? `${shortName(pr)}: ready for review` : `${shortName(pr)}: ${run.stderr.trim().split('\n')[0] ?? ''}`)
  await refresh($)
}

/** Starts a turn about one review comment, so Claude judges and fixes just that finding. */
export function commentFixPrompt(pr: PrStatus, comment: PrComment): string {
  const where = comment.location ? ` on ${comment.location}` : ''
  return [
    `Review comment from ${shortAuthor(comment.author)} on ${keyOf(pr)} "${pr.title}"${where} (${comment.url}):`,
    '',
    commentPlainText(comment.body),
    '',
    `Check whether it is right. If it is, fix it on branch ${pr.headRef} and run the related tests; if not, tell me why.`,
    'Do not reply to or resolve the thread. Do not push until I confirm.',
  ].join('\n')
}

function openPane($: EngineInterface, focus?: true): Promise<unknown> {
  return $.ui.open({ id: PANE, title: 'Pull requests', focus })
}

let isTui = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The desktop app tracks PRs itself, so the mod stays out of every session no terminal draws: no pane, polls or tool.
    isTui = (await $.session.surfaces()).includes('terminal')
    if (!isTui) return next(e)
    await $.command.register({
      name: 'pr-watch',
      description: 'Watch PRs: /pr-watch [<ref>] [add|remove <refs>] [auto <ref> on|off] [seen] [clear] [refresh]',
    })
    await $.tool.register({
      name: 'watch_prs',
      description:
        "Adds or removes pull requests on the person's PR watch pane for this herdr workspace and git worktree, which polls " +
        'CI, review state and review comments. ' +
        'Call it with action "add" after opening PRs, and "list" to read every watched PR\'s checks and comments. ' +
        'Refs: "owner/repo#123" or PR URLs.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'remove', 'list'] },
          prs: { type: 'array', items: { type: 'string' } },
        },
        required: ['action'],
      },
      isDeferred: false,
    })
    await pruneStore($, await currentScope($))
    $.clock.every(POLL_MS, () => void refresh($))
    void refresh($)
    if ((await watched($)).length > 0) void openPane($)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__pr-watch__watch_prs' }, async ($, e) => {
    const action = 'action' in e ? String(e.action) : 'list'
    const refs = 'prs' in e && Array.isArray(e.prs) ? parsePrRefs(e.prs.join(' ')) : []
    if (action === 'add') {
      const added = await addRefs($, refs)
      void openPane($)
      await refresh($)
      return { result: added.length > 0 ? `Watching ${added.map(keyOf).join(', ')}.` : 'Already watching those PRs.' }
    }
    if (action === 'remove') {
      await removeRefs($, refs)
      return { result: `Stopped watching ${refs.map(keyOf).join(', ')}.` }
    }
    return { result: JSON.stringify(await read($, prs), null, 2) }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isTui) return next(e)
    const ran = await next(e)
    const command = 'command' in e ? e.command : ''
    if (ran.deny !== undefined || !PR_COMMANDS.test(command)) return ran
    // Notice: the command already ran; a failure to watch its PR must not turn into a failed Bash call.
    const added = await addRefs($, parsePrRefs(JSON.stringify(ran.result ?? ''), { urlsOnly: true })).catch(() => [])
    if (added.length > 0) {
      $.ui.toast(`Watching ${added.map(shortName).join(', ')}`)
      void openPane($)
      void refresh($)
    }
    return ran
  })

  on('command.run', { command: 'pr-watch' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const refs = parsePrRefs(rest.join(' '))
    if (verb === 'add') {
      const added = await addRefs($, refs)
      await refresh($)
      return { text: added.length > 0 ? `Watching ${added.map(keyOf).join(', ')}.` : 'Nothing new to watch.' }
    }
    if (verb === 'remove') {
      await removeRefs($, refs)
      return { text: `Stopped watching ${refs.map(keyOf).join(', ')}.` }
    }
    if (verb === 'clear') {
      await removeRefs($, await watched($))
      return { text: 'Stopped watching every PR.' }
    }
    if (verb === 'seen') {
      await markSeen($, null)
      return { text: 'Marked every comment as read.' }
    }
    if (verb === 'auto') {
      const [target] = refs
      if (!target && rest.includes('off')) {
        for (const key of await read($, autoFix)) await setAutoFix($, key, false)
        return { text: 'Auto-fix off for every PR.' }
      }
      if (!target) return { text: 'Usage: /pr-watch auto owner/repo#123 [on|off], or /pr-watch auto off' }
      const key = keyOf(target)
      const isOn = rest.includes('off') ? false : rest.includes('on') ? true : !(await read($, autoFix)).includes(key)
      await setAutoFix($, key, isOn)
      return { text: `Auto-fix ${isOn ? 'on' : 'off'} for ${key}.` }
    }
    if (verb === 'refresh') {
      await refresh($)
      return { text: 'Refreshed.' }
    }
    // `/pr-watch framer/creators#5037` jumps to that PR.
    const [jumpTo] = parsePrRefs(e.args)
    if (jumpTo) await update($, selectedPr, () => keyOf(jumpTo))
    await openPane($, true)
    return { text: 'PR watch pane opened with the keyboard: Tab moves, Esc goes back to the prompt.' }
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const element = e.element ?? null
    const prKey = element?.startsWith('pr:') ? element.slice('pr:'.length) : null
    if (prKey) await update($, selectedPr, () => prKey)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = (await read($, prs)).filter(one => one.state === 'OPEN')
    if (e.surface !== 'terminal' || e.props.hasSurvey || list.length === 0) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 80
    const autoFixKeys = await read($, autoFix)
    const openOn = (key: string) => async () => {
      await update($, selectedPr, () => key)
      await openPane($, true)
    }

    // Each PR chip takes about 12 cells; when they do not fit, we show one chip per CI state instead.
    const fitsEveryPr = list.length * 12 + 10 < columns

    if (!fitsEveryPr) {
      return (
        <Box gap={1}>
          <Text color={GRUV.grey}>PRs</Text>
          {(['failing', 'running', 'passing'] as const).map(state => {
            const inState = list.filter(pr => ciChip(pr).state === state)
            const [first] = inState
            if (!first) return null
            const chip = ciChip(first)
            return (
              <Button plain key={`bar:${state}`} onPress={openOn(keyOf(first))}>
                <Text color={chip.color}>{`${chip.label.split(' ')[0]} ${inState.length} ${state}`}</Text>
              </Button>
            )
          })}
        </Box>
      )
    }

    return (
      <Box gap={1}>
        <Text color={GRUV.grey}>PRs</Text>
        {list.map(pr => {
          const chip = ciChip(pr)
          return (
            <Button plain key={`bar:${keyOf(pr)}`} onPress={openOn(keyOf(pr))}>
              <Text color={chip.color}>{chip.label.split(' ')[0]} </Text>
              <Text color={GRUV.fg}>#{pr.number}</Text>
              {pr.newComments > 0 && <Text color={GRUV.aqua}> +{pr.newComments}</Text>}
              {autoFixKeys.includes(keyOf(pr)) && <Text color={GRUV.purple}> auto</Text>}
            </Button>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, prs)
    const selectedKey = await read($, selectedPr)
    const openCommentKey = await read($, openComment)
    const now = await $.clock.now()

    const columns = Math.max(30, e.props.bodyColumns - 1)
    const isNarrow = columns < NARROW_COLUMNS

    if (list.length === 0) {
      return <Text color={GRUV.grey}>No pull requests watched in this worktree. Run /pr-watch add owner/repo#123</Text>
    }

    const selected = list.find(one => keyOf(one) === selectedKey) ?? list[0]
    const rule = <Text color={GRUV.faint}>{'─'.repeat(columns)}</Text>
    const scopeKeyNow = await read($, scope)

    const autoFixKeys = await read($, autoFix)
    const commentsWidth = 12
    const chipWidth = 10

    const prRow = (pr: PrStatus, depth: number) => {
      const key = keyOf(pr)
      const isSelected = selected !== undefined && key === keyOf(selected)
      const chip = ciChip(pr)
      const indent = depth > 0 ? `${'  '.repeat(depth - 1)}↳ ` : ''
      const indentWidth = [...indent].length
      const select = () => void update($, selectedPr, () => key)
      // The selected row: an aqua bar in the gutter and a lifted number, no filled block.
      const numberText = (
        <Text>
          <Text color={GRUV.aqua}>{isSelected ? '▌' : ' '}</Text>
          <Text bold color={isSelected ? GRUV.fg : GRUV.grey} backgroundColor={isSelected ? GRUV.selection : undefined}>
            {fit(`#${pr.number} `, 7)}
          </Text>
        </Text>
      )
      const commentsText =
        pr.newComments > 0 ? (
          <Text bold color={GRUV.aqua}>
            {fit(` ${pr.newComments} new`, commentsWidth)}
          </Text>
        ) : pr.unresolvedThreads > 0 ? (
          <Text color={GRUV.yellow}>{fit(` ${pr.unresolvedThreads} unresolved`, commentsWidth)}</Text>
        ) : (
          <Text color={GRUV.grey}>{fit(commentCount(pr.comments.length), commentsWidth)}</Text>
        )

      if (isNarrow) {
        return (
          <Box key={`row:${key}`} flexDirection="column" marginBottom={1}>
            <Button plain key={`pr:${key}`} onPress={select}>
              <Text>{indent}</Text>
              {numberText}
              <Text> </Text>
              <Text color={chip.color}>{fit(chip.label, chipWidth)}</Text>
              <Text> </Text>
              {commentsText}
            </Button>
            <Text color={isSelected ? GRUV.fg : GRUV.grey}>
              {' '.repeat(indentWidth + 1)}
              {fit(pr.title, columns - indentWidth - 1)}
            </Text>
          </Box>
        )
      }

      // indent, number, title, gap, CI chip, gap, comments: exactly `columns` cells, so no row wraps.
      const titleWidth = Math.max(8, columns - indentWidth - 8 - 1 - chipWidth - 1 - commentsWidth)
      return (
        <Button plain key={`pr:${key}`} onPress={select}>
          <Text>{indent}</Text>
          {numberText}
          <Text bold={isSelected} color={isSelected ? GRUV.fg : GRUV.grey}>
            {fit(pr.title, titleWidth)}{' '}
          </Text>
          <Text color={chip.color}>{fit(chip.label, chipWidth)}</Text>
          <Text> </Text>
          {commentsText}
        </Button>
      )
    }

    const showResolvedNow = await read($, showResolved)

    /** A bold section name and a dim summary on one line, the same for every section. */
    const section = (key: string, name: string, summary: string, extra?: RenderChildren) => (
      <Box key={`section:${key}`} marginTop={1} gap={2}>
        <Text bold color={GRUV.grey}>
          {name.toUpperCase()}
        </Text>
        {summary !== '' && <Text color={GRUV.grey}>{summary}</Text>}
        {extra}
      </Box>
    )

    /** The comment text after its title line, flattened and cut to about `lines` rows. */
    const preview = (comment: PrComment, lines: number) => {
      const rest = commentPlainText(comment.body).split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim()
      const max = Math.max(24, (columns - 4) * lines - 2)
      return rest.length > max ? `${rest.slice(0, max - 1)}…` : rest
    }

    const details = (pr: PrStatus) => {
      const key = keyOf(pr)
      const chip = ciChip(pr)
      const readiness = mergeReadiness(pr)
      const review = reviewText(pr)
      const size = diffSize(pr)
      const canRerun = pr.checks.failed.some(check => runIdOfCheck(check.url) !== null)
      const isOpen = pr.state === 'OPEN'
      const isAutoFixOn = autoFixKeys.includes(key)
      const { verdicts, findings } = splitComments(pr)
      const resolvedCount = findings.filter(one => one.isResolved === true).length
      const shown = findings.filter(one => showResolvedNow || one.isResolved !== true)
      const checkSummary = [
        pr.checks.failed.length > 0 ? `✗ ${pr.checks.failed.length} failed` : '',
        pr.checks.pending > 0 ? `◐ ${pr.checks.pending} running` : '',
        pr.checks.passed > 0 ? `✓ ${pr.checks.passed} passed` : '',
      ].filter(one => one !== '')

      const card = (comment: PrComment, index: number, shownList: PrComment[]) => {
        // Keyed by URL, so a card stays open when the list above it changes.
        const commentKey = `${key}:${comment.url}`
        const isExpanded = openCommentKey === commentKey
        const isResolved = comment.isResolved === true
        const { priority, text } = summarizeComment(comment.body)
        const startsGroup = index === 0 || threadRank(shownList[index - 1]!) !== threadRank(comment)
        const toggle = () => void update($, openComment, current => (current === commentKey ? null : commentKey))
        const fullText = commentPlainText(comment.body).split('\n').slice(1).join('\n').trim()
        const rest = preview(comment, 2)
        return (
          <Box key={`card:${commentKey}`} flexDirection="column">
            {startsGroup && comment.isResolved === null && section(`comments:${key}`, 'Comments', '')}
            {startsGroup && isResolved && section(`resolved:${key}`, 'Resolved', '')}
            <Box flexDirection="column" marginTop={1}>
              <Button plain key={`comment:${commentKey}`} onPress={toggle}>
                <Text color={GRUV.grey}>{isExpanded ? '▾ ' : '▸ '}</Text>
                {priority && (
                  <Text bold color={isResolved ? GRUV.faint : priorityColor(priority)}>
                    {`${priority} `}
                  </Text>
                )}
                <Text bold color={isResolved ? GRUV.faint : GRUV.fg}>
                  {shortAuthor(comment.author)}
                </Text>
                <Text color={GRUV.grey}> · {timeAgo(comment.createdAt, now)}</Text>
                {comment.isNew && <Text color={GRUV.aqua}> · new</Text>}
              </Button>
              {comment.location && (
                <Text color={GRUV.aqua} wrap="truncate-middle">
                  {'  '}
                  {comment.location}
                </Text>
              )}
              <Text color={isResolved ? GRUV.faint : GRUV.fg} wrap="wrap">
                {'  '}
                {text}
              </Text>
              {!isExpanded && rest !== '' && (
                <Text color={isResolved ? GRUV.faint : GRUV.grey} wrap="wrap">
                  {'  '}
                  {rest}
                </Text>
              )}
              {isExpanded && (
                <Box flexDirection="column" paddingLeft={2}>
                  {fullText !== '' && (
                    <Text color={GRUV.fg} wrap="wrap">
                      {fullText.length > COMMENT_TEXT_CHARS ? `${fullText.slice(0, COMMENT_TEXT_CHARS)}…` : fullText}
                    </Text>
                  )}
                  <Box gap={3} marginTop={1}>
                    <Button
                      key={`ask:${commentKey}`}
                      label="Ask Claude to fix"
                      plain
                      onPress={() => void $.prompt.submit({ text: commentFixPrompt(pr, comment) })}
                    />
                    <Button key={`open-comment:${commentKey}`} label="Open thread" plain onPress={() => void openUrl($, comment.url)} />
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        )
      }

      const visibleCards = shown.slice(0, COMMENTS_SHOWN)
      return (
        <Box flexDirection="column">
          <Text bold color={GRUV.fg} wrap="wrap">
            #{pr.number} {pr.title}
          </Text>
          {pr.headRef !== '' && (
            <Text color={GRUV.grey} wrap="truncate-middle">
              {pr.headRef} → {pr.baseRef}
            </Text>
          )}
          <Box gap={1} flexWrap="wrap">
            <Text color={toneColor(readiness.tone)}>{readiness.text}</Text>
            <Text color={GRUV.faint}>·</Text>
            <Text color={GRUV.grey}>{review}</Text>
            {size !== '' && <Text color={GRUV.faint}>·</Text>}
            {size !== '' && <Text color={GRUV.grey}>{size}</Text>}
            {isAutoFixOn && <Text color={GRUV.purple}>· auto-fix on</Text>}
          </Box>
          {pr.error && <Text color={GRUV.red}>{pr.error}</Text>}

          <Box gap={3} marginTop={1} flexWrap="wrap">
            <Button key={`action-open:${key}`} label="Open" hotkey="1" plain onPress={() => void openUrl($, pr.url)} />
            <Button key={`action-read:${key}`} label="Mark read" hotkey="2" plain onPress={() => void markSeen($, [key])} />
            {isOpen && (
              <Button
                key={`action-auto:${key}`}
                label={isAutoFixOn ? 'Auto-fix off' : 'Auto-fix on'}
                hotkey="3"
                plain
                onPress={() => void setAutoFix($, key, !isAutoFixOn)}
              />
            )}
            {canRerun && (
              <Button key={`action-rerun:${key}`} label="Re-run failed" hotkey="4" plain onPress={() => void rerunFailedChecks($, pr)} />
            )}
            {isOpen && pr.checks.failed.length > 0 && (
              <Button key={`action-fix-ci:${key}`} label="Fix CI" hotkey="7" plain onPress={() => void $.prompt.submit({ text: ciFixPrompt(pr) })} />
            )}
            {isOpen && pr.isDraft && (
              <Button key={`action-ready:${key}`} label="Ready for review" hotkey="5" plain onPress={() => void markReadyForReview($, pr)} />
            )}
            <Button key={`action-remove:${key}`} label="Stop watching" hotkey="6" plain onPress={() => void removeRefs($, [pr])} />
          </Box>

          {section(`checks:${key}`, 'Checks', checkSummary.length > 0 ? '' : 'none', checkSummary.length > 0 && (
            <Text>
              {pr.checks.failed.length > 0 && <Text color={GRUV.red}>✗ {pr.checks.failed.length} failed  </Text>}
              {pr.checks.pending > 0 && <Text color={GRUV.yellow}>◐ {pr.checks.pending} running  </Text>}
              {pr.checks.passed > 0 && <Text color={GRUV.green}>✓ {pr.checks.passed} passed</Text>}
            </Text>
          ))}
          {pr.checks.failed.map((check, index) => (
            <Button plain key={`check:${key}:${index}`} onPress={() => void openUrl($, check.url ?? pr.url)}>
              <Text color={GRUV.red}>{'  '}✗ </Text>
              <Text color={GRUV.fg}>{check.name}</Text>
              <Text color={GRUV.grey}> · logs</Text>
            </Button>
          ))}

          {verdicts.length > 0 &&
            section(
              `verdicts:${key}`,
              'Verdicts',
              '',
              <Text>
                {verdicts.map((verdict, index) => (
                  <Text key={`verdict:${key}:${index}`} color={GRUV.grey}>
                    {index > 0 ? '  ·  ' : ''}
                    {shortAuthor(verdict.author)}{' '}
                    <Text color={verdictText(verdict).isGood ? GRUV.green : GRUV.orange}>{verdictText(verdict).text}</Text>
                  </Text>
                ))}
              </Text>,
            )}

          {section(
            `threads:${key}`,
            'Open threads',
            pr.unresolvedThreads > 0 ? String(pr.unresolvedThreads) : 'none',
            resolvedCount > 0 && (
              <Button
                plain
                key={`resolved-toggle:${key}`}
                onPress={() => void update($, showResolved, current => !current)}
              >
                <Text color={GRUV.faint}>
                  {resolvedCount} resolved · {showResolvedNow ? 'hide' : 'show'}
                </Text>
              </Button>
            ),
          )}
          {visibleCards.map((comment, index) => card(comment, index, visibleCards))}
          {shown.length > COMMENTS_SHOWN && (
            <Box marginTop={1}>
              <Text color={GRUV.grey}>{shown.length - COMMENTS_SHOWN} more on GitHub: press 1</Text>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {orderAsStacks(list).map(group => (
          <Box key={`group:${group.repo}`} flexDirection="column" marginBottom={isNarrow ? 0 : 1}>
            <Text bold color={GRUV.orange}>
              {group.repo.split('/').pop()}
            </Text>
            {group.rows.map(row => prRow(row.pr, row.depth))}
          </Box>
        ))}
        {rule}
        {selected && <Box marginY={1}>{details(selected)}</Box>}
        {rule}
        <Box gap={2} flexWrap="wrap">
          <Text color={GRUV.grey}>tab move · enter select or expand</Text>
          {scopeKeyNow && <Text color={GRUV.faint}>{scopeLabel(scopeKeyNow)}</Text>}
          <Button key="refresh" label="Refresh" hotkey="0" plain onPress={() => void refresh($)} />
        </Box>
      </Box>
    )
  })
}
