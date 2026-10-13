import { expect, test } from 'claude-code/testing'

import {
  ciFixPrompt,
  collectComments,
  fit,
  isVerdict,
  mayHoldLease,
  mergeReadiness,
  orderAsStacks,
  parsePrRefs,
  reviewFixPrompt,
  runIdOfCheck,
  scopeKey,
  scopeLabel,
  shortAuthor,
  shortName,
  summarizeChecks,
  summarizeComment,
  verdictText,
} from '../hooks/register'

test('reads PR refs from short refs, GitHub URLs and Graphite URLs, once each', async () => {
  const text = [
    'framer/creators#5037',
    'https://github.com/framer/FramerCreatorsService/pull/1039',
    'https://app.graphite.com/github/pr/framer/FramerCreatorsService/1040 (created)',
    'https://github.com/framer/FramerCreatorsService/pull/1039#issuecomment-1',
  ].join('\n')

  expect(parsePrRefs(text)).toEqual([
    { repo: 'framer/FramerCreatorsService', number: 1039 },
    { repo: 'framer/FramerCreatorsService', number: 1040 },
    { repo: 'framer/creators', number: 5037 },
  ])
})

test('shortens long repo names to their initials', async () => {
  expect(shortName({ repo: 'framer/FramerCreatorsService', number: 1039 })).toBe('FCS#1039')
  expect(shortName({ repo: 'framer/creators', number: 5037 })).toBe('creators#5037')
})

test('counts a running check as pending and keeps the failed ones with their log links', async () => {
  expect(
    summarizeChecks([
      { name: 'Test', status: 'IN_PROGRESS', conclusion: null },
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'check-migrations', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci/1' },
      { context: 'deploy', state: 'PENDING' },
    ]),
  ).toEqual({ passed: 1, pending: 2, failed: [{ name: 'check-migrations', url: 'https://ci/1' }] })
})

test('collects review comments with unresolved threads first, without the author or noise bots', async () => {
  const pr = {
    title: 'x',
    url: 'https://github.com/o/r/pull/1',
    state: 'OPEN',
    isDraft: true,
    reviewDecision: null,
    statusCheckRollup: [],
    comments: [
      { author: { login: 'me' }, body: 'mine', createdAt: '2026-10-12T10:00:00Z' },
      { author: { login: 'graphite-app' }, body: 'stack', createdAt: '2026-10-12T10:01:00Z' },
      { author: { login: 'devin-ai-integration' }, body: 'Found 1 issue', url: 'u1', createdAt: '2026-10-12T10:05:00Z' },
    ],
    reviews: [{ author: { login: 'chatgpt-codex-connector' }, body: '', submittedAt: '2026-10-12T10:03:00Z' }],
  }
  const thread = (isResolved: boolean, createdAt: string, path: string) => ({
    isResolved,
    path,
    line: 42,
    comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, body: `Bug in ${path}`, url: path, createdAt }] },
  })

  expect(
    collectComments(pr, [thread(true, '2026-10-12T10:06:00Z', 'a.ts'), thread(false, '2026-10-12T10:02:00Z', 'b.ts')], 'me'),
  ).toEqual([
    { author: 'chatgpt-codex-connector', body: 'Bug in b.ts', url: 'b.ts', createdAt: '2026-10-12T10:02:00Z', location: 'b.ts:42', isResolved: false, isNew: false },
    { author: 'chatgpt-codex-connector', body: 'Bug in a.ts', url: 'a.ts', createdAt: '2026-10-12T10:06:00Z', location: 'a.ts:42', isResolved: true, isNew: false },
    { author: 'devin-ai-integration', body: 'Found 1 issue', url: 'u1', createdAt: '2026-10-12T10:05:00Z', location: null, isResolved: null, isNew: false },
  ])
})

test('names the merge state a person acts on', async () => {
  expect(mergeReadiness({ state: 'OPEN', isDraft: false, mergeState: 'DIRTY' })).toEqual({ text: 'merge conflicts', tone: 'error' })
  expect(mergeReadiness({ state: 'OPEN', isDraft: true, mergeState: 'BLOCKED' })).toEqual({ text: 'draft', tone: 'inactive' })
  expect(mergeReadiness({ state: 'MERGED', isDraft: false, mergeState: '' })).toEqual({ text: 'merged', tone: 'inactive' })
  expect(runIdOfCheck('https://github.com/o/r/actions/runs/38265379047/job/114866400948')).toBe('38265379047')
  expect(runIdOfCheck('https://vercel.com/deploy/1')).toBeNull()
})

test('turns a Codex finding into its priority and title', async () => {
  const body =
    '**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Preserve expert eligibility for verified proxied sites**\n\nWhen the hostname lookup misses…'

  expect(summarizeComment(body)).toEqual({ priority: 'P1', text: 'Preserve expert eligibility for verified proxied sites' })
  expect(summarizeComment('Codex Review: Didn\'t find any major issues. Bravo.\n\n**Reviewed commit:** `119bdae08c`')).toEqual({
    priority: null,
    text: "Codex Review: Didn't find any major issues. Bravo.",
  })
  expect(shortAuthor('chatgpt-codex-connector[bot]')).toBe('codex')
})

test('counts only the latest run of a check, so a passing re-run clears the failure', async () => {
  expect(
    summarizeChecks([
      { name: 'check-migrations', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'check-migrations', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ]),
  ).toEqual({ passed: 1, pending: 0, failed: [] })
})

test('orders a stack base first, each PR one level under the PR it builds on', async () => {
  const pr = (number: number, baseRef: string, headRef: string) =>
    ({ repo: 'o/r', number, baseRef, headRef }) as Parameters<typeof orderAsStacks>[0][number]
  const rows = orderAsStacks([pr(1042, 'b2', 'b3'), pr(1039, 'master', 'b1'), pr(1040, 'b1', 'b2')])[0]?.rows

  expect(rows?.map(row => [row.pr.number, row.depth])).toEqual([
    [1039, 0],
    [1040, 1],
    [1042, 2],
  ])
})

test('fits text to an exact width', async () => {
  expect(fit('abc', 5)).toBe('abc  ')
  expect(fit('abcdef', 4)).toBe('abc…')
})

test('auto-fix prompts name the PR and branch, and never ask to push', async () => {
  const pr = {
    repo: 'framer/FramerCreatorsService',
    number: 1039,
    title: 'feat: Sites: check the live Framer site.',
    url: 'https://github.com/framer/FramerCreatorsService/pull/1039',
    state: 'OPEN',
    isDraft: true,
    reviewDecision: '',
    baseRef: 'master',
    headRef: 'feat/site-framer-check',
    mergeState: 'BLOCKED',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    checks: { passed: 8, pending: 0, failed: [{ name: 'Test', url: 'https://ci/1' }] },
    comments: [
      {
        author: 'chatgpt-codex-connector[bot]',
        body: '**![P1 Badge](x)  Preserve expert eligibility**',
        url: 'https://c/1',
        createdAt: '2026-10-12T15:08:00Z',
        location: 'src/lib/resources/framer-site-check.ts:40',
        isResolved: false,
        isNew: true,
      },
    ],
    unresolvedThreads: 1,
    newComments: 1,
    error: null,
  }

  expect(ciFixPrompt(pr)).toContain('Test (https://ci/1)')
  expect(ciFixPrompt(pr)).toContain('feat/site-framer-check')
  expect(reviewFixPrompt(pr)).toContain('- P1 Preserve expert eligibility (codex, src/lib/resources/framer-site-check.ts:40) https://c/1')
  expect(reviewFixPrompt(pr)).toContain('Do not push until I confirm.')
})

test("reads Devin's severity emoji as a priority", async () => {
  expect(summarizeComment('🔴 **Missing pages pass the site check**\n\nThe check…')).toEqual({
    priority: 'P1',
    text: 'Missing pages pass the site check',
  })
  expect(summarizeComment('🟡 HTTP timeouts reject valid sites')).toEqual({ priority: 'P2', text: 'HTTP timeouts reject valid sites' })
})

test('tells bot verdicts on the whole PR apart from findings', async () => {
  const comment = (body: string, isResolved: boolean | null = null) => ({
    author: 'devin-ai-integration[bot]',
    body,
    url: 'u',
    createdAt: '2026-10-12T10:00:00Z',
    location: null,
    isResolved,
    isNew: false,
  })

  expect(verdictText(comment('Devin Review found 2 potential issues.'))).toEqual({ text: '2 issues', isGood: false })
  expect(verdictText(comment('✅ Devin Review: No Issues Found'))).toEqual({ text: 'no issues', isGood: true })
  expect(verdictText(comment("Codex Review: Didn't find any major issues. Bravo."))).toEqual({ text: 'no issues', isGood: true })
  expect(isVerdict(comment('🟡 Changes recommended'))).toBe(true)
  expect(isVerdict(comment('🔴 Missing pages pass the site check', false))).toBe(false)
})

test('the auto-fix prompt leaves out verdicts', async () => {
  const comment = (body: string, isResolved: boolean | null) => ({
    author: 'devin-ai-integration[bot]',
    body,
    url: 'u',
    createdAt: '2026-10-12T10:00:00Z',
    location: null,
    isResolved,
    isNew: true,
  })
  const pr = {
    repo: 'framer/creators',
    number: 5037,
    title: 'feat: Site: framer_site_id column.',
    url: 'https://github.com/framer/creators/pull/5037',
    state: 'OPEN',
    isDraft: true,
    reviewDecision: '',
    baseRef: 'main',
    headRef: 'feat/site-framer-site-id',
    mergeState: 'BEHIND',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    checks: { passed: 1, pending: 0, failed: [] },
    comments: [comment('✅ Devin Review: No Issues Found', null), comment('🔴 Missing index on framer_site_id', false)],
    unresolvedThreads: 1,
    newComments: 2,
    error: null,
  }

  expect(reviewFixPrompt(pr)).toContain('Missing index on framer_site_id')
  expect(reviewFixPrompt(pr)).not.toContain('No Issues Found')
})

test('keeps one PR list per herdr workspace and worktree', async () => {
  expect(scopeKey('w1V', '/src/app')).toBe('herdr:w1V|/src/app')
  expect(scopeKey('w2A', '/src/app')).not.toBe(scopeKey('w1V', '/src/app'))
  expect(scopeKey('w1V', '/src/app-wt')).not.toBe(scopeKey('w1V', '/src/app'))
  expect(scopeKey(null, '/src/app')).toBe('/src/app')
  expect(scopeLabel('herdr:w1V|/src/app-wt')).toBe('w1V · app-wt')
  expect(scopeLabel('/src/app')).toBe('app')
})

test('lets one session in a scope start auto-fix turns until it goes quiet', async () => {
  const lease = { sessionId: 'a', at: 1_000_000 }
  expect(mayHoldLease(null, 'b', 1_000_000)).toBe(true)
  expect(mayHoldLease(lease, 'a', 1_060_000)).toBe(true)
  expect(mayHoldLease(lease, 'b', 1_060_000)).toBe(false)
  expect(mayHoldLease(lease, 'b', 1_000_000 + 181_000)).toBe(true)
})

test('reads only PR URLs from command output, not ref-like text', async () => {
  const output = 'Usage: /pr-watch add owner/repo#123\nhttps://github.com/framer/creators/pull/5037'
  expect(parsePrRefs(output, { urlsOnly: true })).toEqual([{ repo: 'framer/creators', number: 5037 }])
})
