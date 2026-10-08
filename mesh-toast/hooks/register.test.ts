import { expect, test } from 'claude-code/testing'

import { parseInbox, toastText } from './register'

test('parses inbox lines into toasts', () => {
  const out = [
    '  [1791070009649-0] msg fb272217-6082-4c8c-8649-0200add5dc2c from chris@todie.io @ session-omp-ceres-estate-w4-pt: estate rollup — first contact',
    '      > estate rollup, first contact. What this is…',
    '1 left unacked (--peek); they redeliver on the next read',
  ].join('\n')

  const msgs = parseInbox(out)
  expect(msgs).toEqual([
    {
      id: 'fb272217-6082-4c8c-8649-0200add5dc2c',
      from: 'chris@todie.io',
      peer: 'session-omp-ceres-estate-w4-pt',
      subject: 'estate rollup — first contact',
    },
  ])
  expect(toastText(msgs[0])).toBe('📬 Mesh: chris (session-omp-ceres-estate-w4-pt): estate rollup — first contact')
})

test('empty inbox gives no toasts', () => {
  expect(parseInbox('inbox empty')).toEqual([])
})
