import { expect, test } from 'claude-code/testing'
import { isDue, parseSync, toastText } from './register'

const OUT = ['== 2026-10-08', 'updated unsigned-gg/unsigned-paas: +231', 'skip unsigned-gg/agentic: branch has no upstream', 'summary updated=1 current=2 skipped=1'].join('\n')

test('reads updated and skipped repos from repo-sync output', () => {
  expect(parseSync(OUT)).toEqual({ updated: ['unsigned-gg/unsigned-paas: +231'], skipped: ['unsigned-gg/agentic: branch has no upstream'] })
})

test('the toast names what moved and what was left alone', () => {
  expect(toastText(parseSync(OUT))).toBe('🔄 Repos updated: unsigned-gg/unsigned-paas: +231 · left alone: unsigned-gg/agentic: branch has no upstream')
  expect(toastText({ updated: [], skipped: [] })).toBe('🔄 Repos: all up to date')
})

test('runs on first start and then only after 14 hours', () => {
  const h = 60 * 60 * 1000
  expect(isDue(null, 0)).toBe(true)
  expect(isDue(0, 13 * h)).toBe(false)
  expect(isDue(0, 14 * h)).toBe(true)
})
