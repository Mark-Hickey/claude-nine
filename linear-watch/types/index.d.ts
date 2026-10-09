// Where a linked pull request stands, from what blocks the ticket least to most.
export type PrState = 'merged' | 'ready' | 'running' | 'review' | 'changes' | 'failing' | 'draft' | 'closed' | 'unknown'

export type Pr = { repo: string; number: number; state: PrState; url: string }

export type Issue = { id: string; title: string; status: string; statusType: string; url: string; prs?: Pr[] }

declare module 'claude-code' {
  interface PluginState {
    'linear-watch': { open: Issue[] }
  }
}
