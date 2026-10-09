import { expect, test } from 'claude-code/testing'
import { classifyPr, diff, isOpen, paneRows, prLabel, prRefs } from './register'

const issue = (id: string, status: string, statusType = 'backlog') =>
  ({ id, title: `t ${id}`, status, statusType, url: `u/${id}` })

test('diff reports new tickets and status changes, not unchanged ones', () => {
  const seen = { 'OPS-1': 'Backlog', 'OPS-2': 'Backlog' }
  const { added, moved } = diff(
    [issue('OPS-1', 'Backlog'), issue('OPS-2', 'In Progress', 'started'), issue('OPS-3', 'Todo', 'unstarted')],
    seen,
  )
  expect(added.map(i => i.id)).toEqual(['OPS-3'])
  expect(moved.map(i => i.id)).toEqual(['OPS-2'])
})

test('done and canceled tickets are not counted as open', () => {
  expect(isOpen(issue('A', 'Done', 'completed'))).toBe(false)
  expect(isOpen(issue('B', 'Canceled', 'canceled'))).toBe(false)
  expect(isOpen(issue('C', 'Backlog'))).toBe(true)
})

test('linked PRs come from GitHub pull links in the attachments, once each', () => {
  const refs = prRefs([
    { url: 'https://github.com/unsigned-gg/unsigned-onboard/pull/7' },
    { url: 'https://github.com/unsigned-gg/site/pull/152' },
    { url: 'https://github.com/unsigned-gg/site/pull/152' },
    { url: 'https://linear.app/cerebral-work/issue/OPS-1' },
  ])
  expect(refs.map(r => `${r.repo}#${r.number}`)).toEqual(['unsigned-gg/unsigned-onboard#7', 'unsigned-gg/site#152'])
})

test('a PR state says who has to act', () => {
  const green = [{ status: 'COMPLETED', conclusion: 'SUCCESS' }]
  expect(classifyPr({ state: 'MERGED', reviewDecision: 'APPROVED' })).toBe('merged')
  expect(classifyPr({ state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: green })).toBe('ready')
  expect(classifyPr({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: green })).toBe('review')
  expect(classifyPr({ state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }] })).toBe('running')
  expect(classifyPr({ state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] })).toBe('failing')
  expect(classifyPr({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: green })).toBe('changes')
  expect(classifyPr({ state: 'OPEN', isDraft: true })).toBe('draft')
  expect(classifyPr({ state: 'CLOSED' })).toBe('closed')
})

test('the pane shows the ticket, its title, each PR and the link', () => {
  const i = {
    ...issue('OPS-1608', 'In Review', 'started'),
    prs: [
      { repo: 'unsigned-gg/site', number: 152, state: 'ready' as const, url: 'p/152' },
      { repo: 'unsigned-gg/unsigned-onboard', number: 7, state: 'merged' as const, url: 'p/7' },
    ],
  }
  expect(paneRows(i, 'Mark-Hickey')).toEqual([
    '◆ OPS-1608  In Review',
    '  t OPS-1608',
    '  ● site#152  ready · operator merges',
    '  ✓ unsigned-onboard#7  merged',
    '  u/OPS-1608',
  ])
})

test('a ready PR says who merges: you in your own repos, your operator elsewhere', () => {
  const ready = (repo: string) => ({ repo, number: 1, state: 'ready' as const, url: 'u' })
  expect(prLabel(ready('Mark-Hickey/claude-mods'), 'Mark-Hickey')).toBe('ready · you merge')
  expect(prLabel(ready('mark-hickey/claude-mods'), 'Mark-Hickey')).toBe('ready · you merge')
  expect(prLabel(ready('unsigned-gg/site'), 'Mark-Hickey')).toBe('ready · operator merges')
  expect(prLabel(ready('Mark-Hickey/claude-mods'), null)).toBe('ready · operator merges')
  expect(prLabel({ ...ready('unsigned-gg/site'), state: 'merged' }, 'Mark-Hickey')).toBe('merged')
})
