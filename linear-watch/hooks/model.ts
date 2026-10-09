// Status interpretation for tickets and PRs: no engine calls, so every rule here is tested directly.
import type { Actor, Check, Issue, Pr, PrState, Reviews, Step, StepState, Update } from '../types'

// How each PR state reads. Every state has a glyph AND a word, so colour is never the only signal.
// Green done, cyan ready, yellow waiting, red someone must fix, gray inactive or unknown.
export const PR_LOOK: Record<PrState, { glyph: string; color: string; label: string; means: string }> = {
  merged: { glyph: '✓', color: 'green', label: 'Merged', means: 'The PR is in the base branch.' },
  ready: { glyph: '●', color: 'cyan', label: 'Ready', means: 'Checks passed, reviews approved, GitHub says it can merge.' },
  blocked: { glyph: '◇', color: 'yellow', label: 'Blocked', means: 'Checks and reviews look done, but branch rules still block the merge.' },
  running: { glyph: '◌', color: 'yellow', label: 'CI running', means: 'CI checks are still running.' },
  review: { glyph: '◷', color: 'yellow', label: 'Awaiting review', means: 'Checks passed. No reviewer has approved it yet.' },
  changes: { glyph: '✎', color: 'red', label: 'Changes requested', means: 'A reviewer asked for changes.' },
  failing: { glyph: '✕', color: 'red', label: 'Checks failing', means: 'One or more CI checks failed.' },
  conflict: { glyph: '≠', color: 'red', label: 'Merge conflict', means: 'The branch conflicts with its base.' },
  behind: { glyph: '↓', color: 'yellow', label: 'Behind base', means: 'Branch rules need the branch updated from its base.' },
  draft: { glyph: '○', color: 'gray', label: 'Draft', means: 'The PR is a draft, not ready for review.' },
  closed: { glyph: '⊘', color: 'gray', label: 'Closed', means: 'The PR was closed without a merge.' },
  unknown: { glyph: '?', color: 'gray', label: 'Unknown', means: 'GitHub did not answer for this PR.' },
}

// The order the key lists states in: done first, then waiting, then needs a fix, then inactive.
export const KEY_ORDER: PrState[] = ['merged', 'ready', 'blocked', 'running', 'review', 'behind', 'changes', 'failing', 'conflict', 'draft', 'closed', 'unknown']

export const keyLine = (s: PrState) => `${PR_LOOK[s].glyph} ${PR_LOOK[s].label}: ${PR_LOOK[s].means}`

// The key for the states the given tickets use, in key order.
export function keyFor(issues: Issue[]): string[] {
  const used = new Set(issues.flatMap(i => (i.prs ?? []).map(pr => pr.state)))
  return KEY_ORDER.filter(s => used.has(s)).map(keyLine)
}

export const isOpen = (i: Issue) => !['completed', 'canceled', 'duplicate'].includes(i.statusType)

// The GitHub pull requests a ticket links to, from its attachments' URLs, once each.
export function prRefs(attachments: { url?: string }[]): { repo: string; number: number; url: string }[] {
  const refs = attachments.flatMap(a => {
    const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(a.url ?? '')
    return m?.[1] && m[2] ? [{ repo: m[1], number: Number(m[2]), url: `https://github.com/${m[1]}/pull/${m[2]}` }] : []
  })
  return refs.filter((r, i) => refs.findIndex(o => o.repo === r.repo && o.number === r.number) === i)
}

// What `gh pr view --json` returns for the fields fetch asks for.
export type GhPr = {
  state?: string
  isDraft?: boolean
  title?: string
  author?: { login?: string } | null
  reviewDecision?: string | null
  mergeable?: string | null
  mergeStateStatus?: string | null
  reviewRequests?: { login?: string; name?: string; slug?: string }[]
  latestReviews?: { author?: { login?: string } | null; state?: string }[]
  createdAt?: string | null
  mergedAt?: string | null
  closedAt?: string | null
  statusCheckRollup?: { name?: string | null; context?: string | null; status?: string | null; conclusion?: string | null; state?: string | null; detailsUrl?: string | null; targetUrl?: string | null }[]
}

export const GH_FIELDS = 'state,isDraft,title,author,reviewDecision,mergeable,mergeStateStatus,reviewRequests,latestReviews,statusCheckRollup,createdAt,mergedAt,closedAt'

const FAILED = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']

// Each check run or status context as passed, failed or running.
export function checksOf(pr: GhPr): Check[] {
  return (pr.statusCheckRollup ?? []).map(c => {
    const name = c.name ?? c.context ?? 'check'
    const url = c.detailsUrl ?? c.targetUrl ?? undefined
    const done = c.conclusion ?? c.state ?? ''
    const isRunning = (c.status !== undefined && c.status !== null && c.status !== 'COMPLETED') || done === 'PENDING' || done === 'EXPECTED'
    const outcome: Check['outcome'] = isRunning ? 'running' : FAILED.includes(done) ? 'failed' : 'passed'
    return url ? { name, outcome, url } : { name, outcome }
  })
}

export function reviewsOf(pr: GhPr): Reviews {
  const by = (state: string) => (pr.latestReviews ?? []).filter(r => r.state === state).map(r => r.author?.login ?? 'someone')
  const requested = (pr.reviewRequests ?? []).map(r => r.login ?? r.slug ?? r.name ?? 'someone')
  return { approvedBy: by('APPROVED'), changesBy: by('CHANGES_REQUESTED'), requested }
}

export function mergeableOf(pr: GhPr): 'yes' | 'no' | 'unknown' {
  const s = pr.mergeStateStatus ?? ''
  if (['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(s)) return 'yes'
  if (['BLOCKED', 'DIRTY', 'BEHIND', 'DRAFT'].includes(s) || pr.mergeable === 'CONFLICTING') return 'no'
  return 'unknown'
}

// One state from what GitHub reports. Passing CI alone never makes a PR ready: merged and
// closed win, then draft, failing checks, requested changes, conflicts, running checks,
// missing reviews, and last the merge state GitHub computes from branch protection.
export function classifyPr(pr: GhPr): PrState {
  if (pr.state === 'MERGED') return 'merged'
  if (pr.state === 'CLOSED') return 'closed'
  if (pr.isDraft) return 'draft'
  const checks = checksOf(pr)
  if (checks.some(c => c.outcome === 'failed')) return 'failing'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes'
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return 'conflict'
  if (checks.some(c => c.outcome === 'running')) return 'running'
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return 'review'
  const approved = pr.reviewDecision === 'APPROVED'
  if (!approved && (pr.reviewRequests ?? []).length > 0) return 'review'
  if (pr.mergeStateStatus === 'BEHIND') return 'behind'
  if (pr.mergeStateStatus === 'BLOCKED') return 'blocked'
  // No review decision and no clean merge state: nobody has said it can go in yet.
  if (!approved && mergeableOf(pr) !== 'yes') return 'review'
  return 'ready'
}

// The full PR record the views draw, from a link and GitHub's answer.
export function prFromGh(ref: { repo: string; number: number; url: string }, gh: GhPr, ticket?: string): Pr {
  const pr: Pr = {
    ...ref,
    state: classifyPr(gh),
    checks: checksOf(gh),
    reviews: reviewsOf(gh),
    mergeable: mergeableOf(gh),
  }
  if (gh.title) pr.title = gh.title
  if (gh.author?.login) pr.author = gh.author.login
  if (gh.mergeStateStatus) pr.mergeState = gh.mergeStateStatus
  if (ticket) pr.ticket = ticket
  if (gh.createdAt) pr.createdAt = gh.createdAt
  if (gh.mergedAt) pr.mergedAt = gh.mergedAt
  if (gh.closedAt) pr.closedAt = gh.closedAt
  return pr
}

const sameLogin = (a: string | undefined | null, b: string | undefined | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

// Who acts next. A ready PR is merged by you in your own repos and by your operator
// everywhere else (handbook rule 3); fixes fall to whoever opened the PR.
export function nextActor(pr: Pr, me: string | null): Actor {
  switch (pr.state) {
    case 'merged':
    case 'closed':
      return 'none'
    case 'ready':
      return sameLogin(pr.repo.split('/')[0], me) ? 'you' : 'operator'
    case 'running':
      return 'ci'
    case 'review':
      return 'reviewer'
    case 'changes':
    case 'failing':
    case 'conflict':
    case 'behind':
    case 'draft':
      return pr.author === undefined || sameLogin(pr.author, me) ? 'you' : 'author'
    default:
      return 'unknown'
  }
}

// The next action in a few words: "You merge", "Reviewer acts", "You fix CI".
export function nextText(pr: Pr, me: string | null): string {
  const actor = nextActor(pr, me)
  const who = actor === 'author' ? (pr.author ?? 'Author') : 'You'
  switch (pr.state) {
    case 'merged':
      return 'Done'
    case 'closed':
      return 'No action'
    case 'ready':
      return actor === 'you' ? 'You merge' : 'Operator merges'
    case 'running':
      return 'Wait for CI'
    case 'review':
      return 'Reviewer acts'
    case 'changes':
      return `${who} address review`
    case 'failing':
      return `${who} fix CI`
    case 'conflict':
      return `${who} resolve conflicts`
    case 'behind':
      return `${who} update branch`
    case 'draft':
      return `${who} mark ready`
    case 'blocked':
      return 'Check branch rules'
    default:
      return 'Open the PR'
  }
}

// "site#152" rather than "unsigned-gg/site#152": the org is the same everywhere here.
export const prName = (pr: Pick<Pr, 'repo' | 'number'>) => `${pr.repo.split('/')[1] ?? pr.repo}#${pr.number}`
export const prKey = (pr: Pick<Pr, 'repo' | 'number'>) => `${pr.repo}#${pr.number}`

// CI in a few words. Honest when GitHub gave no checks at all.
export function ciText(pr: Pr): string {
  const checks = pr.checks
  if (checks === undefined) return 'CI unknown'
  if (checks.length === 0) return 'No checks'
  const failed = checks.filter(c => c.outcome === 'failed').length
  const running = checks.filter(c => c.outcome === 'running').length
  if (failed > 0) return `CI failed ${failed}/${checks.length}`
  if (running > 0) return `CI running ${checks.length - running}/${checks.length}`
  return 'CI passed'
}

export function reviewText(pr: Pr): string {
  const r = pr.reviews
  if (r === undefined) return 'Reviews unknown'
  if (r.changesBy.length > 0) return `Changes requested by ${r.changesBy.join(', ')}`
  if (r.approvedBy.length > 0) return `Approved by ${r.approvedBy.join(', ')}`
  if (r.requested.length > 0) return `Review requested from ${r.requested.join(', ')}`
  return 'No reviews yet'
}

export function mergeText(pr: Pr): string {
  if (pr.state === 'merged') return 'Merged'
  if (pr.state === 'closed') return 'Closed'
  switch (pr.mergeState) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return 'GitHub allows the merge'
    case 'UNSTABLE':
      return 'GitHub allows the merge (non-required checks failing)'
    case 'BLOCKED':
      return 'Blocked by branch rules'
    case 'DIRTY':
      return 'Blocked by a merge conflict'
    case 'BEHIND':
      return 'Blocked until the branch is updated'
    case 'DRAFT':
      return 'Blocked: draft'
    default:
      return 'GitHub has not computed mergeability yet'
  }
}

// The one-line PR summary, shortened to fit: full, then without CI, then the state alone.
export function prSummary(pr: Pr, me: string | null, columns: number): string {
  const look = PR_LOOK[pr.state]
  const full = `${look.glyph} ${prName(pr)} ${look.label} · ${ciText(pr)} · ${nextText(pr, me)}`
  if (full.length <= columns) return full
  const mid = `${look.glyph} ${prName(pr)} ${look.label} · ${nextText(pr, me)}`
  if (mid.length <= columns) return mid
  return `${look.glyph} ${prName(pr)} ${look.label}`
}

// Cut text to n characters with an ellipsis; whole when it fits.
export const fit = (text: string, n: number) => (n <= 0 ? '' : text.length <= n ? text : n === 1 ? '…' : `${text.slice(0, n - 1)}…`)

// Fixed-width cells for a PR row so names, states and next actions line up down a list.
export type RowCells = { glyph: string; name: string; state: string; ci: string; next: string; showCi: boolean; showNext: boolean }

export function rowCells(prs: Pr[], me: string | null, columns: number): RowCells[] {
  const nameW = Math.max(0, ...prs.map(p => prName(p).length))
  const stateW = Math.max(0, ...prs.map(p => PR_LOOK[p.state].label.length))
  const ciW = Math.max(0, ...prs.map(p => ciText(p).length))
  const nextW = Math.max(0, ...prs.map(p => nextText(p, me).length))
  // 2 for the glyph, then two spaces between each column.
  const base = 2 + nameW + 2 + stateW
  const showNext = base + 2 + nextW <= columns
  const showCi = showNext && base + 2 + ciW + 2 + nextW <= columns
  return prs.map(p => ({
    glyph: PR_LOOK[p.state].glyph,
    name: prName(p).padEnd(nameW),
    state: PR_LOOK[p.state].label.padEnd(stateW),
    ci: ciText(p).padEnd(ciW),
    next: nextText(p, me),
    showCi,
    showNext,
  }))
}

// The compact line for one ticket: id, status, its most pressing PR, and the title when room is left.
export function ticketLine(i: Issue, me: string | null, columns: number): { head: string; pr?: Pr; prText?: string; title?: string } {
  const head = `◆ ${i.id} ${i.status}`
  const pr = mostPressing(i.prs ?? [])
  if (pr === undefined) {
    const room = columns - head.length - 3
    return room >= 12 ? { head, title: fit(i.title, room) } : { head }
  }
  const prText = prSummary(pr, me, Math.max(0, columns - head.length - 3))
  const room = columns - head.length - 3 - prText.length - 3
  return room >= 16 ? { head, pr, prText, title: fit(i.title, room) } : { head, pr, prText }
}

// Most pressing first: something to fix, then something ready, then waiting, then done.
const URGENCY: PrState[] = ['failing', 'changes', 'conflict', 'behind', 'ready', 'blocked', 'review', 'running', 'draft', 'unknown', 'merged', 'closed']
export const byUrgency = (a: Pr, b: Pr) => URGENCY.indexOf(a.state) - URGENCY.indexOf(b.state)
export const mostPressing = (prs: Pr[]) => [...prs].sort(byUrgency)[0]

// The /prs groups, by who has to act. Empty groups are left out.
export type Group = { title: string; prs: Pr[] }
export function groupPrs(prs: Pr[], me: string | null): Group[] {
  const groups: Group[] = [
    { title: 'Needs you', prs: prs.filter(p => nextActor(p, me) === 'you') },
    { title: 'Waiting on others', prs: prs.filter(p => ['operator', 'reviewer', 'ci', 'author'].includes(nextActor(p, me))) },
    { title: 'Unclear', prs: prs.filter(p => nextActor(p, me) === 'unknown') },
    { title: 'Done', prs: prs.filter(p => nextActor(p, me) === 'none') },
  ]
  return groups.map(g => ({ ...g, prs: [...g.prs].sort(byUrgency) })).filter(g => g.prs.length > 0)
}

// Every PR linked from the tickets, once, each tagged with its ticket.
export function allPrs(issues: Issue[]): Pr[] {
  const seen = new Set<string>()
  return issues.flatMap(i =>
    (i.prs ?? []).flatMap(pr => {
      const k = prKey(pr)
      if (seen.has(k)) return []
      seen.add(k)
      return [{ ...pr, ticket: pr.ticket ?? i.id }]
    }),
  )
}

// "3m ago", "2h ago", "4d ago".
export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86_400)}d ago`
}

// --- Change detection --------------------------------------------------------------------

// What the last check saw: each ticket's status, each PR's state and next actor.
export type Snapshot = { tickets: Record<string, string>; prs?: Record<string, { state: PrState; actor: Actor }> }

export function snapshotOf(issues: Issue[], me: string | null, before: Snapshot | null): Snapshot {
  const prs: NonNullable<Snapshot['prs']> = {}
  for (const pr of allPrs(issues)) {
    // An unknown answer is a failed lookup, not a change: keep what was seen before.
    const old = before?.prs?.[prKey(pr)]
    prs[prKey(pr)] = pr.state === 'unknown' && old ? old : { state: pr.state, actor: nextActor(pr, me) }
  }
  return { tickets: Object.fromEntries(issues.map(i => [i.id, i.status])), prs }
}

// The changes between two checks worth telling the person about, most important first.
// A first check (before null) reports nothing; PRs are compared only once a snapshot has them.
export function changes(before: Snapshot | null, issues: Issue[], me: string | null, at: number): Update[] {
  if (before === null) return []
  const out: Update[] = []
  for (const i of issues) {
    const was = before.tickets[i.id]
    if (was === undefined) out.push({ at, level: 'important', ticket: i.id, text: `New ticket ${i.id}: ${i.title}` })
    else if (was !== i.status) out.push({ at, level: 'important', ticket: i.id, text: `${i.id} moved ${was} → ${i.status}` })
  }
  if (before.prs !== undefined) {
    // A new ticket's own toast covers its PRs; only PRs on tickets seen before are compared.
    for (const pr of allPrs(issues)) {
      if (pr.ticket !== undefined && before.tickets[pr.ticket] === undefined) continue
      out.push(...prChange(before.prs[prKey(pr)], pr, me, at))
    }
  }
  const rank = { important: 0, routine: 1, quiet: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}

function prChange(was: { state: PrState; actor: Actor } | undefined, pr: Pr, me: string | null, at: number): Update[] {
  const name = prName(pr)
  const base = { at, pr: prKey(pr), ...(pr.ticket ? { ticket: pr.ticket } : {}) }
  const next = nextText(pr, me)
  if (pr.state === 'unknown') return []
  if (was === undefined) return [{ ...base, level: 'routine', text: `${pr.ticket ?? 'Ticket'} linked ${name} · ${PR_LOOK[pr.state].label} · ${next}` }]
  if (was.state === pr.state) {
    return was.actor === nextActor(pr, me) ? [] : [{ ...base, level: 'routine', text: `${name} · ${next}` }]
  }
  const text = (what: string) => `${name} ${what} · ${next}`
  switch (pr.state) {
    case 'merged':
      return [{ ...base, level: 'important', text: `${name} merged` }]
    case 'ready':
      return [{ ...base, level: 'important', text: text(was.state === 'review' || was.state === 'blocked' ? 'approved, ready to merge' : 'is ready to merge') }]
    case 'changes':
      return [{ ...base, level: 'important', text: text('has changes requested') }]
    case 'failing':
      return [{ ...base, level: 'important', text: text('checks failing') }]
    case 'conflict':
      return [{ ...base, level: 'important', text: text('has a merge conflict') }]
    case 'review':
      return [{ ...base, level: was.state === 'draft' || was.state === 'failing' || was.state === 'running' ? 'routine' : 'quiet', text: text(was.state === 'draft' ? 'is ready for review' : 'checks passed, awaiting review') }]
    case 'running':
      // A re-run after a failure is worth a line; checks starting on every push are not.
      return [{ ...base, level: was.state === 'failing' ? 'routine' : 'quiet', text: text('checks running') }]
    case 'closed':
      return [{ ...base, level: 'routine', text: `${name} closed without merge` }]
    default:
      return [{ ...base, level: 'routine', text: text(PR_LOOK[pr.state].label.toLowerCase()) }]
  }
}

// What to toast for a batch of changes: each important or routine one, or one summary past three.
export function toastsFor(updates: Update[]): { text: string; timeoutMs: number }[] {
  const loud = updates.filter(u => u.level !== 'quiet')
  if (loud.length > 3) {
    const important = loud.filter(u => u.level === 'important').length
    return [{ text: `${loud.length} ticket and PR updates${important > 0 ? `, ${important} important` : ''} · /prs or /tickets to see them`, timeoutMs: 8000 }]
  }
  return loud.map(u => ({ text: u.text, timeoutMs: u.level === 'important' ? 8000 : 4000 }))
}

// --- Stages: how far each ticket and PR has got --------------------------------------------

// How each stage state reads. Like the PR states, every one has a glyph and a colour.
export const STEP_LOOK: Record<StepState, { glyph: string; color: string; word: string }> = {
  done: { glyph: '✓', color: 'green', word: 'done' },
  now: { glyph: '●', color: 'cyan', word: 'now' },
  waiting: { glyph: '◷', color: 'yellow', word: 'waiting' },
  failed: { glyph: '✕', color: 'red', word: 'blocked' },
  todo: { glyph: '○', color: 'gray', word: 'not yet' },
  na: { glyph: '–', color: 'gray', word: 'not used' },
}

const TYPE_RANK: Record<string, number> = { triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 4, canceled: 4, duplicate: 4 }

// A ticket's stages from Linear: the states it went through, in workflow order, then Done.
// Backlog and Todo show only when the ticket was in them; a started state shows once each.
export function ticketSteps(i: Issue): Step[] {
  const history = i.history ?? []
  const current = TYPE_RANK[i.statusType] ?? 3
  const first = (name: string) => history.find(h => h.name === name)?.at
  const names: { name: string; type: string }[] = []
  for (const h of [...history].sort((a, b) => (TYPE_RANK[a.type] ?? 3) - (TYPE_RANK[b.type] ?? 3))) {
    if ((TYPE_RANK[h.type] ?? 3) >= 4) continue
    if (!names.some(n => n.name === h.name)) names.push({ name: h.name, type: h.type })
  }
  if (current < 4 && !names.some(n => n.name === i.status)) names.push({ name: i.status, type: i.statusType })
  names.sort((a, b) => (TYPE_RANK[a.type] ?? 3) - (TYPE_RANK[b.type] ?? 3))
  // Within started states, the order they were first entered.
  const steps: Step[] = names.map(n => {
    const rank = TYPE_RANK[n.type] ?? 3
    const isNow = n.name === i.status && current < 4
    const before = rank < current || (rank === current && !isNow && (first(n.name) ?? '') < (first(i.status) ?? '~'))
    const state: StepState = isNow ? 'now' : before || current >= 4 ? 'done' : 'todo'
    const at = first(n.name)
    return at ? { label: n.name, state, at } : { label: n.name, state }
  })
  const end = i.statusType === 'canceled' || i.statusType === 'duplicate' ? i.status : 'Done'
  const endState: StepState = i.statusType === 'completed' ? 'done' : current >= 4 ? 'failed' : 'todo'
  const endAt = current >= 4 ? first(i.status) : undefined
  steps.push(endAt ? { label: end, state: endState, at: endAt } : { label: end, state: endState })
  return steps
}

// A PR's stages: out of draft, CI, review, mergeable, merged. Each from what GitHub said.
export function prSteps(pr: Pr): Step[] {
  const merged = pr.state === 'merged'
  const closed = pr.state === 'closed'
  const checks = pr.checks
  const ci: StepState = merged ? 'done'
    : checks === undefined ? 'todo'
    : checks.length === 0 ? 'na'
    : checks.some(c => c.outcome === 'failed') ? 'failed'
    : checks.some(c => c.outcome === 'running') ? 'now'
    : 'done'
  const r = pr.reviews
  const review: StepState = merged ? 'done'
    : r === undefined ? 'todo'
    : r.changesBy.length > 0 ? 'failed'
    : r.approvedBy.length > 0 || pr.state === 'ready' ? 'done'
    : pr.state === 'draft' ? 'todo'
    : 'waiting'
  const merge: StepState = merged ? 'done'
    : closed ? 'na'
    : pr.state === 'conflict' ? 'failed'
    : pr.state === 'behind' || pr.state === 'blocked' ? 'waiting'
    : pr.mergeable === 'yes' && pr.state === 'ready' ? 'now'
    : 'todo'
  const open: StepState = pr.state === 'draft' ? 'now' : 'done'
  const last: Step = merged ? (pr.mergedAt ? { label: 'Merged', state: 'done', at: pr.mergedAt } : { label: 'Merged', state: 'done' })
    : closed ? (pr.closedAt ? { label: 'Closed', state: 'failed', at: pr.closedAt } : { label: 'Closed', state: 'failed' })
    : { label: 'Merged', state: 'todo' }
  return [
    pr.createdAt ? { label: 'Open', state: open, at: pr.createdAt } : { label: 'Open', state: open },
    { label: 'CI', state: ci },
    { label: 'Review', state: review },
    { label: 'Merge', state: merge },
    last,
  ]
}

// The stage that matters now: the first not done, or the last when all are.
export function currentStep(steps: Step[]): Step | undefined {
  return steps.find(s => s.state !== 'done' && s.state !== 'na') ?? steps[steps.length - 1]
}

// Stages as text, fitted: "✓ Backlog → ✓ Todo → ● In Review → ○ Done", or "✓✓●○ In Review".
export function stepsLine(steps: Step[], columns: number): string {
  const full = steps.map(s => `${STEP_LOOK[s.state].glyph} ${s.label}`).join(' → ')
  if (full.length <= columns) return full
  const mid = steps.map(s => `${STEP_LOOK[s.state].glyph} ${s.label}`).join(' ')
  if (mid.length <= columns) return mid
  const cur = currentStep(steps)
  return fit(`${steps.map(s => STEP_LOOK[s.state].glyph).join('')}${cur ? ` ${cur.label}` : ''}`, columns)
}

// How long a ticket has been in its current state: "4d", from its history.
export function inStateFor(i: Issue, now: number): string | undefined {
  const at = [...(i.history ?? [])].reverse().find(h => h.name === i.status)?.at
  if (at === undefined) return undefined
  return ago(Date.parse(at), now).replace(' ago', '').replace('just now', '<1m')
}

// When a PR last moved: "merged 3d ago", "closed 1h ago", "open 4d".
export function prWhen(pr: Pr, now: number): string | undefined {
  if (pr.mergedAt) return `merged ${ago(Date.parse(pr.mergedAt), now)}`
  if (pr.closedAt) return `closed ${ago(Date.parse(pr.closedAt), now)}`
  if (pr.createdAt) return `open ${ago(Date.parse(pr.createdAt), now).replace(' ago', '')}`
  return undefined
}

// Words to lines of at most `columns`, at most `max` lines, the last cut with an ellipsis.
export function wrapLines(text: string, columns: number, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line === '') line = word
    else if (line.length + 1 + word.length <= columns) line += ` ${word}`
    else {
      out.push(line)
      line = word
    }
  }
  if (line !== '') out.push(line)
  const lines = out.map(l => fit(l, columns))
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  kept[max - 1] = fit(`${kept[max - 1]} ${lines.slice(max).join(' ')}`, columns)
  return kept
}
