import type { Register } from 'claude-code'

// Runs ~/.local/bin/repo-sync, which only fast-forwards clean, fully pushed repos.
const SYNC = ['bash', '-c', '"$HOME/.local/bin/repo-sync"']
const PERIOD_MS = 14 * 60 * 60 * 1000
const CHECK_MS = 60 * 60 * 1000
const LAST_RUN = 'lastRun'

export type Result = { updated: string[]; skipped: string[] }

// "updated owner/repo: +12" and "skip owner/repo: reason" lines; the rest is ignored.
export function parseSync(stdout: string): Result {
  const updated: string[] = []
  const skipped: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.startsWith('updated ')) updated.push(line.slice('updated '.length))
    else if (line.startsWith('skip ')) skipped.push(line.slice('skip '.length))
  }
  return { updated, skipped }
}

export function toastText({ updated, skipped }: Result): string {
  const head = updated.length === 0 ? '🔄 Repos: all up to date' : `🔄 Repos updated: ${updated.join(', ')}`
  return skipped.length === 0 ? head : `${head} · left alone: ${skipped.join('; ')}`
}

export const isDue = (lastRun: number | null, now: number) => lastRun === null || now - lastRun >= PERIOD_MS

export const register: Register = on => {
  let isRunning = false

  on('session.start', async ($, e, next) => {
    const sync = async () => {
      if (isRunning) return
      const lastRun = ((await $.store.get(LAST_RUN)) ?? null) as number | null
      if (!isDue(lastRun, Date.now())) return
      isRunning = true
      try {
        const { exitCode, stdout } = await $.process.run(SYNC, { timeoutMs: 600_000 })
        await $.store.set(LAST_RUN, Date.now())
        $.ui.toast(exitCode === 0 ? toastText(parseSync(stdout)) : '🔄 Repos: the update check failed; run repo-sync to see why', { timeoutMs: 15_000 })
      } finally {
        isRunning = false
      }
    }

    // Check hourly whether 14 hours have passed since the last run, so the period holds across restarts.
    void sync()
    $.clock.every(CHECK_MS, () => void sync())
    return next(e)
  })
}
