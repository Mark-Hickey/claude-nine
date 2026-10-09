// Drawing: one card design for the band, the Tickets pane and the PRs pane.
// A card is a rounded border, a bold header with a dim count on the right, rows of
// bold name + dim sub-line with the status word right-aligned, and a dim footer.
// Every element comes from the surface's own table, so nothing here assumes a terminal.
import type { EngineInterface } from 'claude-code'

import type { Health, Issue, Mode, Pr, Step, Update } from '../types'
import { PR_LOOK, KEY_ORDER, STEP_LOOK, actionsForYou, ago, byUrgency, ciText, currentStep, fit, groupPrs, inStateFor, isDone, mergeText, nextActor, prAction, prKey, prName, prSteps, prWhen, reviewText, ticketAction, ticketSteps, wrapLines } from './model'
import type { Action } from './model'

export type Ui = ReturnType<EngineInterface['ui']['resolve']>

// Opens a page in the person's browser; the hooks module owns how.
export type Open = (url: string, label: string) => unknown

// The short, upper-case status word a row ends with.
export const PR_WORD: Record<Pr['state'], string> = {
  merged: 'MERGED', ready: 'READY', blocked: 'BLOCKED', running: 'RUNNING', review: 'REVIEW', changes: 'CHANGES',
  failing: 'FAILING', conflict: 'CONFLICT', behind: 'BEHIND', draft: 'DRAFT', closed: 'CLOSED', unknown: 'UNKNOWN',
}

// The sub-line under a PR's name: what the state means for you, in plain words.
export function prSubline(pr: Pr, me: string | null): string {
  switch (pr.state) {
    case 'ready':
      return nextActor(pr, me) === 'you' ? 'You can merge' : 'Your operator can merge'
    case 'review':
      return 'Waiting for reviewer'
    case 'running':
      return 'CI checks running'
    case 'failing':
      return 'CI checks failed'
    case 'changes':
      return 'Reviewer asked for changes'
    case 'conflict':
      return 'Merge conflict with base'
    case 'behind':
      return 'Branch behind base'
    case 'blocked':
      return 'Branch rules block the merge'
    case 'draft':
      return 'Draft, not ready for review'
    case 'merged':
      return 'Merged'
    case 'closed':
      return 'Closed without merge'
    default:
      return 'GitHub did not answer'
  }
}

// A PR's sub-line with its CI: the plain-words state, plus the CI result when that adds something.
// "CI checks failed · CI failed 1/1" says it twice, so a CI state carries its own count instead.
export function prSubWithCi(pr: Pr, me: string | null): string {
  const checks = pr.checks ?? []
  const failed = checks.filter(c => c.outcome === 'failed').length
  const running = checks.filter(c => c.outcome === 'running').length
  if (pr.state === 'failing') return `${failed} of ${checks.length} CI check${checks.length === 1 ? '' : 's'} failed`
  if (pr.state === 'running') return `CI running, ${checks.length - running} of ${checks.length} done`
  return `${prSubline(pr, me)} · ${ciText(pr)}`
}

// A Linear status's colour by its type: started cyan, triage yellow, done green, the rest gray.
export const ticketColor = (i: Issue) =>
  i.statusType === 'started' ? 'cyan' : i.statusType === 'triage' ? 'yellow' : i.statusType === 'completed' ? 'green' : 'gray'

// The icon on a "Next action" line, by who acts.
const ACTOR_ICON = { you: '→', author: '→', operator: '⚑', reviewer: '◷', ci: '◌', none: '✓', unknown: '?' } as const

const rule = ({ Text }: Ui, width: number) => <Text dimColor>{'─'.repeat(Math.max(0, width))}</Text>

// A card's header: bold title left, dim count right.
function header({ Box, Text }: Ui, title: string, count: string) {
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text bold>{title}</Text>
      <Text dimColor>{count}</Text>
    </Box>
  )
}

// A two-line row: glyph and name (a link to its page) with a dim sub-line, the status word
// right-aligned in colour. With stages, the sub-line starts with one glyph per stage.
// `strong` marks a row that needs you: its sub-line is drawn in the row's colour, not dim.
function cardRow({ Box, Text, Link }: Ui, key: string, glyph: string, color: string, name: string, url: string, sub: string, word: string, inner: number, steps?: Step[], strong = false) {
  // The left column shares the row with the status word, so both its lines leave room for it.
  const room = Math.max(4, inner - word.length - 4)
  const marks = steps ?? []
  const subRoom = Math.max(4, room - (marks.length > 0 ? marks.length + 1 : 0))
  return (
    <Box key={key} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={color}>{`${glyph} `}</Text>
          <Link href={url}>{fit(name, room)}</Link>
        </Box>
        <Text>
          <Text>{'  '}</Text>
          {marks.map((st, n) => <Text key={`m${n}`} color={STEP_LOOK[st.state].color}>{STEP_LOOK[st.state].glyph}</Text>)}
          <Text color={strong ? color : undefined} dimColor={!strong}>{`${marks.length > 0 ? ' ' : ''}${fit(sub, subRoom)}`}</Text>
        </Text>
      </Box>
      <Text color={color} bold>{word}</Text>
    </Box>
  )
}

// A finished PR in one dim line: "✓ unsigned-onboard#7 · merged 3d ago". It stays in view while
// its ticket is open, without taking a card's room.
function doneLine({ Box, Text, Link }: Ui, pr: Pr, inner: number, now: number, indent = 0) {
  const look = PR_LOOK[pr.state]
  const when = prWhen(pr, now) ?? (pr.state === 'merged' ? 'merged' : 'closed')
  return (
    <Box key={`done:${prKey(pr)}`} flexDirection="row" marginLeft={indent}>
      <Text color={look.color} dimColor>{`${look.glyph} `}</Text>
      <Link href={pr.url}>{fit(prName(pr), Math.max(4, inner - indent - when.length - 5))}</Link>
      <Text dimColor>{` · ${when}`}</Text>
    </Box>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// A card's border: the colour of what needs you, or dim when nothing does. This is what makes a
// card that needs you stand out from the ones that only wait.
const edge = (color: string | undefined) => (color !== undefined ? { borderColor: color } : { borderDimColor: true })

// The PR Watch card: active PRs most pressing first, finished ones folded into one line.
function prCard(ui: Ui, prs: Pr[], me: string | null, width: number, max: number, now: number, footer: ReturnType<typeof footerRow>) {
  const { Box, Text } = ui
  const inner = width - 4
  const active = prs.filter(p => !isDone(p)).sort(byUrgency)
  const done = prs.filter(isDone)
  const shown = active.slice(0, max)
  const mine = active.find(p => nextActor(p, me) === 'you')
  return (
    <Box key="lw-prcard" flexDirection="column" borderStyle="round" {...edge(mine ? PR_LOOK[mine.state].color : undefined)} paddingX={1} width={width}>
      {header(ui, '⑂ PR Watch', `${active.length} open${done.length > 0 ? ` · ${done.length} done` : ''}`)}
      {rule(ui, inner)}
      {prs.length === 0 && <Text dimColor>No PRs linked to your tickets</Text>}
      {shown.map(pr => cardRow(ui, `lw-pr:${prKey(pr)}`, PR_LOOK[pr.state].glyph, PR_LOOK[pr.state].color, prName(pr), prAction(pr, me).url, prSubline(pr, me), PR_WORD[pr.state], inner, prSteps(pr), nextActor(pr, me) === 'you'))}
      {active.length > shown.length && <Text dimColor>{`  +${active.length - shown.length} more`}</Text>}
      {done.length === 1 && doneLine(ui, done[0] as Pr, inner, now)}
      {done.length > 1 && <Text dimColor>{`✓ ${done.length} merged or closed`}</Text>}
      {rule(ui, inner)}
      {footer}
    </Box>
  )
}

// The sub-line for a ticket in the band: its next step when it has one, else its title.
const ticketSub = (i: Issue) => (ticketAction(i) !== undefined ? `All PRs merged → move to Done` : i.title)

// The Linear Watch card: up to `max` tickets, most pressing first.
function ticketCard(ui: Ui, open: Issue[], width: number, max: number, footer: ReturnType<typeof footerRow>) {
  const { Box, Text } = ui
  const inner = width - 4
  const shown = open.slice(0, max)
  const closing = open.some(i => ticketAction(i) !== undefined)
  return (
    <Box key="lw-tcard" flexDirection="column" borderStyle="round" {...edge(closing ? 'cyan' : undefined)} paddingX={1} width={width}>
      {header(ui, '◆ Linear Watch', plural(open.length, 'open ticket'))}
      {rule(ui, inner)}
      {open.length === 0 && <Text dimColor>No open tickets assigned to you</Text>}
      {shown.map(i => cardRow(ui, `lw-t:${i.id}`, '◆', ticketColor(i), i.id, i.url, ticketSub(i), i.status.toUpperCase(), inner, ticketSteps(i), ticketAction(i) !== undefined))}
      {open.length > shown.length && <Text dimColor>{`  +${open.length - shown.length} more`}</Text>}
      {rule(ui, inner)}
      {footer}
    </Box>
  )
}

// A card footer: a hint on the left; on the right the open-next button, warnings and the fold.
// `next` is the action `o` opens: the first that needs you, when there is one.
function footerRow({ Box, Text, Button }: Ui, hint: string, unseen: number, health: Health, next?: Action, open?: Open, toggle?: () => unknown) {
  return (
    <Box flexDirection="row" justifyContent="space-between">
      {next !== undefined && open !== undefined ? (
        <Button key="lw-band-open" plain hotkey="o" label={fit(next.text, 28)} onPress={() => open(next.url, next.text)} />
      ) : (
        <Text dimColor>{hint}</Text>
      )}
      <Box flexDirection="row">
        {unseen > 0 && <Text color="yellow">{`• ${unseen} new  `}</Text>}
        {health.failures > 0 && <Text color="yellow">{'⚠ stale  '}</Text>}
        {toggle !== undefined && <Button key="lw-band" plain dimColor hotkey="e" label="⌄" onPress={toggle} />}
      </Box>
    </Box>
  )
}

// The band above the prompt.
// expanded (the default): the two cards, side by side from 100 columns, one combined card below that.
// compact: one line for the most pressing ticket and PR, for when the cards take too much room.
export function band(ui: Ui, open: Issue[], prs: Pr[], me: string | null, columns: number, mode: Mode, unseen: number, health: Health, now: number, toggle: () => unknown, openUrl: Open) {
  const { Box, Text, Button, Link } = ui
  const next = actionsForYou(open, me)[0]
  if (mode === 'compact') {
    const top = prs.filter(p => !isDone(p)).sort(byUrgency)[0]
    const [first] = open
    return (
      <Box flexDirection="row">
        {first === undefined ? <Text dimColor>◆ Linear: no open tickets</Text> : (
          <Box flexDirection="row">
            <Text color={ticketColor(first)}>◆ </Text>
            <Link href={first.url}>{first.id}</Link>
            <Text dimColor>{` ${first.status}`}</Text>
          </Box>
        )}
        {top !== undefined && (
          <Box flexDirection="row">
            <Text dimColor> · </Text>
            <Text color={PR_LOOK[top.state].color}>{`${PR_LOOK[top.state].glyph} `}</Text>
            <Link href={prAction(top, me).url}>{prName(top)}</Link>
            <Text color={PR_LOOK[top.state].color}>{` ${PR_WORD[top.state]}`}</Text>
          </Box>
        )}
        {next !== undefined && columns >= 90 && <Text color={next.color} bold>{`  → ${fit(next.text, 30)}`}</Text>}
        {open.length > 1 && <Text dimColor>{`  +${open.length - 1}`}</Text>}
        {unseen > 0 && <Text color="yellow">{`  • ${unseen} new`}</Text>}
        {health.failures > 0 && <Text color="yellow">  ⚠ stale</Text>}
        <Text>  </Text>
        <Button key="lw-band" plain dimColor hotkey="e" label="⌃" onPress={toggle} />
      </Box>
    )
  }
  // Side by side needs room for two cards of 48; capped so very wide terminals do not stretch them thin.
  if (columns >= 100) {
    const width = Math.min(72, Math.floor((columns - 1) / 2))
    return (
      <Box flexDirection="row" gap={1}>
        {ticketCard(ui, open, width, 3, footerRow(ui, '/tickets for details', 0, health))}
        {prCard(ui, prs, me, width, 3, now, footerRow(ui, '/prs for details', unseen, health, next, openUrl, toggle))}
      </Box>
    )
  }
  // Narrow: one card, tickets then PRs, so the band stays one block.
  const width = Math.max(30, Math.min(columns, 72))
  const inner = width - 4
  const active = prs.filter(p => !isDone(p)).sort(byUrgency)
  const done = prs.filter(isDone)
  return (
    <Box flexDirection="column" borderStyle="round" {...edge(next?.color)} paddingX={1} width={width}>
      {header(ui, '◆ Linear · ⑂ PRs', `${open.length} · ${active.length}`)}
      {rule(ui, inner)}
      {open.slice(0, 2).map(i => cardRow(ui, `lw-t:${i.id}`, '◆', ticketColor(i), i.id, i.url, ticketSub(i), i.status.toUpperCase(), inner, ticketSteps(i), ticketAction(i) !== undefined))}
      {active.slice(0, 3).map(pr => cardRow(ui, `lw-pr:${prKey(pr)}`, PR_LOOK[pr.state].glyph, PR_LOOK[pr.state].color, prName(pr), prAction(pr, me).url, prSubline(pr, me), PR_WORD[pr.state], inner, prSteps(pr), nextActor(pr, me) === 'you'))}
      {done.length === 1 && doneLine(ui, done[0] as Pr, inner, now)}
      {done.length > 1 && <Text dimColor>{`✓ ${done.length} merged or closed`}</Text>}
      {rule(ui, inner)}
      {footerRow(ui, '/prs · /tickets', unseen, health, next, openUrl, toggle)}
    </Box>
  )
}

// How many rows a drawn tree takes, roughly: a column stacks, a row takes its tallest child,
// a border adds two, a margin its size, hidden boxes none. Used to share the band with other mods.
export function rowsOf(node: unknown): number {
  if (node === null || node === undefined || node === false || node === true) return 0
  if (typeof node === 'string' || typeof node === 'number') return 1
  if (Array.isArray(node)) return node.reduce((n: number, c) => n + rowsOf(c), 0)
  if (typeof node !== 'object') return 0
  const el = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const p = el.props ?? {}
  if (p.display === 'none') return 0
  if (el.type !== 'Box') return 1
  const kids = (el.children ?? []).flat()
  const inner = p.flexDirection === 'row' ? Math.max(0, ...kids.map(rowsOf)) : kids.reduce((n: number, c) => n + rowsOf(c), 0)
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  return inner + (p.borderStyle ? 2 : 0) + num(p.marginTop) + num(p.marginBottom) + 2 * num(p.marginY) + 2 * num(p.paddingY)
}

// Rows the expanded band takes: two cards side by side (the taller counts) or one combined card.
// Active PRs take two rows each; finished ones fold into one row.
export function cardRows(open: Issue[], prs: Pr[], columns: number): number {
  const active = prs.filter(p => !isDone(p)).length
  const folded = prs.some(isDone) ? 1 : 0
  const card = (n: number, total: number, extra: number) => 6 + 2 * n + (total > n ? 1 : 0) + extra
  if (columns >= 100) return Math.max(card(Math.min(3, open.length) || 1, open.length, 0), card(Math.min(3, active), active, folded) || 7)
  return 6 + 2 * (Math.min(2, open.length) + Math.min(3, active)) + folded
}

// --- Panes -----------------------------------------------------------------------------------

// How wide a pane's cards are: the pane's own body, never the terminal's, up to a readable 96.
// Below 26 columns a border costs too much, so cards go borderless.
export const paneLayout = (bodyColumns: number) => {
  const width = Math.max(12, Math.min(bodyColumns, 96))
  const bordered = width >= 26
  return { width, bordered, inner: bordered ? width - 4 : width }
}

// A pane's title row: bold title left, count and age right; stacked when narrow.
export function paneHeader(ui: Ui, title: string, count: string, health: Health, checking: boolean, now: number, columns: number) {
  const { Box, Text } = ui
  const when = checking ? 'checking…' : health.lastOk !== undefined ? ago(health.lastOk, now) : 'not checked yet'
  const right = `${count} · ${when}`
  const oneRow = title.length + right.length + 2 <= columns
  return (
    <Box flexDirection="column" marginBottom={1}>
      {oneRow ? (
        <Box flexDirection="row" justifyContent="space-between">
          <Text color="cyan" bold>{title}</Text>
          <Text dimColor>{right}</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color="cyan" bold>{fit(title, columns)}</Text>
          <Text dimColor>{fit(right, columns)}</Text>
        </Box>
      )}
      {health.failures > 0 && <Text color="yellow">{fit('⚠ Last check failed. This is older data.', columns)}</Text>}
    </Box>
  )
}

// A line of stages, each glyph in its colour: full labels with arrows when they fit, then without
// arrows, then glyphs only with the current stage named. `suffix` (dim) follows when there is room.
function stagesView({ Text }: Ui, key: string, steps: Step[], columns: number, suffix?: string) {
  const full = steps.map(s => `${STEP_LOOK[s.state].glyph} ${s.label}`).join(' → ')
  const mid = steps.map(s => `${STEP_LOOK[s.state].glyph} ${s.label}`).join(' ')
  const form = full.length <= columns ? 'full' : mid.length <= columns ? 'mid' : 'glyphs'
  const used = form === 'full' ? full.length : form === 'mid' ? mid.length : steps.length + 1 + (currentStep(steps)?.label.length ?? 0)
  const tail = suffix !== undefined && used + 3 + suffix.length <= columns ? ` · ${suffix}` : ''
  if (form === 'glyphs') {
    const cur = currentStep(steps)
    return (
      <Text key={key}>
        {steps.map((st, n) => <Text key={`g${n}`} color={STEP_LOOK[st.state].color}>{STEP_LOOK[st.state].glyph}</Text>)}
        {cur !== undefined && <Text color={STEP_LOOK[cur.state].color}>{` ${fit(cur.label, Math.max(1, columns - steps.length - 1))}`}</Text>}
        <Text dimColor>{tail}</Text>
      </Text>
    )
  }
  return (
    <Text key={key}>
      {steps.map((st, n) => (
        <Text key={`s${n}`}>
          {n > 0 && <Text dimColor>{form === 'full' ? ' → ' : ' '}</Text>}
          <Text color={STEP_LOOK[st.state].color}>{STEP_LOOK[st.state].glyph}</Text>
          <Text bold={st.state === 'now'} dimColor={st.state === 'todo' || st.state === 'na'}>{` ${st.label}`}</Text>
        </Text>
      ))}
      <Text dimColor>{tail}</Text>
    </Text>
  )
}

// A card's top row: glyph and name (a link to its page) left, the status word right. When the
// name and the word cannot share a row, the word goes under the name, so neither is cut.
function titleRow({ Box, Text, Link }: Ui, glyph: string, color: string, name: string, url: string, word: string, inner: number) {
  if (2 + name.length + 2 + word.length <= inner) {
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          <Text color={color}>{`${glyph} `}</Text>
          <Link href={url}>{name}</Link>
        </Box>
        <Text color={color} bold>{word}</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={color}>{`${glyph} `}</Text>
        <Link href={url}>{fit(name, inner - 2)}</Link>
      </Box>
      <Text color={color} bold>{`  ${fit(word, inner - 2)}`}</Text>
    </Box>
  )
}

// The next-action line: "→ Next: You fix CI", the action a link to the page where it happens, and
// an open button on the right that opens it in the browser even where links are not clickable.
// Bold in its colour when it is yours; dim when someone else holds it.
function actionRow({ Box, Text, Link, Button }: Ui, key: string, a: Action, inner: number, indent: number, open: Open) {
  const mine = a.who === 'you'
  const icon = ACTOR_ICON[a.who]
  const room = Math.max(6, inner - indent - 8 - 9)
  return (
    <Box key={key} flexDirection="row" justifyContent="space-between" marginLeft={indent}>
      <Box flexDirection="row">
        <Text color={a.color} bold={mine} dimColor={!mine}>{`${icon} Next: `}</Text>
        <Link href={a.url}>{fit(a.text, room)}</Link>
      </Box>
      <Button key={`lw-open:${key}`} plain dimColor={!mine} label="↗ open" onPress={() => open(a.url, a.text)} />
    </Box>
  )
}

const cardBox = (ui: Ui, key: string, layout: ReturnType<typeof paneLayout>, color: string | undefined, children: unknown) => {
  const { Box } = ui
  return layout.bordered ? (
    <Box key={key} flexDirection="column" borderStyle="round" {...edge(color)} paddingX={1} width={layout.width} marginBottom={1}>
      {children as never}
    </Box>
  ) : (
    <Box key={key} flexDirection="column" width={layout.width} marginBottom={1}>
      {children as never}
    </Box>
  )
}

// The details an expanded PR shows: failed checks as links, merge state, ticket, when, link.
function prDetails(ui: Ui, pr: Pr, inner: number, now: number, showTicket: boolean) {
  const { Box, Text, Link } = ui
  const failed = (pr.checks ?? []).filter(c => c.outcome === 'failed')
  const label = inner >= 30 ? 9 : 0
  const line = (key: string, name: string, value: string) => (
    <Box key={key} flexDirection={label > 0 ? 'row' : 'column'}>
      <Text dimColor>{label > 0 ? name.padEnd(label) : name}</Text>
      <Text dimColor>{fit(value, inner - label)}</Text>
    </Box>
  )
  const when = prWhen(pr, now)
  return (
    <Box flexDirection="column" marginTop={1}>
      {failed.slice(0, 4).map(c => (
        <Box key={`fail:${prKey(pr)}:${c.name}`} flexDirection="row">
          <Text color="red">{label > 0 ? 'Failed'.padEnd(label) : '✕ '}</Text>
          {c.url ? <Link href={c.url}>{fit(c.name, inner - (label || 2))}</Link> : <Text>{fit(c.name, inner - (label || 2))}</Text>}
        </Box>
      ))}
      {failed.length > 4 && line('more', '', `+${failed.length - 4} more failing`)}
      {line('merge', 'Merge', mergeText(pr))}
      {showTicket && pr.ticket !== undefined && line('ticket', 'Ticket', pr.ticket)}
      {when !== undefined && line('when', 'When', when)}
      {pr.title !== undefined && line('title', 'Title', pr.title)}
    </Box>
  )
}

// One active PR as a card in the PRs pane. Its border takes the PR's colour when it needs you.
function prBlock(ui: Ui, pr: Pr, me: string | null, layout: ReturnType<typeof paneLayout>, mode: Mode, now: number, open: Open) {
  const { Text } = ui
  const look = PR_LOOK[pr.state]
  const { inner } = layout
  const a = prAction(pr, me)
  return cardBox(ui, `pr:${prKey(pr)}`, layout, a.who === 'you' ? look.color : undefined, [
    titleRow(ui, look.glyph, look.color, prName(pr), pr.url, PR_WORD[pr.state], inner),
    ...wrapLines(`${ciText(pr)} · ${reviewText(pr)}`, inner - 2, 2).map((l, n) => <Text key={`cr${n}`} dimColor>{`  ${l}`}</Text>),
    <Text key="sp">{'  '}{stagesView(ui, 'st', prSteps(pr), inner - 2, prWhen(pr, now))}</Text>,
    actionRow(ui, `act:${prKey(pr)}`, a, inner, 2, open),
    mode === 'expanded' ? prDetails(ui, pr, inner - 2, now, true) : null,
  ])
}

// The PRs pane body: groups by who acts. "Needs you" is labelled in yellow; finished PRs are one
// dim line each under "Done", not cards.
export function prGroups(ui: Ui, prs: Pr[], me: string | null, columns: number, mode: Mode, now: number, open: Open) {
  const { Box, Text } = ui
  const layout = paneLayout(columns)
  return groupPrs(prs, me).map(g => {
    const isMine = g.title === 'Needs you'
    const isDoneGroup = g.title === 'Done'
    return (
      <Box key={`g:${g.title}`} flexDirection="column" marginBottom={isDoneGroup ? 1 : 0}>
        <Text color={isMine ? 'yellow' : undefined} bold={isMine} dimColor={!isMine}>{fit(`${g.title.toUpperCase()} · ${g.prs.length}`, layout.width)}</Text>
        {isDoneGroup ? g.prs.map(pr => doneLine(ui, pr, layout.width, now, 2)) : g.prs.map(pr => prBlock(ui, pr, me, layout, mode, now, open))}
      </Box>
    )
  })
}

// One ticket as a card: id (a link to Linear) and status, title, its stages, then each active PR
// with its stages and next action, finished PRs as one dim line each, and the ticket's own next
// step when all its PRs are merged. The border takes a colour when anything in it needs you.
export function ticketBlock(ui: Ui, i: Issue, me: string | null, columns: number, mode: Mode, now: number, open: Open) {
  const { Box, Text } = ui
  const layout = paneLayout(columns)
  const { inner } = layout
  const meta = [i.priority, i.project].filter(Boolean).join(' · ')
  const prs = [...(i.prs ?? [])].sort(byUrgency)
  const active = prs.filter(p => !isDone(p))
  const done = prs.filter(isDone)
  const since = inStateFor(i, now)
  const close = ticketAction(i)
  const mine = active.find(p => nextActor(p, me) === 'you')
  const color = close !== undefined ? close.color : mine !== undefined ? PR_LOOK[mine.state].color : undefined
  return cardBox(ui, `t:${i.id}`, layout, color, [
    titleRow(ui, '◆', ticketColor(i), i.id, i.url, i.status.toUpperCase(), inner),
    ...wrapLines(i.title, inner, mode === 'expanded' ? 3 : 2).map((l, n) => <Text key={`tl${n}`}>{l}</Text>),
    mode === 'expanded' && meta !== '' ? <Text key="meta" dimColor>{fit(meta, inner)}</Text> : null,
    stagesView(ui, 'ts', ticketSteps(i), inner, since !== undefined ? `for ${since}` : undefined),
    close !== undefined ? actionRow(ui, `close:${i.id}`, close, inner, 0, open) : null,
    <Text key="rule" dimColor>{'─'.repeat(Math.max(0, inner))}</Text>,
    prs.length === 0 ? <Text key="nopr" dimColor>No linked PRs</Text> : null,
    ...active.map((pr, n) => (
      <Box key={`tp:${prKey(pr)}`} flexDirection="column" marginTop={n > 0 ? 1 : 0}>
        {titleRow(ui, PR_LOOK[pr.state].glyph, PR_LOOK[pr.state].color, prName(pr), pr.url, PR_WORD[pr.state], inner)}
        {wrapLines(prSubWithCi(pr, me), inner - 2, 2).map((l, k) => <Text key={`ps${k}`} dimColor>{`  ${l}`}</Text>)}
        <Text>{'  '}{stagesView(ui, 'pst', prSteps(pr), inner - 2, prWhen(pr, now))}</Text>
        {actionRow(ui, `act:${prKey(pr)}`, prAction(pr, me), inner, 2, open)}
        {mode === 'expanded' && prDetails(ui, pr, inner - 2, now, false)}
      </Box>
    )),
    done.length > 0 ? (
      <Box key="done" flexDirection="column" marginTop={active.length > 0 ? 1 : 0}>
        {done.map(pr => doneLine(ui, pr, inner, now))}
      </Box>
    ) : null,
  ])
}

// The pane's footer: real actions only. `o` opens the first action that needs you (or the most
// pressing one) in the browser. Whole buttons wrap to the next row in a narrow pane.
export function toolbar({ Box, Button }: Ui, mode: Mode, showKey: boolean, next: Action | undefined, on: { toggle: () => unknown; refresh: () => unknown; key: () => unknown; close: () => unknown; open: Open }) {
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
      {next !== undefined && <Button key="lw-open-next" plain hotkey="o" label="open next" onPress={() => on.open(next.url, next.text)} />}
      <Button key="lw-toggle" plain hotkey="e" label={mode === 'expanded' ? 'compact' : 'expand'} onPress={on.toggle} />
      <Button key="lw-refresh" plain hotkey="r" label="refresh" onPress={on.refresh} />
      <Button key="lw-key" plain hotkey="k" label={showKey ? 'hide keys' : 'keys'} onPress={on.key} />
      <Button key="lw-close" plain hotkey="q" label="close" onPress={on.close} />
    </Box>
  )
}

// The chart of every symbol: PR states, then stages.
export function keyChart({ Box, Text }: Ui, columns: number) {
  const layout = paneLayout(columns)
  const room = layout.inner - 13
  return (
    <Box flexDirection="column" borderStyle={layout.bordered ? 'round' : undefined} borderDimColor paddingX={layout.bordered ? 1 : 0} marginTop={1} width={layout.width}>
      <Text bold>PR states</Text>
      {KEY_ORDER.map(s => (
        <Box key={`key:${s}`} flexDirection="row">
          <Text color={PR_LOOK[s].color}>{`${PR_LOOK[s].glyph} ${PR_WORD[s].padEnd(10)}`}</Text>
          {room >= 16 && <Text dimColor>{fit(PR_LOOK[s].means, room)}</Text>}
        </Box>
      ))}
      <Text bold>{' '}</Text>
      <Text bold>Stages</Text>
      {(['done', 'now', 'waiting', 'failed', 'todo', 'na'] as const).map(s => (
        <Text key={`step:${s}`}>
          <Text color={STEP_LOOK[s].color}>{STEP_LOOK[s].glyph}</Text>
          <Text dimColor>{` ${STEP_LOOK[s].word}`}</Text>
        </Text>
      ))}
    </Box>
  )
}

// Recent changes, newest first, for the expanded panes.
export function recent({ Box, Text }: Ui, updates: Update[], now: number, columns: number, filter: (u: Update) => boolean) {
  const list = updates.filter(filter).slice(0, 5)
  if (list.length === 0) return null
  const w = paneLayout(columns).width
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>RECENT CHANGES</Text>
      {list.map((u, n) => (
        <Text key={`upd:${n}:${u.at}`}>
          <Text color={u.level === 'important' ? 'yellow' : 'gray'}>{u.level === 'important' ? '• ' : '  '}</Text>
          <Text dimColor>{fit(`${u.text} · ${ago(u.at, now)}`, w - 2)}</Text>
        </Text>
      ))}
    </Box>
  )
}
