// Where a linked pull request stands. Merge state and checks decide it before reviews do.
export type PrState =
  | 'merged'
  | 'ready'
  | 'blocked'
  | 'running'
  | 'review'
  | 'changes'
  | 'failing'
  | 'conflict'
  | 'behind'
  | 'draft'
  | 'closed'
  | 'unknown'

// Who acts next on a PR. 'author' is someone other than you who opened it.
export type Actor = 'you' | 'author' | 'operator' | 'reviewer' | 'ci' | 'none' | 'unknown'

// One CI check as GitHub reports it, reduced to what the views draw.
export type Check = { name: string; outcome: 'passed' | 'failed' | 'running'; url?: string }

// A PR's reviews: who approved, who asked for changes, who is still asked.
export type Reviews = { approvedBy: string[]; changesBy: string[]; requested: string[] }

export type Pr = {
  repo: string
  number: number
  state: PrState
  url: string
  title?: string
  author?: string
  checks?: Check[]
  reviews?: Reviews
  // GitHub's own merge verdict: 'yes' only when it says CLEAN (or HAS_HOOKS / UNSTABLE).
  mergeable?: 'yes' | 'no' | 'unknown'
  // The raw mergeStateStatus, for the expanded view: CLEAN, BLOCKED, DIRTY, BEHIND, ...
  mergeState?: string
  // The ticket the PR is linked from.
  ticket?: string
  // ISO times from GitHub, for "open 4d" and "merged 2h ago".
  createdAt?: string
  mergedAt?: string
  closedAt?: string
}

// One Linear state a ticket was in, and when it entered it (from Linear's state history).
export type StateVisit = { name: string; type: string; at: string }

// One stage of a ticket or PR: done, the one it is in now, waiting on someone,
// failed or blocked, not reached yet, or not used here.
export type StepState = 'done' | 'now' | 'waiting' | 'failed' | 'todo' | 'na'
export type Step = { label: string; state: StepState; at?: string }

export type Issue = {
  id: string
  title: string
  status: string
  statusType: string
  url: string
  priority?: string
  project?: string
  updatedAt?: string
  prs?: Pr[]
  // The states it went through, oldest first, when Linear gives them.
  history?: StateVisit[]
}

// compact: the band is one line and pane rows have no details. expanded: both show more.
export type Mode = 'compact' | 'expanded'

// One change a check found, kept for the views. 'quiet' changes are listed but never toasted.
export type Update = { at: number; text: string; level: 'important' | 'routine' | 'quiet'; ticket?: string; pr?: string }

// Whether the last checks reached Linear; the views say when what they show is stale.
export type Health = { failures: number; lastOk?: number; lastError?: string }

declare module 'claude-code' {
  interface PluginState {
    'linear-watch': {
      open: Issue[]
      mode: { band: Mode; pane: Mode; key: boolean }
      updates: Update[]
      unseen: number
      health: Health
      checking: boolean
    }
  }
}
