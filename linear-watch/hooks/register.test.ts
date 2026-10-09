import { describe, expect, mock, test } from 'claude-code/testing'
import type { Register } from 'claude-code'
type On = Parameters<Register>[0]

import { modeArg, prsText, statusText, ticketsText } from './register'
import { prFromGh } from './model'

const ISSUES = { issues: [{ id: 'OPS-1608', title: 'fix the rolematrix comment', status: 'In Review', statusType: 'started', url: 'https://linear.app/c/issue/OPS-1608', priority: { value: 3, name: 'Medium' } }] }
const HISTORY = [
  { state: { name: 'Backlog', type: 'backlog' }, startedAt: '2026-10-05T15:44:16.125Z' },
  { state: { name: 'Todo', type: 'unstarted' }, startedAt: '2026-10-05T21:50:56.438Z' },
  { state: { name: 'Backlog', type: 'backlog' }, startedAt: '2026-10-05T21:51:01.457Z' },
  { state: { name: 'In Review', type: 'started' }, startedAt: '2026-10-05T22:57:06.945Z' },
]
const ATTACH = { attachments: [{ url: 'https://github.com/unsigned-gg/site/pull/152' }, { url: 'https://github.com/unsigned-gg/api/pull/87' }], stateHistory: HISTORY }
const GH: Record<string, unknown> = {
  '152': { state: 'OPEN', createdAt: '2026-10-06T13:00:00Z', title: 'docs: fix comment', author: { login: 'Mark-Hickey' }, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewRequests: [], latestReviews: [{ author: { login: 'todie' }, state: 'APPROVED' }], statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }] },
  '87': { state: 'OPEN', title: 'api change', author: { login: 'Mark-Hickey' }, reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'BLOCKED', reviewRequests: [{ login: 'allen' }], latestReviews: [], statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/unsigned-gg/api/actions/runs/1' }] },
}

// Linear answers on the server named; the other server, when asked, has no such tool.
// GH is read at call time, so a test can change a PR between two checks.
function fakes(on: On, server: 'mcp__claude_ai_Linear__' | 'mcp__plugin_design_linear__', gh: Record<string, unknown> = GH) {
  on('tool.call', async ($, e) => {
    const tool = String(e.tool)
    if (!tool.startsWith(server)) return { result: {}, isError: true, text: `No such tool available: ${tool}` } as never
    if (tool.endsWith('list_issues')) return { result: ISSUES, text: JSON.stringify(ISSUES) } as never
    return { result: ATTACH, text: JSON.stringify(ATTACH) } as never
  })
  on('process.run', async ($, e) => {
    const argv = e.argv as readonly string[]
    if (argv[1] === 'api') return { value: { exitCode: 0, stdout: 'Mark-Hickey\n', stderr: '' } } as never
    return { value: { exitCode: 0, stdout: JSON.stringify(gh[argv[3] as string]), stderr: '' } } as never
  })
  return bottoms(on)
}

// The engine's own answers for what the mod shows: toasts and status lines are kept to assert on.
function bottoms(on: On) {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = { toasts: [] as string[], status: [] as (string | undefined)[], opened: 0 }
  on('ui.toast', async ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.status', async ($, e) => {
    seen.status.push(e.text)
    return { value: undefined } as never
  })
  on('ui.open', async () => {
    seen.opened += 1
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', async () => ({ value: undefined }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.start', async ($, e) => ({ cwd: e.cwd }) as never)
  // Nothing beneath the band: the mods under this one draw an empty Box.
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }) as never)
  return { clock, seen }
}

describe('through the engine', () => {
  test('/prs groups the real PR data by who acts, with links', async ($, on) => {
    fakes(on, 'mcp__claude_ai_Linear__')
    const ran = await $.command.run({ command: 'prs', args: '' } as never)
    const text = (ran as { text?: string }).text ?? ''
    expect(text).toContain('Needs you (1)')
    expect(text).toContain('✕ api#87')
    expect(text).toContain('Checks failing')
    expect(text).toContain('You fix CI')
    expect(text).toContain('Waiting on others (1)')
    expect(text).toContain('● site#152')
    expect(text).toContain('Operator merges')
    expect(text).toContain('OPS-1608 · https://github.com/unsigned-gg/site/pull/152')
  })

  test('Linear through the old design-plugin server still works', async ($, on) => {
    fakes(on, 'mcp__plugin_design_linear__')
    const ran = await $.command.run({ command: 'tickets', args: '' } as never)
    expect((ran as { text?: string }).text ?? '').toContain('◆ OPS-1608  In Review')
  })

  test('no Linear server at all says so instead of showing nothing', async ($, on) => {
    on('tool.call', async () => ({ result: {}, isError: true, text: 'No such tool available' }) as never)
    on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
    bottoms(on)
    const ran = await $.command.run({ command: 'tickets', args: '' } as never)
    expect((ran as { text?: string }).text ?? '').toContain('Could not reach Linear')
  })

  test('/tickets expand switches the band to expanded without opening a pane', async ($, on) => {
    const { seen } = fakes(on, 'mcp__claude_ai_Linear__')
    const ran = await $.command.run({ command: 'tickets', args: 'expand' } as never)
    expect((ran as { text?: string }).text).toBe('The band above the prompt is now expanded (cards).')
    expect(seen.opened).toBe(0)
  })

  test('the hourly check toasts a real change once, and an unchanged hour not at all', async ($, on) => {
    const gh = { ...GH }
    const { clock, seen } = fakes(on, 'mcp__claude_ai_Linear__', gh)
    await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
    await clock.settle()
    expect(seen.toasts).toEqual([])
    expect(seen.status.at(-1)).toBe('Linear: 1 open · 1 PR needs you')
    gh['87'] = { ...(GH['87'] as object), statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }] }
    await clock.advance(60 * 60 * 1000)
    expect(seen.toasts).toEqual(['api#87 checks passed, awaiting review · Reviewer acts'])
    await clock.advance(60 * 60 * 1000)
    expect(seen.toasts.length).toBe(1)
  })

  test('the band shares its rows: with a mod drawing beneath and little room, the cards fold to one line', async ($, on) => {
    const clock = mock.clock(on)
    void clock
    mock.store(on)
    on('ui.toast', async () => ({ value: undefined }) as never)
    on('ui.status', async () => ({ value: undefined }) as never)
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    on('command.register', async () => ({ value: undefined }) as never)
    // Stands for mesh-toaster: an 8-row drawing beneath this mod.
    const toaster = { type: 'Box', props: { flexDirection: 'column' }, children: Array.from({ length: 8 }, (_, n) => ({ type: 'Text', props: {}, children: [`toaster row ${n}`] })) }
    on('ui.render', { component: 'AbovePrompt' }, async () => toaster as never)
    on('tool.call', async ($, e) => {
      const tool = String(e.tool)
      if (tool.endsWith('list_issues')) return { result: ISSUES, text: JSON.stringify(ISSUES) } as never
      return { result: ATTACH, text: JSON.stringify(ATTACH) } as never
    })
    on('process.run', async ($, e) => {
      const argv = e.argv as readonly string[]
      if (argv[1] === 'api') return { value: { exitCode: 0, stdout: 'Mark-Hickey\n', stderr: '' } } as never
      return { value: { exitCode: 0, stdout: JSON.stringify(GH[argv[3] as string]), stderr: '' } } as never
    })
    await $.command.run({ command: 'tickets', args: '' } as never)
    const mount = (maxRows: number) => $.ui.mount({ plugin: 'linear-watch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns: 115 }, viewport: { columns: 120, rows: 40 } } as never)
    const tight = await mount(14)
    expect(await tight.find({ text: /PR Watch/ })).toBeUndefined()
    expect(await tight.find({ text: ' FAILING' })).toBeDefined()
    expect(await tight.find({ text: 'toaster row 7' })).toBeDefined()
    const roomy = await mount(30)
    expect(await roomy.find({ text: /PR Watch/ })).toBeDefined()
    expect(await roomy.find({ text: 'toaster row 7' })).toBeDefined()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the band on ${surface}: two cards wide, one card narrow, one line when folded`, async ($, on) => {
      fakes(on, 'mcp__claude_ai_Linear__')
      await $.command.run({ command: 'tickets', args: '' } as never)
      // Room for the cards: a band capped lower folds them (tested above).
      const props = { hasSurvey: false, isWorking: false, maxRows: 30 }
      const mount = (columns: number) => $.ui.mount({ plugin: 'linear-watch', surface, component: 'AbovePrompt', props, viewport: { columns, rows: 40 } } as never)
      const wide = await mount(160)
      expect(await wide.find({ text: /Linear Watch/ })).toBeDefined()
      expect(await wide.find({ text: /PR Watch/ })).toBeDefined()
      expect(await wide.find({ text: '2 pull requests' })).toBeDefined()
      // The most pressing PR leads: api#87 fails, so its row says so in words, not colour alone.
      expect(await wide.find({ text: 'FAILING' })).toBeDefined()
      expect(await wide.find({ text: /CI checks failed/ })).toBeDefined()
      expect(await wide.find({ text: /Your operator can merge/ })).toBeDefined()
      expect(await wide.find({ text: /fix the rolematrix comment/ })).toBeDefined()
      const narrow = await mount(50)
      expect(await narrow.find({ text: /Linear · ⑂ PRs/ })).toBeDefined()
      expect(await narrow.find({ text: 'FAILING' })).toBeDefined()
      await $.command.run({ command: 'tickets', args: 'compact' } as never)
      const line = await mount(100)
      expect(await line.find({ text: /PR Watch/ })).toBeUndefined()
      expect(await line.find({ text: ' FAILING' })).toBeDefined()
      expect(await line.find({ key: 'lw-band' })).toBeDefined()
    })

    test(`the Tickets pane on ${surface} fits a 40-column dock: status words stay whole, nothing runs off the edge`, async ($, on) => {
      fakes(on, 'mcp__claude_ai_Linear__')
      await $.command.run({ command: 'tickets', args: '' } as never)
      const props = { title: 'Linear tickets', isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { bodyRows: 40 }, view: {} }
      const pane = await $.ui.mount({ plugin: 'linear-watch', surface, component: 'Pane', requestId: 'linear-tickets', props, viewport: { columns: 160, rows: 50 } } as never)
      expect(await pane.find({ text: 'IN REVIEW' })).toBeDefined()
      expect(await pane.find({ text: 'FAILING' })).toBeDefined()
      expect(await pane.find({ text: 'READY' })).toBeDefined()
      // Every card is the pane's width, not the terminal's.
      const boxes = await pane.findAll({ type: 'Box' })
      for (const b of boxes) {
        const w = (b as unknown as { props?: { width?: number } }).props?.width
        if (typeof w === 'number') expect(w).toBeLessThanOrEqual(40)
      }
      expect(await pane.find({ key: 'lw-close' })).toBeDefined()
    })

    test(`the PRs pane on ${surface}: expanded shows details, the toggle compacts it`, async ($, on) => {
      fakes(on, 'mcp__claude_ai_Linear__')
        await $.command.run({ command: 'prs', args: '' } as never)
      const pane = await $.ui.mount({ plugin: 'linear-watch', surface, component: 'Pane', requestId: 'linear-prs', props: {}, viewport: { columns: 100, rows: 40 } } as never)
      expect(await pane.find({ text: /Approved by todie/ })).toBeDefined()
      expect(await pane.find({ text: /Review requested from allen/ })).toBeDefined()
      expect(await pane.find({ text: /Blocked by branch rules/ })).toBeDefined()
      expect(await pane.find({ type: 'Link', text: /lint/ })).toBeDefined()
      await pane.press({ key: 'lw-toggle' } as never)
      // Compact keeps the hover card (hidden until pointed at), but drops the detail lines.
      expect(await pane.find({ text: /Blocked by branch rules/ })).toBeUndefined()
      expect(await pane.find({ key: 'lw-toggle', text: /expand/ })).toBeDefined()
    })
  }
})

describe('text views', () => {
  const ready = prFromGh({ repo: 'unsigned-gg/site', number: 152, url: 'https://github.com/unsigned-gg/site/pull/152' }, GH['152'] as never, 'OPS-1608')
  const history = HISTORY.map(h => ({ name: h.state.name, type: h.state.type, at: h.startedAt }))
  const open = [{ id: 'OPS-1608', title: 'fix it', status: 'In Review', statusType: 'started', url: 'https://linear.app/c/issue/OPS-1608', prs: [ready], history }]
  const now = Date.parse('2026-10-09T23:00:00Z')

  test('/tickets text: ticket with its stages, each PR with its stages, link and key', () => {
    expect(ticketsText(open, 'Mark-Hickey', now)).toBe(
      [
        '◆ OPS-1608  In Review · 4d',
        '  fix it',
        '  ✓ Backlog → ✓ Todo → ● In Review → ○ Done',
        '  ● site#152  Ready  CI passed  Operator merges',
        '      ✓ Open → ✓ CI → ✓ Review → ● Merge → ○ Merged · open 3d',
        '  https://linear.app/c/issue/OPS-1608',
        '',
        'Key:',
        '  ● Ready: Checks passed, reviews approved, GitHub says it can merge.',
        '  Stages: ✓ done  ● now  ◷ waiting  ✕ blocked  ○ not yet',
      ].join('\n'),
    )
  })

  test('/prs text on a narrow terminal folds the stages to glyphs and the current stage', () => {
    const text = prsText(open, 'Mark-Hickey', now, 40)
    expect(text).toContain('      ✓✓✓●○ Merge')
    // The PR rows and stage lines fit 40 columns; links and the key's sentences are left whole.
    const rows = text.split('\n\nKey:')[0]!.split('\n').filter(l => !l.includes('https://'))
    for (const line of rows) expect(line.length).toBeLessThanOrEqual(40)
  })

  test('/prs text with nothing linked says so', () => {
    expect(prsText([{ ...open[0]!, prs: [] }], 'Mark-Hickey', now)).toBe('No pull requests are linked to your open Linear tickets.')
  })

  test('the status line counts PRs that wait on you', () => {
    expect(statusText(open, 'Mark-Hickey')).toBe('Linear: 1 open')
    expect(statusText(open, 'unsigned-gg')).toBe('Linear: 1 open · 1 PR needs you')
  })

  test('mode arguments', () => {
    expect(modeArg(' Expand ')).toBe('expanded')
    expect(modeArg('compact')).toBe('compact')
    expect(modeArg('')).toBeUndefined()
  })
})
