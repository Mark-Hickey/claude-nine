import { describe, expect, test } from 'claude-code/testing'

import type { Issue, Pr } from '../types'
import {
  KEY_ORDER, PR_LOOK, changes, prSteps, stepsLine, ticketSteps, wrapLines, ciText, classifyPr, groupPrs, isOpen, keyFor, mergeText, nextText, prFromGh, prRefs,
  prSummary, reviewText, rowCells, snapshotOf, ticketLine, toastsFor,
} from './model'
import type { GhPr } from './model'

const ME = 'Mark-Hickey'
const green = [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }]
const issue = (id: string, status: string, statusType = 'started', prs?: Pr[]): Issue =>
  ({ id, title: `t ${id}`, status, statusType, url: `https://linear.app/x/${id}`, ...(prs ? { prs } : {}) })
const pr = (repo: string, number: number, gh: GhPr, ticket = 'OPS-1') =>
  prFromGh({ repo, number, url: `https://github.com/${repo}/pull/${number}` }, gh, ticket)

describe('classifying a PR', () => {
  test('every GitHub situation maps to one honest state', () => {
    expect(classifyPr({ state: 'MERGED' })).toBe('merged')
    expect(classifyPr({ state: 'CLOSED' })).toBe('closed')
    expect(classifyPr({ state: 'OPEN', isDraft: true, statusCheckRollup: green })).toBe('draft')
    expect(classifyPr({ state: 'OPEN', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', statusCheckRollup: green })).toBe('ready')
    expect(classifyPr({ state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: [{ name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' }] })).toBe('failing')
    expect(classifyPr({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: green })).toBe('changes')
    expect(classifyPr({ state: 'OPEN', reviewDecision: 'APPROVED', mergeable: 'CONFLICTING', statusCheckRollup: green })).toBe('conflict')
    expect(classifyPr({ state: 'OPEN', reviewDecision: 'APPROVED', statusCheckRollup: [{ name: 'a', status: 'IN_PROGRESS', conclusion: null }] })).toBe('running')
    expect(classifyPr({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: green })).toBe('review')
    expect(classifyPr({ state: 'OPEN', reviewDecision: 'APPROVED', mergeStateStatus: 'BEHIND', statusCheckRollup: green })).toBe('behind')
    expect(classifyPr({ state: 'OPEN', reviewDecision: 'APPROVED', mergeStateStatus: 'BLOCKED', statusCheckRollup: green })).toBe('blocked')
  })

  test('passing CI alone is not ready: no approval and no clean merge state waits for review', () => {
    expect(classifyPr({ state: 'OPEN', reviewDecision: null, statusCheckRollup: green })).toBe('review')
    expect(classifyPr({ state: 'OPEN', reviewDecision: null, mergeStateStatus: 'BLOCKED', statusCheckRollup: green })).toBe('blocked')
    // A repo with no review rule: GitHub says CLEAN and nobody is asked, so it can go in.
    expect(classifyPr({ state: 'OPEN', reviewDecision: null, mergeStateStatus: 'CLEAN', statusCheckRollup: green })).toBe('ready')
    expect(classifyPr({ state: 'OPEN', reviewDecision: null, mergeStateStatus: 'CLEAN', reviewRequests: [{ login: 'todie' }], statusCheckRollup: green })).toBe('review')
  })

  test('status contexts count as checks too', () => {
    const p = pr('o/r', 1, { state: 'OPEN', statusCheckRollup: [{ context: 'ci/legacy', state: 'PENDING' }, { context: 'lint', state: 'SUCCESS' }] })
    expect(p.state).toBe('running')
    expect(ciText(p)).toBe('CI running 1/2')
  })

  test('every state has a glyph, a colour, a word and a meaning, and the key lists each once', () => {
    expect(new Set(KEY_ORDER).size).toBe(Object.keys(PR_LOOK).length)
    for (const s of KEY_ORDER) {
      expect(PR_LOOK[s].glyph.length).toBe(1)
      expect(PR_LOOK[s].label.length).toBeGreaterThan(0)
      expect(PR_LOOK[s].means.length).toBeGreaterThan(0)
    }
    expect(new Set(KEY_ORDER.map(s => PR_LOOK[s].glyph)).size).toBe(KEY_ORDER.length)
  })
})

describe('who acts next', () => {
  test('a ready PR is yours to merge in your repos and your operator\'s elsewhere', () => {
    const ready: GhPr = { state: 'OPEN', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', statusCheckRollup: green, author: { login: ME } }
    expect(nextText(pr('Mark-Hickey/claude-mods', 1, ready), ME)).toBe('You merge')
    expect(nextText(pr('unsigned-gg/site', 152, ready), ME)).toBe('Operator merges')
  })

  test('fixes fall to whoever opened the PR', () => {
    const failing: GhPr = { state: 'OPEN', statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }] }
    expect(nextText(pr('o/r', 1, { ...failing, author: { login: 'mark-hickey' } }), ME)).toBe('You fix CI')
    expect(nextText(pr('o/r', 1, { ...failing, author: { login: 'todie' } }), ME)).toBe('todie fix CI')
  })

  test('the details say who reviewed and what blocks the merge', () => {
    const p = pr('o/r', 1, { state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', mergeStateStatus: 'BLOCKED', latestReviews: [{ author: { login: 'todie' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'allen' }, state: 'APPROVED' }] })
    expect(reviewText(p)).toBe('Changes requested by todie')
    expect(mergeText(p)).toBe('Blocked by branch rules')
    expect(mergeText({ ...p, mergeState: undefined })).toBe('GitHub has not computed mergeability yet')
  })
})

describe('layout', () => {
  const site = pr('unsigned-gg/site', 152, { state: 'OPEN', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', statusCheckRollup: green })

  test('a PR summary drops CI, then the next action, as the room shrinks', () => {
    expect(prSummary(site, ME, 80)).toBe('● site#152 Ready · CI passed · Operator merges')
    expect(prSummary(site, ME, 34)).toBe('● site#152 Ready · Operator merges')
    expect(prSummary(site, ME, 20)).toBe('● site#152 Ready')
  })

  test('the compact ticket line adds the title only when it has room', () => {
    const t = issue('OPS-1608', 'In Review', 'started', [site])
    expect(ticketLine(t, ME, 140).title).toBe('t OPS-1608')
    expect(ticketLine(t, ME, 60).title).toBeUndefined()
    expect(ticketLine(t, ME, 80).prText).toBe('● site#152 Ready · CI passed · Operator merges')
    expect(ticketLine(t, ME, 60).prText).toBe('● site#152 Ready · Operator merges')
    expect(ticketLine(t, ME, 40).prText).toBe('● site#152 Ready')
  })

  test('rows line up: names and states pad to the widest, columns drop when narrow', () => {
    const long = pr('o/unsigned-onboard', 7, { state: 'MERGED' })
    const cells = rowCells([site, long], ME, 100)
    expect(cells.map(c => c.name.length)).toEqual([18, 18])
    expect(cells.map(c => c.state.length)).toEqual([6, 6])
    expect(cells[0]?.showCi).toBe(true)
    const narrow = rowCells([site, long], ME, 30)
    expect(narrow[0]?.showNext).toBe(false)
    expect(narrow[0]?.showCi).toBe(false)
  })

  test('the /prs groups put what needs you first and done last', () => {
    const mine = pr('o/r', 2, { state: 'OPEN', statusCheckRollup: [{ name: 'x', status: 'COMPLETED', conclusion: 'FAILURE' }] })
    const done = pr('o/r', 3, { state: 'MERGED' })
    expect(groupPrs([done, site, mine], ME).map(g => [g.title, g.prs.map(p => p.number)])).toEqual([
      ['Needs you', [2]],
      ['Waiting on others', [152]],
      ['Done', [3]],
    ])
  })

  test('the key explains only the symbols in use', () => {
    expect(keyFor([issue('A', 'x', 'started', [site])])).toEqual(['● Ready: Checks passed, reviews approved, GitHub says it can merge.'])
  })
})

describe('changes and notifications', () => {
  const at = 1_000
  const review: GhPr = { state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: green }
  const ready: GhPr = { state: 'OPEN', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', statusCheckRollup: green }

  test('the first check reports nothing', () => {
    expect(changes(null, [issue('A', 'Todo')], ME, at)).toEqual([])
  })

  test('new tickets and status moves are important; done tickets are open no longer', () => {
    const found = changes({ tickets: { A: 'Todo' } }, [issue('A', 'Done', 'completed'), issue('B', 'Todo')], ME, at)
    expect(found.map(u => [u.level, u.text])).toEqual([
      ['important', 'A moved Todo → Done'],
      ['important', 'New ticket B: t B'],
    ])
    expect(isOpen(issue('A', 'Done', 'completed'))).toBe(false)
  })

  test('an approval is important and names who acts next', () => {
    const before = snapshotOf([issue('A', 'In Review', 'started', [pr('o/site', 1, review, 'A')])], ME, null)
    const found = changes(before, [issue('A', 'In Review', 'started', [pr('o/site', 1, ready, 'A')])], ME, at)
    expect(found.map(u => [u.level, u.text])).toEqual([['important', 'site#1 approved, ready to merge · Operator merges']])
  })

  test('an unchanged check says nothing, so nothing repeats', () => {
    const now = [issue('A', 'In Review', 'started', [pr('o/site', 1, ready, 'A')])]
    expect(changes(snapshotOf(now, ME, null), now, ME, at)).toEqual([])
  })

  test('an unknown answer is a failed lookup, not a change, and the old state is kept', () => {
    const before = snapshotOf([issue('A', 'In Review', 'started', [pr('o/site', 1, ready, 'A')])], ME, null)
    const lost: Pr = { repo: 'o/site', number: 1, url: 'u', state: 'unknown', ticket: 'A' }
    const after = [issue('A', 'In Review', 'started', [lost])]
    expect(changes(before, after, ME, at)).toEqual([])
    expect(snapshotOf(after, ME, before).prs?.['o/site#1']?.state).toBe('ready')
  })

  test('checks starting on a push are quiet; a re-run after a failure is not', () => {
    const running: GhPr = { state: 'OPEN', statusCheckRollup: [{ name: 'a', status: 'IN_PROGRESS' }] }
    const failing: GhPr = { state: 'OPEN', statusCheckRollup: [{ name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' }] }
    const t = (gh: GhPr) => [issue('A', 'x', 'started', [pr('o/site', 1, gh, 'A')])]
    expect(changes(snapshotOf(t(review), ME, null), t(running), ME, at).map(u => u.level)).toEqual(['quiet'])
    expect(changes(snapshotOf(t(failing), ME, null), t(running), ME, at).map(u => u.level)).toEqual(['routine'])
  })

  test('a 0.4 snapshot (tickets only) does not toast every PR as new', () => {
    const found = changes({ tickets: { A: 'x' } }, [issue('A', 'x', 'started', [pr('o/site', 1, ready, 'A')])], ME, at)
    expect(found).toEqual([])
  })

  test('a new ticket is one toast, not one more for each of its PRs', () => {
    const before = snapshotOf([], ME, null)
    const found = changes(before, [issue('B', 'Todo', 'unstarted', [pr('o/site', 9, review, 'B')])], ME, at)
    expect(found.map(u => u.text)).toEqual(['New ticket B: t B'])
  })

  test('toasts: quiet ones never, important ones longer, a burst folds into one', () => {
    const u = (level: 'important' | 'routine' | 'quiet', text: string) => ({ at, level, text })
    expect(toastsFor([u('quiet', 'q'), u('important', 'i'), u('routine', 'r')])).toEqual([
      { text: 'i', timeoutMs: 8000 },
      { text: 'r', timeoutMs: 4000 },
    ])
    const burst = toastsFor([u('important', '1'), u('routine', '2'), u('routine', '3'), u('routine', '4')])
    expect(burst).toEqual([{ text: '4 ticket and PR updates, 1 important · /prs or /tickets to see them', timeoutMs: 8000 }])
  })
})

test('linked PRs come from GitHub pull links in the attachments, once each', () => {
  const refs = prRefs([
    { url: 'https://github.com/unsigned-gg/unsigned-onboard/pull/7' },
    { url: 'https://github.com/unsigned-gg/site/pull/152' },
    { url: 'https://github.com/unsigned-gg/site/pull/152/files' },
    { url: 'https://linear.app/cerebral-work/issue/OPS-1' },
  ])
  expect(refs.map(r => `${r.repo}#${r.number}`)).toEqual(['unsigned-gg/unsigned-onboard#7', 'unsigned-gg/site#152'])
  expect(refs[1]?.url).toBe('https://github.com/unsigned-gg/site/pull/152')
})

describe('stages', () => {
  const marks = (steps: { label: string; state: string }[]) => steps.map(s => `${s.state}:${s.label}`)
  const h = (name: string, type: string, at: string) => ({ name, type, at })

  test('a ticket\'s stages come from its real history: OPS-1608 went Backlog, Todo, Backlog, In Review', () => {
    const t = { ...issue('OPS-1608', 'In Review', 'started'), history: [h('Backlog', 'backlog', '2026-10-05T15:44Z'), h('Todo', 'unstarted', '2026-10-05T21:50Z'), h('Backlog', 'backlog', '2026-10-05T21:51Z'), h('In Review', 'started', '2026-10-05T22:57Z')] }
    expect(marks(ticketSteps(t))).toEqual(['done:Backlog', 'done:Todo', 'now:In Review', 'todo:Done'])
  })

  test('started states show in the order entered, and a finished ticket is done all the way', () => {
    const hist = [h('Todo', 'unstarted', '1'), h('In Progress', 'started', '2'), h('In Review', 'started', '3')]
    expect(marks(ticketSteps({ ...issue('A', 'In Review', 'started'), history: hist }))).toEqual(['done:Todo', 'done:In Progress', 'now:In Review', 'todo:Done'])
    expect(marks(ticketSteps({ ...issue('A', 'Done', 'completed'), history: [...hist, h('Done', 'completed', '4')] }))).toEqual(['done:Todo', 'done:In Progress', 'done:In Review', 'done:Done'])
    expect(marks(ticketSteps({ ...issue('A', 'Canceled', 'canceled'), history: [h('Todo', 'unstarted', '1'), h('Canceled', 'canceled', '2')] }))).toEqual(['done:Todo', 'failed:Canceled'])
  })

  test('without history a ticket still shows where it is', () => {
    expect(marks(ticketSteps(issue('A', 'In Progress', 'started')))).toEqual(['now:In Progress', 'todo:Done'])
  })

  test('each PR state lights its stages honestly', () => {
    const at = (gh: GhPr) => marks(prSteps(pr('o/r', 1, gh)))
    expect(at({ state: 'OPEN', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', statusCheckRollup: green })).toEqual(['done:Open', 'done:CI', 'done:Review', 'now:Merge', 'todo:Merged'])
    expect(at({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: green })).toEqual(['done:Open', 'done:CI', 'waiting:Review', 'todo:Merge', 'todo:Merged'])
    expect(at({ state: 'OPEN', statusCheckRollup: [{ name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' }] })).toEqual(['done:Open', 'failed:CI', 'waiting:Review', 'todo:Merge', 'todo:Merged'])
    expect(at({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED', latestReviews: [{ author: { login: 'x' }, state: 'CHANGES_REQUESTED' }], statusCheckRollup: green })).toEqual(['done:Open', 'done:CI', 'failed:Review', 'todo:Merge', 'todo:Merged'])
    expect(at({ state: 'OPEN', reviewDecision: 'APPROVED', mergeable: 'CONFLICTING', latestReviews: [{ author: { login: 'x' }, state: 'APPROVED' }], statusCheckRollup: green })).toEqual(['done:Open', 'done:CI', 'done:Review', 'failed:Merge', 'todo:Merged'])
    expect(at({ state: 'OPEN', isDraft: true, statusCheckRollup: [] })).toEqual(['now:Open', 'na:CI', 'todo:Review', 'todo:Merge', 'todo:Merged'])
    expect(at({ state: 'MERGED', mergedAt: '2026-10-06T13:44:54Z' })).toEqual(['done:Open', 'done:CI', 'done:Review', 'done:Merge', 'done:Merged'])
    // Closed with no checks reported: CI is not used, not passed.
    expect(at({ state: 'CLOSED' })).toEqual(['done:Open', 'na:CI', 'waiting:Review', 'na:Merge', 'failed:Closed'])
    expect(marks(prSteps({ repo: 'o/r', number: 1, url: 'u', state: 'unknown' }))).toEqual(['done:Open', 'todo:CI', 'todo:Review', 'todo:Merge', 'todo:Merged'])
  })

  test('the stages line folds to fit: arrows, then no arrows, then glyphs and the current stage', () => {
    const steps = prSteps(pr('o/r', 1, { state: 'OPEN', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', statusCheckRollup: green }))
    expect(stepsLine(steps, 80)).toBe('✓ Open → ✓ CI → ✓ Review → ● Merge → ○ Merged')
    expect(stepsLine(steps, 40)).toBe('✓ Open ✓ CI ✓ Review ● Merge ○ Merged')
    expect(stepsLine(steps, 20)).toBe('✓✓✓●○ Merge')
  })

  test('titles wrap on words to at most n lines, the last one cut', () => {
    expect(wrapLines('onboard rolematrix: fix false "safest profile" comment on ProfileFor and add tests', 30, 2)).toEqual([
      'onboard rolematrix: fix false',
      '"safest profile" comment on P…',
    ])
    expect(wrapLines('short', 30, 2)).toEqual(['short'])
  })
})
