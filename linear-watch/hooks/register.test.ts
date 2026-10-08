import { expect, test } from 'claude-code/testing'

import { diff, isOpen, paneRows } from './register'

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

test('the pane shows id, status and title, with the link under them', () => {
  expect(paneRows(issue('OPS-1608', 'Backlog'))).toEqual(['OPS-1608  [Backlog]  t OPS-1608', '  u/OPS-1608'])
})
