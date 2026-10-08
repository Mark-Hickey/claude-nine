import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Issue } from '../types'

const LIST_ISSUES = 'mcp__plugin_design_linear__list_issues'
const HOUR = 60 * 60 * 1000
const SEEN_KEY = 'seen'
const PANE = 'linear-tickets'

const openIssues = atom({ plugin: 'linear-watch', key: 'open' } as const, [])

type Seen = Record<string, string>


// One ticket as the pane shows it: id, status and title on one line, the link under it.
export const paneRows = (i: Issue) => [`${i.id}  [${i.status}]  ${i.title}`, `  ${i.url}`]

export const isOpen = (i: Issue) => !['completed', 'canceled', 'duplicate'].includes(i.statusType)

// What changed since the last check: tickets new to the list, and tickets whose status moved.
export const diff = (issues: Issue[], seen: Seen) => {
  const added = issues.filter(i => !(i.id in seen))
  const moved = issues.filter(i => i.id in seen && seen[i.id] !== i.status)
  return { added, moved }
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

async function check($: EngineInterface): Promise<Issue[] | null> {
  let issues: Issue[]
  try {
    issues = await fetchIssues($)
  } catch {
    $.ui.status('Linear: check failed')
    return null
  }
  const open = issues.filter(isOpen)
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
    await $.command.register({ name: 'tickets', description: 'List your open Linear tickets now' })
    // Show the pane from the start, toast what changed while Claude Code was closed, then check hourly.
    void $.ui.open({ id: PANE, title: 'Linear tickets' })
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
    return { text: open.map(i => `${i.id}  [${i.status}]  ${i.title}\n  ${i.url}`).join('\n') + note }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const open = await read($, openIssues)
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 4) / 2))

    return (
      <Box flexDirection="column">
        {open.length === 0 && <Text dimColor>No open Linear tickets assigned to you.</Text>}
        {open.slice(0, room).map(i => {
          const [line, link] = paneRows(i)
          return (
            <Box flexDirection="column">
              <Text>{line}</Text>
              <Text dimColor>{link}</Text>
            </Box>
          )
        })}
        {open.length > room && <Text dimColor>+{open.length - room} more</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const open = await read($, openIssues)
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const [first] = open
    if (first === undefined) {
      return (
        <Box>
          <Text dimColor>Linear: no open tickets (or not checked yet)</Text>
        </Box>
      )
    }
    const more = open.length > 1 ? ` +${open.length - 1} more` : ''

    return (
      <Box>
        <Text dimColor>
          Linear: {first.id} [{first.status}] {first.title.slice(0, 60)}{more}
        </Text>
      </Box>
    )
  })
}
