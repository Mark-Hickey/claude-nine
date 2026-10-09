import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Health, Issue, Mode, Pr, StateVisit, Update } from '../types'
import { GH_FIELDS, PR_LOOK, STEP_LOOK, actionsForYou, allActions, allPrs, byUrgency, changes, groupPrs, inStateFor, isDone, isOpen, keyFor, prAction, prFromGh, prName, prRefs, prSteps, prWhen, rowCells, snapshotOf, stepsLine, ticketAction, ticketSteps, toastsFor } from './model'
import type { Action, GhPr, Snapshot } from './model'
import { band, cardRows, keyChart, paneHeader, rowsOf, prGroups, recent, ticketBlock, toolbar } from './view'


const HOUR = 60 * 60 * 1000
const TICKETS = 'linear-tickets'
const PRS = 'linear-prs'
// Store keys. 'seen' is the 0.4 snapshot (ticket id to status), read once if 'snapshot' is missing.
const SNAPSHOT_KEY = 'snapshot'
const LEGACY_SEEN_KEY = 'seen'
const MODE_KEY = 'mode'
const UPDATES_KEY = 'updates'
const FAILED = 'linear-watch: that command failed. The debug log (claude --debug) has the reason.'

const openIssues = atom({ plugin: 'linear-watch', key: 'open' } as const, [])
const modeAtom = atom({ plugin: 'linear-watch', key: 'mode' } as const, { band: 'expanded', pane: 'expanded', key: false })
const updatesAtom = atom({ plugin: 'linear-watch', key: 'updates' } as const, [])
const unseenAtom = atom({ plugin: 'linear-watch', key: 'unseen' } as const, 0)
const healthAtom = atom({ plugin: 'linear-watch', key: 'health' } as const, { failures: 0 })
const checkingAtom = atom({ plugin: 'linear-watch', key: 'checking' } as const, false)

type ModeState = { band: Mode; pane: Mode; key: boolean }

// Open tickets most pressing first: the band's one line shows the ticket with the PR that needs the most.
const byTicketUrgency = (a: Issue, b: Issue) => {
  const top = (i: Issue) => [...(i.prs ?? [])].sort(byUrgency)[0]
  const ta = top(a)
  const tb = top(b)
  if (ta === undefined || tb === undefined) return ta === undefined ? (tb === undefined ? 0 : 1) : -1
  return byUrgency(ta, tb)
}

// The plain-text lists the commands return: for terminals too narrow for a pane, and for scrollback.
// Each ticket and active PR has a stages line and its next action with the page to do it on;
// finished PRs take one line. Terminals make the bare URLs clickable.
const prHead = (c: ReturnType<typeof rowCells>[number] | undefined, pr: Pr) =>
  c ? `${c.glyph} ${c.name}  ${c.state}${c.showCi ? `  ${c.ci}` : ''}${c.showNext ? `  ${c.next}` : ''}`.trimEnd() : prName(pr)
const doneText = (pr: Pr, now: number) => `${PR_LOOK[pr.state].glyph} ${prName(pr)}  ${prWhen(pr, now) ?? pr.state}`
const actionText = (a: Action) => `${a.who === 'you' ? '→' : '·'} Next: ${a.text} · ${a.url}`

export function ticketsText(open: Issue[], me: string | null, now: number, columns = 100): string {
  if (open.length === 0) return 'No open Linear tickets assigned to you.'
  const blocks = open.map(i => {
    const prs = [...(i.prs ?? [])].sort(byUrgency)
    const active = prs.filter(p => !isDone(p))
    const cells = rowCells(active, me, columns - 2)
    const since = inStateFor(i, now)
    const close = ticketAction(i)
    const rows = active.flatMap((pr, n) => {
      const when = prWhen(pr, now)
      return [`  ${prHead(cells[n], pr)}`, `      ${stepsLine(prSteps(pr), columns - 6)}${when ? ` · ${when}` : ''}`, `      ${actionText(prAction(pr, me))}`]
    })
    return [
      `◆ ${i.id}  ${i.status}${since ? ` · ${since}` : ''}`,
      `  ${i.title}`,
      `  ${stepsLine(ticketSteps(i), columns - 2)}`,
      ...(close ? [`  ${actionText(close)}`] : []),
      ...rows,
      ...prs.filter(isDone).map(pr => `  ${doneText(pr, now)}`),
      ...(prs.length === 0 ? ['  No linked PRs'] : []),
      ...(close ? [] : [`  ${i.url}`]),
    ].join('\n')
  })
  return blocks.join('\n\n') + legend(open)
}

export function prsText(open: Issue[], me: string | null, now: number, columns = 100): string {
  const prs = allPrs(open)
  if (prs.length === 0) return 'No pull requests are linked to your open Linear tickets.'
  const groups = groupPrs(prs, me).map(g => {
    if (g.title === 'Done') return [`Done (${g.prs.length})`, ...g.prs.map(pr => `  ${doneText(pr, now)}${pr.ticket ? ` · ${pr.ticket}` : ''}`)].join('\n')
    const cells = rowCells(g.prs, me, columns - 2)
    const rows = g.prs.map((pr, n) => {
      const when = prWhen(pr, now)
      return [`  ${prHead(cells[n], pr)}`, `      ${stepsLine(prSteps(pr), columns - 6)}${when ? ` · ${when}` : ''}${pr.ticket ? ` · ${pr.ticket}` : ''}`, `      ${actionText(prAction(pr, me))}`].join('\n')
    })
    return [`${g.title} (${g.prs.length})`, ...rows].join('\n')
  })
  const close = open.flatMap(i => ticketAction(i) ?? [])
  const closing = close.length > 0 ? [`Tickets to close (${close.length})`, ...close.map(a => `  ${actionText(a)}`)].join('\n') : undefined
  return [...(closing ? [closing] : []), ...groups].join('\n\n') + legend(open)
}

// The key at the end of the text lists: the PR states in use, then the stage marks.
function legend(open: Issue[]): string {
  const key = keyFor(open)
  const marks = (['done', 'now', 'waiting', 'failed', 'todo'] as const).map(s => `${STEP_LOOK[s].glyph} ${STEP_LOOK[s].word}`).join('  ')
  return `\n\nKey:\n${key.map(k => `  ${k}`).join('\n')}${key.length > 0 ? '\n' : ''}  Stages: ${marks}`
}

// The status line: open tickets, and how many actions wait on you (PR fixes and tickets to close).
export function statusText(open: Issue[], me: string | null): string {
  const mine = actionsForYou(open, me).length
  return `Linear: ${open.length} open${mine > 0 ? ` · ${mine} need${mine === 1 ? 's' : ''} you` : ''}`
}

// --- Reading Linear and GitHub. Linear comes through whichever Linear MCP server the session has;
// GitHub through the gh CLI and its own sign-in. No tokens are read or kept here.
// The Linear servers a session may have, newest first: the claude.ai connector, then the
// design plugin's server. The first that answers is kept for the rest of the session.
const LINEAR_SERVERS = ['mcp__claude_ai_Linear__', 'mcp__plugin_design_linear__'] as const

let server: string | undefined

type Ran = { deny?: string; isError?: boolean; text?: string }

// Calls a Linear tool on the server that last answered, trying each in turn until one does.
async function linearCall($: EngineInterface, name: string, input: Record<string, unknown>): Promise<string> {
  const order = server ? [server, ...LINEAR_SERVERS.filter(s => s !== server)] : [...LINEAR_SERVERS]
  let last = 'no Linear server in this session'
  for (const s of order) {
    try {
      // The tool's name is built at run time, so no typed overload names it.
      const ran = (await $.tool.call({ tool: `${s}${name}`, ...input } as never)) as Ran
      if (ran.deny === undefined && !ran.isError) {
        server = s
        return ran.text ?? '{}'
      }
      last = ran.deny ?? ran.text ?? `${s}${name} failed`
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(last)
}

const nameOf = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : v && typeof v === 'object' && 'name' in v && typeof v.name === 'string' ? v.name : undefined

async function fetchIssues($: EngineInterface): Promise<Issue[]> {
  const text = await linearCall($, 'list_issues', {
    assignee: 'me',
    fields: ['title', 'status', 'statusType', 'url', 'priority', 'project', 'updatedAt'],
    limit: 100,
  })
  const raw = (JSON.parse(text).issues ?? []) as Record<string, unknown>[]
  return raw.map(r => {
    const i: Issue = {
      id: String(r.id),
      title: String(r.title ?? ''),
      status: String(nameOf(r.status) ?? r.status ?? ''),
      statusType: String(r.statusType ?? ''),
      url: String(r.url ?? ''),
    }
    const priority = nameOf(r.priority)
    const project = nameOf(r.project)
    if (priority && priority !== 'No priority') i.priority = priority
    if (project) i.project = project
    if (typeof r.updatedAt === 'string') i.updatedAt = r.updatedAt
    return i
  })
}

// One ticket's details: its linked PRs, each with its state on GitHub, and the states it went
// through. A ticket Linear cannot read keeps no PRs; a PR gh cannot read is kept, honestly, as 'unknown'.
async function fetchDetail($: EngineInterface, ticket: string): Promise<{ prs: Pr[]; history?: StateVisit[] }> {
  let raw: { attachments?: { url?: string }[]; stateHistory?: { state?: { name?: string; type?: string }; startedAt?: string }[] }
  try {
    raw = JSON.parse(await linearCall($, 'get_issue', { id: ticket }))
  } catch {
    return { prs: [] }
  }
  const history = (raw.stateHistory ?? []).flatMap(h =>
    h.state?.name && h.startedAt ? [{ name: h.state.name, type: h.state.type ?? '', at: h.startedAt }] : [],
  )
  const prs = await Promise.all(
    prRefs(raw.attachments ?? []).map(async ref => {
      try {
        const gh = await $.process.run(['gh', 'pr', 'view', String(ref.number), '-R', ref.repo, '--json', GH_FIELDS], { timeoutMs: 20_000 })
        if (gh.exitCode === 0) return prFromGh(ref, JSON.parse(gh.stdout) as GhPr, ticket)
      } catch {
        // Fall through to unknown.
      }
      return { ...ref, state: 'unknown' as const, ticket }
    }),
  )
  return history.length > 0 ? { prs, history } : { prs }
}

// The GitHub login gh is signed in as, read once; null when gh cannot say.
let login: string | null | undefined
async function myLogin($: EngineInterface): Promise<string | null> {
  if (login !== undefined) return login
  const gh = await $.process.run(['gh', 'api', 'user', '--jq', '.login'], { timeoutMs: 15_000 }).catch(() => null)
  login = gh?.exitCode === 0 && gh.stdout.trim() ? gh.stdout.trim() : null
  return login
}

let inflight: Promise<Issue[] | null> | null = null

// One check: Linear, then each open ticket's PRs, then what changed. Concurrent callers share it.
function check($: EngineInterface): Promise<Issue[] | null> {
  inflight ??= run($).finally(() => {
    inflight = null
  })
  return inflight
}

async function run($: EngineInterface): Promise<Issue[] | null> {
  await update($, checkingAtom, () => true)
  try {
    let issues: Issue[]
    try {
      issues = await fetchIssues($)
    } catch (err) {
      const health: Health = await update($, healthAtom, h => ({ ...h, failures: h.failures + 1, lastError: err instanceof Error ? err.message : String(err) }))
      $.ui.status(health.lastOk === undefined ? 'Linear: unreachable' : 'Linear: unreachable · showing older data')
      // One failure is often a blip; say so once, on the second in a row.
      if (health.failures === 2) $.ui.toast('linear-watch: Linear is unreachable. The band shows the last good data.', { timeoutMs: 8000 })
      return null
    }
    const me = await myLogin($)
    const open = (await Promise.all(issues.filter(isOpen).map(async i => ({ ...i, ...(await fetchDetail($, i.id)) })))).sort(byTicketUrgency)
    const now = await $.clock.now()

    // Compare with what the last check saw. A missing snapshot (first run) toasts nothing.
    const stored = (await $.store.get(SNAPSHOT_KEY)) as Snapshot | undefined
    const legacy = stored === undefined ? ((await $.store.get(LEGACY_SEEN_KEY)) as Record<string, string> | undefined) : undefined
    const before: Snapshot | null = stored ?? (legacy !== undefined ? { tickets: legacy } : null)
    const all = issues.map(i => open.find(o => o.id === i.id) ?? i)
    const found = changes(before, all, me, now)
    await $.store.set(SNAPSHOT_KEY, snapshotOf(all, me, before))

    await update($, openIssues, () => open)
    await update($, healthAtom, () => ({ failures: 0, lastOk: now }))
    $.ui.status(statusText(open, me))
    if (found.length > 0) {
      const kept: Update[] = await update($, updatesAtom, list => [...found, ...list].slice(0, 30))
      await $.store.set(UPDATES_KEY, kept)
      await update($, unseenAtom, n => n + found.filter(u => u.level !== 'quiet').length)
      for (const t of toastsFor(found)) $.ui.toast(t.text, { timeoutMs: t.timeoutMs })
    }
    return open
  } finally {
    await update($, checkingAtom, () => false)
  }
}

async function setMode($: EngineInterface, fn: (m: ModeState) => ModeState) {
  const next = await update($, modeAtom, fn)
  await $.store.set(MODE_KEY, next)
}

// /tickets and /prs: a mode argument sets the band; otherwise open the pane and list the same data as text.
async function runCommand($: EngineInterface, args: string, command: 'tickets' | 'prs'): Promise<{ text: string }> {
  const mode = modeArg(args)
  if (mode !== undefined) {
    await setMode($, m => ({ ...m, band: mode }))
    return { text: `The band above the prompt is now ${mode === 'expanded' ? 'expanded (cards)' : 'compact (one line)'}.` }
  }
  const opened = command === 'tickets'
    ? await $.ui.open({ id: TICKETS, title: 'Linear tickets', focus: true, closeOnEscape: true })
    : await $.ui.open({ id: PRS, title: 'PR Watch', focus: true, closeOnEscape: true })
  await update($, unseenAtom, () => 0)
  // Say why the pane is not showing, since an unplaced pane is otherwise silent.
  const note = opened.isPlaced ? '' : `\n(Pane not shown: ${opened.reason})`
  const open = await check($)
  if (open === null) return { text: `Could not reach Linear: ${(await read($, healthAtom)).lastError ?? 'no answer'}.${note}` }
  const me = await myLogin($)
  const now = await $.clock.now()
  return { text: (command === 'tickets' ? ticketsText(open, me, now) : prsText(open, me, now)) + note }
}

// Opens a page in the person's browser: through Windows from WSL, else the desktop's opener.
// Only https pages from Linear or GitHub data; the URL goes in as an argument, never as shell text.
async function openUrl($: EngineInterface, url: string, label: string) {
  if (!/^https:\/\/[^\s]+$/.test(url)) {
    $.ui.toast(`linear-watch: not opening ${label}: not an https link`)
    return
  }
  const opener = 'if command -v wslview >/dev/null; then wslview "$1"; elif command -v explorer.exe >/dev/null; then explorer.exe "$1"; elif command -v xdg-open >/dev/null; then xdg-open "$1"; else open "$1"; fi'
  const ran = await $.process.run(['sh', '-c', opener, 'open-url', url], { timeoutMs: 10_000 }).catch(() => null)
  // explorer.exe reports exit 1 even when it opened the page; only a missing opener is a failure.
  if (ran === null || ran.exitCode === 127) $.ui.toast(`linear-watch: could not open a browser. The link: ${url}`, { timeoutMs: 10_000 })
  else $.ui.toast(`Opened: ${label}`)
}

// The pane toolbar's actions: each one real, each one the same in both panes.
function actions($: EngineInterface, pane: string) {
  return {
    toggle: () => setMode($, m => ({ ...m, pane: m.pane === 'expanded' ? 'compact' : 'expanded' })),
    refresh: () => check($),
    key: () => setMode($, m => ({ ...m, key: !m.key })),
    close: () => $.ui.close({ id: pane }),
    open: (url: string, label: string) => openUrl($, url, label),
  }
}

// "compact" or "expand(ed)" sets the band's mode; anything else leaves it.
export function modeArg(args: string): Mode | undefined {
  const a = args.trim().toLowerCase()
  if (a === 'compact' || a === 'less') return 'compact'
  if (a === 'expand' || a === 'expanded' || a === 'more') return 'expanded'
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const hint = '[compact | expand]: one line or cards above the prompt'
    await $.command.register({ name: 'tickets', description: 'Your open Linear tickets and their PRs', argumentHint: hint })
    await $.command.register({ name: 'prs', description: 'PR Watch: the PRs on your Linear tickets, by who acts next', argumentHint: hint })
    // Restore the person's modes and recent changes; check now and hourly.
    const mode = (await $.store.get(MODE_KEY)) as ModeState | undefined
    if (mode !== undefined) await update($, modeAtom, m => ({ ...m, ...mode }))
    const updates = (await $.store.get(UPDATES_KEY)) as Update[] | undefined
    if (updates !== undefined) await update($, updatesAtom, () => updates)
    // A check that fails is already reported on the status line; nothing else waits on it.
    check($).catch(() => undefined)
    $.clock.every(HOUR, () => void check($).catch(() => undefined))
    return next(e)
  })

  // A command that throws says so in its own output rather than going silent.
  on('command.run', { command: 'tickets' }, ($, e) => runCommand($, e.args ?? '', 'tickets'))
    .catch(($, e, next) => (next.called ? next(e) : { text: FAILED }))
  on('command.run', { command: 'prs' }, ($, e) => runCommand($, e.args ?? '', 'prs'))
    .catch(($, e, next) => (next.called ? next(e) : { text: FAILED }))

  on('ui.render', { component: 'Pane', requestId: TICKETS }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const [open, mode, health, checking, updates, me, now] = await Promise.all([
      read($, openIssues), read($, modeAtom), read($, healthAtom), read($, checkingAtom), read($, updatesAtom), myLogin($), $.clock.now(),
    ])
    // The pane's own body width: docked beside the transcript it is far narrower than the terminal.
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    const act = actions($, TICKETS)
    return (
      <Box flexDirection="column">
        {paneHeader(ui, 'Linear Tickets', `${open.length} open`, health, checking, now, columns)}
        {open.length === 0 && <Text dimColor>No open Linear tickets assigned to you.</Text>}
        {open.map(i => ticketBlock(ui, i, me, columns, mode.pane, now, act.open))}
        {mode.pane === 'expanded' && recent(ui, updates, now, columns, () => true)}
        {mode.key && keyChart(ui, columns)}
        {toolbar(ui, mode.pane, mode.key, allActions(open, me)[0], act)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PRS }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const [open, mode, health, checking, updates, me, now] = await Promise.all([
      read($, openIssues), read($, modeAtom), read($, healthAtom), read($, checkingAtom), read($, updatesAtom), myLogin($), $.clock.now(),
    ])
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    const prs = allPrs(open)
    const mine = actionsForYou(open, me).length
    const act = actions($, PRS)
    const closing = open.flatMap(i => ticketAction(i) ?? [])
    return (
      <Box flexDirection="column">
        {paneHeader(ui, 'Pull Requests', `${prs.filter(p => !isDone(p)).length} open${mine > 0 ? ` · ${mine} need${mine === 1 ? 's' : ''} you` : ''}`, health, checking, now, columns)}
        {prs.length === 0 && <Text dimColor>No pull requests are linked to your open Linear tickets.</Text>}
        {closing.length > 0 && <Text color="yellow" bold>{`TICKETS TO CLOSE · ${closing.length}`}</Text>}
        {closing.map(a => <Text key={`close:${a.ticket}`} color="cyan">{`  → ${a.text}`}</Text>)}
        {closing.length > 0 && <Text>{' '}</Text>}
        {prGroups(ui, prs, me, columns, mode.pane, now, act.open)}
        {mode.pane === 'expanded' && recent(ui, updates, now, columns, u => u.pr !== undefined)}
        {mode.key && keyChart(ui, columns)}
        {toolbar(ui, mode.pane, mode.key, allActions(open, me)[0], act)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Draw this line, then let the mods beneath draw theirs under it.
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const ui = $.ui.resolve(e)
    const [open, mode, unseen, health, me, now] = await Promise.all([read($, openIssues), read($, modeAtom), read($, unseenAtom), read($, healthAtom), myLogin($), $.clock.now()])
    // The band's own width, not the terminal's: it leaves room for the engine's marks.
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    const prs = allPrs(open)
    const toggle = () => setMode($, m => ({ ...m, band: m.band === 'expanded' ? 'compact' : 'expanded' }))
    // The band is shared and capped at maxRows. When the cards and the other mods' drawing
    // would not fit together, fold to one line so nobody's drawing scrolls out of view.
    const fits = cardRows(open, prs, columns) + rowsOf(below) <= (e.props.maxRows ?? 24)
    const shown: Mode = mode.band === 'expanded' && !fits ? 'compact' : mode.band
    return (
      <ui.Box flexDirection="column">
        {band(ui, open, prs, me, columns, shown, unseen, health, now, toggle, (url, label) => openUrl($, url, label))}
        {below}
      </ui.Box>
    )
  })
}
