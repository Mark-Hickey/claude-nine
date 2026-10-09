import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Mail } from '../types'

// Reads the inbox with --peek, so checking never marks anything read on the mesh.
const INBOX = [
  'bash',
  '-c',
  'python3 "$(ls ~/.claude/plugins/cache/cortex/cortex-join/*/scripts/cortex-mesh.py | sort | tail -1)" inbox --peek',
]
const EVERY_MS = 60_000
const SEEN_KEY = 'seen'
// The toast rises out of the slot over these steps when mail arrives.
const LIFT_STEPS = 3
const LIFT_MS = 180

const unseen = atom({ plugin: 'mesh-toaster', key: 'unseen' } as const, [])
const lift = atom({ plugin: 'mesh-toaster', key: 'lift' } as const, 0)

// "  [1791070009649-0] msg <uuid> from chris@todie.io @ session-…: subject"
const LINE = /^\s*\[[^\]]+\]\s+\S+\s+(\S+)\s+from\s+(\S+)\s+@\s+([^:]+):\s*(.*)$/

export function parseInbox(stdout: string): Mail[] {
  return stdout.split('\n').flatMap(line => {
    const m = LINE.exec(line)
    return m ? [{ id: m[1], from: m[2], peer: m[3].trim(), subject: m[4] }] : []
  })
}

export const notSeen = (mail: Mail[], seen: string[]) => mail.filter(m => !seen.includes(m.id))

// The toaster, as rows of text. With no mail its slots are empty; with mail, toast
// stands up out of the slots, `height` rows high (0 to LIFT_STEPS).
export function toaster(height: number): string[] {
  const toast = ['  ▗▄▄▖ ▗▄▄▖', '  ▐██▌ ▐██▌', '  ▐██▌ ▐██▌'].slice(LIFT_STEPS - height)
  const slots = height > 0 ? ' ╭─▐██▌─▐██▌─╮' : ' ╭─▁▁▁▁─▁▁▁▁─╮'
  return [...toast, slots, ' │           │▪', ' ╰┬─────────┬╯']
}

// The slot row in pieces, so the toast inside the slots can be drawn yellow like the rest of it.
export function slotSegments(height: number): { text: string; isToast: boolean }[] {
  if (height === 0) return [{ text: ' ╭─▁▁▁▁─▁▁▁▁─╮', isToast: false }]
  return [
    { text: ' ╭─', isToast: false },
    { text: '▐██▌', isToast: true },
    { text: '─', isToast: false },
    { text: '▐██▌', isToast: true },
    { text: '─╮', isToast: false },
  ]
}

export function caption(mail: Mail[]): string {
  if (mail.length === 0) return 'mesh: no mail'
  const [first] = mail
  const who = first.from.split('@')[0]
  const more = mail.length > 1 ? ` (+${mail.length - 1} more)` : ''
  return `mesh: ${mail.length} new · ${who}: ${first.subject}${more}`
}

export const register: Register = on => {
  let isChecking = false

  on('session.start', async ($, e, next) => {
    const check = async () => {
      if (isChecking) return
      isChecking = true
      try {
        const { exitCode, stdout } = await $.process.run(INBOX, { timeoutMs: 20_000 })
        if (exitCode !== 0) return
        const seen = ((await $.store.get(SEEN_KEY)) ?? []) as string[]
        const fresh = notSeen(parseInbox(stdout), seen)
        const before = await read($, unseen)
        await update($, unseen, () => fresh)
        // Pop the toast up only when new mail arrives, not on every check.
        if (fresh.some(m => !before.some(b => b.id === m.id))) {
          for (let step = 1; step <= LIFT_STEPS; step++) {
            await update($, lift, () => step)
            await $.clock.sleep(LIFT_MS)
          }
        }
        if (fresh.length === 0) await update($, lift, () => 0)
      } finally {
        isChecking = false
      }
    }

    void check()
    $.clock.every(EVERY_MS, () => void check())
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Draw the toaster, then let the mods beneath draw their lines under it.
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const mail = await read($, unseen)
    const height = mail.length > 0 ? await read($, lift) : 0
    const rows = toaster(height)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box flexDirection="column">
            {rows.map((row, i) =>
              i === rows.length - 3 ? (
                <Box key={`r${i}`} flexDirection="row">
                  {slotSegments(height).map((seg, j) => (
                    <Text key={`s${j}`} color={seg.isToast ? 'yellow' : undefined} dimColor={mail.length === 0}>
                      {seg.text}
                    </Text>
                  ))}
                </Box>
              ) : (
                <Text key={`r${i}`} color={i < rows.length - 3 ? 'yellow' : undefined} dimColor={mail.length === 0}>
                  {row}
                </Text>
              ),
            )}
          </Box>
          <Box flexDirection="column" justifyContent="flex-end" marginLeft={1}>
            <Text dimColor={mail.length === 0} wrap="truncate-end">{caption(mail)}</Text>
            {mail.length > 0 && (
              <Button
                key="got-it"
                label="Got it"
                onPress={async () => {
                  const seen = ((await $.store.get(SEEN_KEY)) ?? []) as string[]
                  await $.store.set(SEEN_KEY, [...seen, ...mail.map(m => m.id)])
                  await update($, unseen, () => [])
                  await update($, lift, () => 0)
                }}
              />
            )}
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
