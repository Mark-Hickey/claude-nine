// Drawing: one card design for the band, the Tickets pane and the PRs pane.
// A card is a rounded border, a bold header with a dim count on the right, rows of
// bold name + dim sub-line with the status word right-aligned, and a dim footer.
// Every element comes from the surface's own table, so nothing here assumes a terminal.
import type { EngineInterface } from 'claude-code'

import type { Health, Issue, Mode, Pr, Update } from '../types'
import { PR_LOOK, KEY_ORDER, ago, byUrgency, ciText, fit, mergeText, nextActor, nextText, prKey, prName, reviewText, groupPrs } from './model'

export type Ui = ReturnType<EngineInterface['ui']['resolve']>

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

// A two-line row: glyph and bold name with a dim sub-line, the status word right-aligned in colour.
function cardRow({ Box, Text }: Ui, key: string, glyph: string, color: string, name: string, sub: string, word: string, inner: number) {
  const room = Math.max(4, inner - word.length - 4)
  return (
    <Box key={key} flexDirection="row" justifyContent="space-between">
      <Box flexDirection="column">
        <Text>
          <Text color={color}>{glyph}</Text>
          <Text bold>{` ${fit(name, room)}`}</Text>
        </Text>
        <Text dimColor>{`  ${fit(sub, room)}`}</Text>
      </Box>
      <Text color={color} bold>{word}</Text>
    </Box>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// The PR Watch card: up to `max` PRs, most pressing first.
function prCard(ui: Ui, prs: Pr[], me: string | null, width: number, max: number, footer: ReturnType<typeof footerRow>) {
  const { Box, Text } = ui
  const inner = width - 4
  const shown = [...prs].sort(byUrgency).slice(0, max)
  return (
    <Box key="lw-prcard" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={width}>
      {header(ui, '⑂ PR Watch', plural(prs.length, 'pull request'))}
      {rule(ui, inner)}
      {prs.length === 0 && <Text dimColor>No PRs linked to your tickets</Text>}
      {shown.map(pr => cardRow(ui, `lw-pr:${prKey(pr)}`, PR_LOOK[pr.state].glyph, PR_LOOK[pr.state].color, prName(pr), prSubline(pr, me), PR_WORD[pr.state], inner))}
      {prs.length > shown.length && <Text dimColor>{`  +${prs.length - shown.length} more`}</Text>}
      {rule(ui, inner)}
      {footer}
    </Box>
  )
}

// The Linear Watch card: up to `max` tickets, most pressing first, the title as the sub-line.
function ticketCard(ui: Ui, open: Issue[], width: number, max: number, footer: ReturnType<typeof footerRow>) {
  const { Box, Text } = ui
  const inner = width - 4
  const shown = open.slice(0, max)
  return (
    <Box key="lw-tcard" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={width}>
      {header(ui, '◆ Linear Watch', plural(open.length, 'open ticket'))}
      {rule(ui, inner)}
      {open.length === 0 && <Text dimColor>No open tickets assigned to you</Text>}
      {shown.map(i => cardRow(ui, `lw-t:${i.id}`, '◆', ticketColor(i), i.id, i.title, i.status.toUpperCase(), inner))}
      {open.length > shown.length && <Text dimColor>{`  +${open.length - shown.length} more`}</Text>}
      {rule(ui, inner)}
      {footer}
    </Box>
  )
}

// A card footer: a dim hint on the left, and on the right the band's fold button and any warnings.
function footerRow({ Box, Text, Button }: Ui, hint: string, unseen: number, health: Health, toggle?: () => unknown) {
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text dimColor>{hint}</Text>
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
export function band(ui: Ui, open: Issue[], prs: Pr[], me: string | null, columns: number, mode: Mode, unseen: number, health: Health, toggle: () => unknown) {
  const { Box, Text, Button } = ui
  if (mode === 'compact') {
    const top = [...prs].sort(byUrgency)[0]
    const [first] = open
    return (
      <Box flexDirection="row">
        {first === undefined ? <Text dimColor>◆ Linear: no open tickets</Text> : (
          <Text>
            <Text color={ticketColor(first)}>◆ </Text>
            <Text bold>{first.id}</Text>
            <Text dimColor>{` ${first.status}`}</Text>
          </Text>
        )}
        {top !== undefined && (
          <Text>
            <Text dimColor> · </Text>
            <Text color={PR_LOOK[top.state].color}>{`${PR_LOOK[top.state].glyph} `}</Text>
            <Text bold>{prName(top)}</Text>
            <Text color={PR_LOOK[top.state].color}>{` ${PR_WORD[top.state]}`}</Text>
            {columns >= 80 && <Text dimColor>{` · ${prSubline(top, me)}`}</Text>}
          </Text>
        )}
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
        {prCard(ui, prs, me, width, 3, footerRow(ui, '/prs for details', unseen, health, toggle))}
      </Box>
    )
  }
  // Narrow: one card, tickets then PRs, so the band stays one block.
  const width = Math.max(30, Math.min(columns, 72))
  const inner = width - 4
  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={width}>
      {header(ui, '◆ Linear · ⑂ PRs', `${open.length} · ${prs.length}`)}
      {rule(ui, inner)}
      {open.slice(0, 2).map(i => cardRow(ui, `lw-t:${i.id}`, '◆', ticketColor(i), i.id, i.title, i.status.toUpperCase(), inner))}
      {[...prs].sort(byUrgency).slice(0, 3).map(pr => cardRow(ui, `lw-pr:${prKey(pr)}`, PR_LOOK[pr.state].glyph, PR_LOOK[pr.state].color, prName(pr), prSubline(pr, me), PR_WORD[pr.state], inner))}
      {rule(ui, inner)}
      {footerRow(ui, '/prs · /tickets', unseen, health, toggle)}
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
export function cardRows(open: Issue[], prs: Pr[], columns: number): number {
  const card = (n: number, total: number) => 6 + 2 * n + (total > n ? 1 : 0)
  if (columns >= 100) return Math.max(card(Math.min(3, open.length) || 1, open.length), card(Math.min(3, prs.length) || 1, prs.length))
  return 6 + 2 * (Math.min(2, open.length) + Math.min(3, prs.length))
}

// --- Panes -----------------------------------------------------------------------------------

// A pane's title row: bold title, dim count on the right, then when it was checked.
export function paneHeader(ui: Ui, title: string, count: string, health: Health, checking: boolean, now: number) {
  const { Box, Text } = ui
  const when = health.lastOk !== undefined ? `checked ${ago(health.lastOk, now)}` : 'not checked yet'
  return (
    <Box flexDirection="column" marginBottom={1}>
      {header(ui, title, count)}
      <Box flexDirection="row">
        <Text dimColor>{when}</Text>
        {health.failures > 0 && <Text color="yellow">  ⚠ last check failed, showing older data</Text>}
        {checking && <Text dimColor>  · checking…</Text>}
      </Box>
    </Box>
  )
}

// One PR as a card: name and status, CI · reviews, the next action in its colour; expanded adds details.
function prBlock(ui: Ui, pr: Pr, me: string | null, width: number, mode: Mode, showTicket: boolean) {
  const { Box, Text, Link } = ui
  const look = PR_LOOK[pr.state]
  const inner = width - 4
  const failed = (pr.checks ?? []).filter(c => c.outcome === 'failed')
  const line = (label: string, value: string) => (
    <Box flexDirection="row">
      <Text dimColor>{label.padEnd(9)}</Text>
      <Text dimColor wrap="truncate-end">{fit(value, inner - 9)}</Text>
    </Box>
  )
  return (
    <Box key={`pr:${prKey(pr)}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={width}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={look.color}>{`${look.glyph} `}</Text>
          <Text bold>{prName(pr)}</Text>
          {pr.title !== undefined && inner >= 50 && <Text dimColor>{`  ${fit(pr.title, inner - prName(pr).length - look.label.length - 6)}`}</Text>}
        </Text>
        <Text color={look.color} bold>{look.label}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">{fit(`${ciText(pr)} · ${reviewText(pr)}`, inner)}</Text>
      <Text color={look.color}>{`${ACTOR_ICON[nextActor(pr, me)]} Next action: ${nextText(pr, me)}`}</Text>
      {mode === 'expanded' && (
        <Box flexDirection="column" marginTop={1}>
          {failed.slice(0, 4).map(c => (
            <Box key={`fail:${prKey(pr)}:${c.name}`} flexDirection="row">
              <Text dimColor>{'Failed'.padEnd(9)}</Text>
              {c.url ? <Link href={c.url}>{fit(c.name, inner - 9)}</Link> : <Text>{fit(c.name, inner - 9)}</Text>}
            </Box>
          ))}
          {failed.length > 4 && line('', `+${failed.length - 4} more failing`)}
          {line('Merge', mergeText(pr))}
          {showTicket && pr.ticket !== undefined && line('Ticket', pr.ticket)}
          <Box flexDirection="row">
            <Text dimColor>{'Open'.padEnd(9)}</Text>
            <Link href={pr.url}>{fit(pr.url.replace('https://', ''), inner - 9)}</Link>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// The PRs pane body: a dim group label by who acts, then each PR's card.
export function prGroups(ui: Ui, prs: Pr[], me: string | null, columns: number, mode: Mode) {
  const { Box, Text } = ui
  const width = Math.max(30, Math.min(columns, 96))
  return groupPrs(prs, me).map(g => (
    <Box key={`g:${g.title}`} flexDirection="column" marginBottom={1}>
      <Text dimColor>{`${g.title.toUpperCase()} · ${g.prs.length}`}</Text>
      {g.prs.map(pr => prBlock(ui, pr, me, width, mode, true))}
    </Box>
  ))
}

// One ticket as a card: id and status, its title, its PRs as rows; expanded adds priority, project and link.
export function ticketBlock(ui: Ui, i: Issue, me: string | null, columns: number, mode: Mode) {
  const { Box, Text, Link } = ui
  const width = Math.max(30, Math.min(columns, 96))
  const inner = width - 4
  const meta = [i.priority, i.project].filter(Boolean).join(' · ')
  return (
    <Box key={`t:${i.id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={width} marginBottom={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={ticketColor(i)}>◆ </Text>
          <Text bold>{i.id}</Text>
          {mode === 'expanded' && meta !== '' && <Text dimColor>{`  ${meta}`}</Text>}
        </Text>
        <Text color={ticketColor(i)} bold>{i.status}</Text>
      </Box>
      <Text dimColor wrap="truncate-end">{fit(i.title, inner)}</Text>
      {(i.prs ?? []).length === 0 && <Text dimColor>No linked PRs</Text>}
      {[...(i.prs ?? [])].sort(byUrgency).map(pr =>
        cardRow(ui, `tp:${prKey(pr)}`, PR_LOOK[pr.state].glyph, PR_LOOK[pr.state].color, prName(pr), `${prSubline(pr, me)} · ${ciText(pr)}`, PR_WORD[pr.state], inner),
      )}
      {mode === 'expanded' && (
        <Box flexDirection="row" marginTop={1}>
          <Link href={i.url}>{fit(i.url.replace('https://', ''), inner)}</Link>
        </Box>
      )}
    </Box>
  )
}

// The pane toolbar: real actions only. Each works from its hotkey while the pane has focus.
export function toolbar({ Box, Button }: Ui, mode: Mode, showKey: boolean, on: { toggle: () => unknown; refresh: () => unknown; key: () => unknown; close: () => unknown }) {
  return (
    <Box flexDirection="row" gap={3} marginBottom={1}>
      <Button key="lw-toggle" plain hotkey="e" label={mode === 'expanded' ? 'Compact' : 'Expand'} onPress={on.toggle} />
      <Button key="lw-refresh" plain hotkey="r" label="Refresh" onPress={on.refresh} />
      <Button key="lw-key" plain hotkey="k" label={showKey ? 'Hide key' : 'Key'} onPress={on.key} />
      <Button key="lw-close" plain hotkey="q" label="Close" onPress={on.close} />
    </Box>
  )
}

// The chart of every PR symbol: glyph, word, meaning.
export function keyChart({ Box, Text }: Ui, columns: number) {
  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1} width={Math.max(30, Math.min(columns, 96))}>
      <Text bold>Key</Text>
      {KEY_ORDER.map(s => (
        <Box key={`key:${s}`} flexDirection="row">
          <Text color={PR_LOOK[s].color}>{`${PR_LOOK[s].glyph} `}</Text>
          <Text color={PR_LOOK[s].color}>{PR_WORD[s].padEnd(10)}</Text>
          {columns >= 60 && <Text dimColor wrap="truncate-end">{fit(PR_LOOK[s].means, Math.min(columns, 96) - 18)}</Text>}
        </Box>
      ))}
    </Box>
  )
}

// Recent changes, newest first, for the expanded panes.
export function recent({ Box, Text }: Ui, updates: Update[], now: number, columns: number, filter: (u: Update) => boolean) {
  const list = updates.filter(filter).slice(0, 5)
  if (list.length === 0) return null
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>RECENT CHANGES</Text>
      {list.map((u, n) => (
        <Box key={`upd:${n}:${u.at}`} flexDirection="row">
          <Text color={u.level === 'important' ? 'yellow' : 'gray'}>{u.level === 'important' ? '• ' : '  '}</Text>
          <Text dimColor wrap="truncate-end">{fit(`${u.text} · ${ago(u.at, now)}`, Math.min(columns, 96) - 2)}</Text>
        </Box>
      ))}
    </Box>
  )
}
