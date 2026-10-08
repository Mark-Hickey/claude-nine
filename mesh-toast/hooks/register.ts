import type { Register } from 'claude-code'

// Reads the inbox with --peek, so checking never marks anything read.
const INBOX = [
  'bash',
  '-c',
  'python3 "$(ls ~/.claude/plugins/cache/cortex/cortex-join/*/scripts/cortex-mesh.py | sort | tail -1)" inbox --peek',
]
const EVERY_MS = 60_000

// "  [1791070009649-0] msg <uuid> from chris@todie.io @ session-…: subject"
const LINE = /^\s*\[[^\]]+\]\s+\S+\s+(\S+)\s+from\s+(\S+)\s+@\s+([^:]+):\s*(.*)$/

export type Message = { id: string; from: string; peer: string; subject: string }

export function parseInbox(stdout: string): Message[] {
  return stdout.split('\n').flatMap(line => {
    const m = LINE.exec(line)

    return m ? [{ id: m[1], from: m[2], peer: m[3].trim(), subject: m[4] }] : []
  })
}

export function toastText(msg: Message): string {
  const who = msg.from.split('@')[0]

  return `📬 Mesh: ${who} (${msg.peer}): ${msg.subject}`
}

export const register: Register = on => {
  const seen = new Set<string>()
  let isChecking = false

  on('session.start', async ($, e, next) => {
    const check = async () => {
      if (isChecking) {
        return
      }
      isChecking = true

      try {
        const { exitCode, stdout } = await $.process.run(INBOX, { timeoutMs: 20_000 })
        if (exitCode !== 0) {
          return
        }

        for (const msg of parseInbox(stdout)) {
          if (!seen.has(msg.id)) {
            seen.add(msg.id)
            $.ui.toast(toastText(msg), { timeoutMs: 10_000 })
          }
        }
      } finally {
        isChecking = false
      }
    }

    void check()
    $.clock.every(EVERY_MS, () => void check())

    return next(e)
  })
}
