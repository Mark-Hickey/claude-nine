import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Issue, Pr, PrState } from '../types'

const LIST_ISSUES = 'mcp__plugin_design_linear__list_issues'
const GET_ISSUE = 'mcp__plugin_design_linear__get_issue'
const HOUR = 60 * 60 * 1000
const SEEN_KEY = 'seen'
const PANE = 'linear-tickets'

const openIssues = atom({ plugin: 'linear-watch', key: 'open' } as const, [])

type Seen = Record<string, string>

// How each PR state reads: a glyph, its colour and a short label. Calm colours for
// "nothing to do", warm ones for "someone has to act".
export const PR_LOOK: Record<PrState, { glyph: string; color: string; label: string }> = {
  merged: { glyph: '✓', color: 'green', label: 'merged' },
  ready: { glyph: '●', color: 'cyan', label: 'ready' },
  running: { glyph: '◌', color: 'yellow', label: 'checks running' },
  review: { glyph: '◐', color: 'yellow', label: 'awaiting review' },
  changes: { glyph: '✎', color: 'yellow', label: 'changes requested' },
  failing: { glyph: '✗', color: 'red', label: 'checks failing' },
  draft: { glyph: '○', color: 'gray', label: 'draft' },
  closed: { glyph: '⊘', color: 'gray', label: 'closed' },
  unknown: { glyph: '?', color: 'gray', label: 'status unknown' },
}

export const isOpen = (i: Issue) => !['completed', 'canceled', 'duplicate'].includes(i.statusType)

// What changed since the last check: tickets new to the list, and tickets whose status moved.
export const diff = (issues: Issue[], seen: Seen) => {
  const added = issues.filter(i => !(i.id in seen))
  const moved = issues.filter(i => i.id in seen && seen[i.id] !== i.status)
  return { added, moved }
}

// The GitHub pull requests a ticket links to, from its attachments' URLs.
export function prRefs(attachments: { url?: string }[]): { repo: string; number: number; url: string }[] {
  const refs = attachments.flatMap(a => {
    const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(a.url ?? '')
    return m?.[1] && m[2] ? [{ repo: m[1], number: Number(m[2]), url: a.url as string }] : []
  })
  return refs.filter((r, i) => refs.findIndex(o => o.repo === r.repo && o.number === r.number) === i)
}

type GhPr = {
  state?: string
  isDraft?: boolean
  reviewDecision?: string | null
  statusCheckRollup?: { status?: string | null; conclusion?: string | null; state?: string | null }[]
}

// One state from what `gh pr view --json` reports. Merged and closed win; then checks; then review.
export function classifyPr(pr: GhPr): PrState {
  if (pr.state === 'MERGED') return 'merged'
  if (pr.state === 'CLOSED') return 'closed'
  if (pr.isDraft) return 'draft'
  const checks = pr.statusCheckRollup ?? []
  const outcome = (c: (typeof checks)[number]) => c.conclusion ?? c.state ?? ''
  if (checks.some(c => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(outcome(c)))) return 'failing'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes'
  if (checks.some(c => (c.status && c.status !== 'COMPLETED') || c.state === 'PENDING' || c.state === 'EXPECTED')) return 'running'
  return pr.reviewDecision === 'APPROVED' ? 'ready' : 'review'
}

// Who merges a ready PR: you in your own repos, your operator everywhere else (handbook rule 3).
export function prLabel(pr: Pr, me: string | null): string {
  if (pr.state !== 'ready') return PR_LOOK[pr.state].label
  const owner = pr.repo.split('/')[0]
  return me !== null && owner?.toLowerCase() === me.toLowerCase() ? 'ready · you merge' : 'ready · operator merges'
}

// "site#152" rather than "unsigned-gg/site#152": the org is the same everywhere here.
export const prName = (pr: Pr) => `${pr.repo.split('/')[1] ?? pr.repo}#${pr.number}`

// The pane's rows for one ticket: id and status, the title, a row per PR, the link.
export function paneRows(i: Issue, me: string | null = null): string[] {
  const prs = (i.prs ?? []).map(pr => `  ${PR_LOOK[pr.state].glyph} ${prName(pr)}  ${prLabel(pr, me)}`)
  return [`◆ ${i.id}  ${i.status}`, `  ${i.title}`, ...prs, `  ${i.url}`]
}

// The GitHub login gh is signed in as, read once; null when gh cannot say.
let login: string | null | undefined
async function myLogin($: EngineInterface): Promise<string | null> {
  if (login !== undefined) return login
  const gh = await $.process.run(['gh', 'api', 'user', '--jq', '.login'], { timeoutMs: 15_000 }).catch(() => null)
  login = gh?.exitCode === 0 && gh.stdout.trim() ? gh.stdout.trim() : null
  return login
}

async function fetchIssues($: EngineInterface): Promise<Issue[]> {
  const ran = await $.tool.call({
    tool: LIST_ISSUES,
    assignee: 'me',
    fields: ['title', 'status', 'statusType', 'url'],
    limit: 100,
  })
  if (ran.deny !== undefined || ran.isError) {
    throw new Error(ran.deny ?? ran.text ?? 'Linear call failed')
  }
  return JSON.parse(ran.text ?? '{}').issues ?? []
}

// The PRs linked to one ticket, each with its state on GitHub. A failure leaves the ticket without PRs.
async function fetchPrs($: EngineInterface, id: string): Promise<Pr[]> {
  try {
    const ran = await $.tool.call({ tool: GET_ISSUE, id })
    if (ran.deny !== undefined || ran.isError) return []
    const refs = prRefs(JSON.parse(ran.text ?? '{}').attachments ?? [])
    return await Promise.all(
      refs.map(async ref => {
        const gh = await $.process.run(
          ['gh', 'pr', 'view', String(ref.number), '-R', ref.repo, '--json', 'state,isDraft,reviewDecision,statusCheckRollup'],
          { timeoutMs: 20_000 },
        )
        const state = gh.exitCode === 0 ? classifyPr(JSON.parse(gh.stdout) as GhPr) : 'unknown'
        return { ...ref, state }
      }),
    )
  } catch {
    return []
  }
}

async function check($: EngineInterface): Promise<Issue[] | null> {
  let issues: Issue[]
  try {
    issues = await fetchIssues($)
  } catch {
    $.ui.status('Linear: check failed')
    return null
  }
  const open = await Promise.all(issues.filter(isOpen).map(async i => ({ ...i, prs: await fetchPrs($, i.id) })))
  await update($, openIssues, () => open)
  $.ui.status(`Linear: ${open.length} open`)

  const seen = ((await $.store.get(SEEN_KEY)) ?? null) as Seen | null
  if (seen !== null) {
    const { added, moved } = diff(issues, seen)
    for (const i of added) $.ui.toast(`New Linear ticket: ${i.id} ${i.title}`)
    for (const i of moved) $.ui.toast(`${i.id} moved to ${i.status}`)
  }
  await $.store.set(SEEN_KEY, Object.fromEntries(issues.map(i => [i.id, i.status])))
  return open
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tickets', description: 'List your open Linear tickets and their PRs now' })
    // Check now and hourly. The pane opens only on /tickets, never by itself.
    void check($)
    $.clock.every(HOUR, () => void check($))
    return next(e)
  })

  on('command.run', { command: 'tickets' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Linear tickets', focus: true })
    // Say why the pane is not showing, since an unplaced pane is otherwise silent.
    const note = opened.isPlaced ? '' : `\n(Pane not shown: ${opened.reason})`
    const open = await check($)
    if (open === null) return { text: `Could not reach Linear.${note}` }
    if (open.length === 0) return { text: `No open Linear tickets assigned to you.${note}` }
    const me = await myLogin($)
    return { text: open.map(i => paneRows(i, me).join('\n')).join('\n\n') + note }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const open = await read($, openIssues)
    const me = await myLogin($)

    return (
      <Box flexDirection="column">
        {open.length === 0 && <Text dimColor>No open Linear tickets assigned to you.</Text>}
        {open.map(i => (
          <Box key={i.id} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row">
              <Text color="cyan">◆ {i.id}</Text>
              <Text dimColor>  {i.status}</Text>
            </Box>
            <Text wrap="truncate-end">  {i.title}</Text>
            {(i.prs ?? []).map(pr => (
              <Box key={prName(pr)} flexDirection="row">
                <Text color={PR_LOOK[pr.state].color}>  {PR_LOOK[pr.state].glyph} </Text>
                <Text>{prName(pr)}</Text>
                <Text dimColor>  {prLabel(pr, me)}</Text>
              </Box>
            ))}
            <Text dimColor wrap="truncate-end">  {i.url}</Text>
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Draw this line, then let the mods beneath draw theirs under it.
    const below = await next(e)
    const open = await read($, openIssues)
    if (e.props.hasSurvey) return below

    const { Box, Text } = $.ui.resolve(e)
    const me = await myLogin($)
    const [first] = open
    const more = open.length > 1 ? `  +${open.length - 1} more` : ''

    return (
      <Box flexDirection="column">
        {first === undefined ? (
          <Text dimColor>◆ Linear: no open tickets</Text>
        ) : (
          <Box flexDirection="row">
            <Text color="cyan">◆ {first.id}</Text>
            <Text dimColor> · {first.status}</Text>
            {(first.prs ?? []).map(pr => (
              <Box key={prName(pr)} flexDirection="row">
                <Text color={PR_LOOK[pr.state].color}>   {PR_LOOK[pr.state].glyph} </Text>
                <Text dimColor>{prName(pr)} {prLabel(pr, me)}</Text>
              </Box>
            ))}
            <Text dimColor>{more}</Text>
          </Box>
        )}
        {below}
      </Box>
    )
  })
}
