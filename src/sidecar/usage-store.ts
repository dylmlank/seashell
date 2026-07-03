import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UsageTotals } from '../shared/types'
import { userDataDir } from './paths'

const file = (): string => join(userDataDir(), 'usage.json')

let cache: Record<string, UsageTotals> | null = null

function load(): Record<string, UsageTotals> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, UsageTotals>
  } catch {
    cache = {}
  }
  return cache
}

export const usageStore = {
  /** Replace the running totals for a session (totals are cumulative per session).
   *  Write-through: at most once per turn, and the supervisor may hard-kill us
   *  on quit, so there's no safe window to debounce across. */
  set(sessionId: string, totals: UsageTotals): void {
    const data = load()
    data[sessionId] = totals
    try {
      writeFileSync(file(), JSON.stringify(data))
    } catch (err) {
      console.error('usage-store save failed:', err)
    }
  },

  getAll(): Record<string, UsageTotals> {
    return load()
  },

  flush(): void {
    // Writes are synchronous now — nothing pending to flush.
  }
}
