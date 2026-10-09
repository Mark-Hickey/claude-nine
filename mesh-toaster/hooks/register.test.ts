import { expect, test } from 'claude-code/testing'
import { caption, notSeen, parseInbox, slotSegments, toaster } from './register'

const OUT = [
  '  [1791484149526-0] msg b01df6c0 from chris@todie.io @ session-omp-ceres-estate-w1r-p4: Mesh round-trip test',
  '      > Mesh round-trip test from the cortex lane…',
  '1 left unacked (--peek); they redeliver on the next read',
].join('\n')

test('reads mail from the peeked inbox', () => {
  expect(parseInbox(OUT)).toEqual([
    { id: 'b01df6c0', from: 'chris@todie.io', peer: 'session-omp-ceres-estate-w1r-p4', subject: 'Mesh round-trip test' },
  ])
  expect(parseInbox('inbox empty')).toEqual([])
})

test('mail marked "got it" stops counting as new', () => {
  expect(notSeen(parseInbox(OUT), ['b01df6c0'])).toEqual([])
})

test('the toaster is empty with no mail and shows toast when mail arrives', () => {
  expect(toaster(0)).toHaveLength(3)
  expect(toaster(0)[0]).toContain('▁▁▁▁')
  expect(toaster(3)).toHaveLength(6)
  expect(toaster(3)[0]).toContain('▗▄▄▖')
})

test('the caption names the sender and the subject', () => {
  expect(caption([])).toBe('mesh: no mail')
  expect(caption(parseInbox(OUT))).toBe('mesh: 1 new · chris: Mesh round-trip test')
})

test('the toast inside the slots is drawn as toast, so each slice is one piece', () => {
  expect(slotSegments(0).some(s => s.isToast)).toBe(false)
  expect(slotSegments(3).filter(s => s.isToast).map(s => s.text)).toEqual(['▐██▌', '▐██▌'])
  expect(slotSegments(3).map(s => s.text).join('')).toBe(toaster(3)[3])
})
