export type PrRef = { repo: string; number: number }

export type PrComment = {
  author: string
  body: string
  url: string
  createdAt: string
  /** e.g. "src/lib/url.ts:42" for an inline review comment, null for a PR-level one. */
  location: string | null
  /** Whether the review thread is resolved; null for a PR-level comment, which has no thread. */
  isResolved: boolean | null
  /** Posted after the person last marked this PR read. */
  isNew: boolean
}

export type FailedCheck = { name: string; url: string | null }

export type PrStatus = PrRef & {
  title: string
  url: string
  state: string
  isDraft: boolean
  reviewDecision: string
  baseRef: string
  headRef: string
  /** GitHub's mergeStateStatus, e.g. CLEAN, BLOCKED, BEHIND, DIRTY (conflicts), UNSTABLE, DRAFT. */
  mergeState: string
  additions: number
  deletions: number
  changedFiles: number
  checks: { passed: number; pending: number; failed: FailedCheck[] }
  /** Unresolved review threads first, then the rest, newest first within each. */
  comments: PrComment[]
  unresolvedThreads: number
  newComments: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'pr-watch': {
      prs: PrStatus[]
      /** The PR whose details show: the last PR row the focus ring landed on. */
      selectedPr: string | null
      /** The comment whose full text shows, as `<pr key>:<index>`. */
      openComment: string | null
      /** The PRs whose new CI failures and review comments start a turn on their own. */
      autoFix: string[]
      /** The herdr workspace and git worktree the list belongs to, e.g. "herdr:w1V|/src/app-wt"; null before the first poll. */
      scope: string | null
    }
  }
}
