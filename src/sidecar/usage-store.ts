import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DayUsage, UsageTotals } from '../shared/types'
import { userDataDir } from './paths'

const file = (): string => join(userDataDir(), 'usage.json')
const historyFile = (): string => join(userDataDir(), 'usage-history.json')

let cache: Record<string, UsageTotals> | null = null
let historyCache: Record<string, DayUsage> | null = null

function loadHistory(): Record<string, DayUsage> {
  if (historyCache) return historyCache
  try {
    historyCache = JSON.parse(readFileSync(historyFile(), 'utf8')) as Record<string, DayUsage>
  } catch {
    historyCache = {}
  }
  return historyCache
}

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

  /** Fold one finished turn into today's bucket (for the usage graph). */
  addDay(delta: DayUsage): void {
    const data = loadHistory()
    const day = new Date().toISOString().slice(0, 10)
    const bucket = data[day] ?? { outputTokens: 0, inputTokens: 0, costUsd: 0, turns: 0 }
    bucket.outputTokens += delta.outputTokens
    bucket.inputTokens += delta.inputTokens
    bucket.costUsd += delta.costUsd
    bucket.turns += delta.turns
    data[day] = bucket
    try {
      writeFileSync(historyFile(), JSON.stringify(data))
    } catch (err) {
      console.error('usage-history save failed:', err)
    }
  },

  getHistory(): Record<string, DayUsage> {
    return loadHistory()
  },

  flush(): void {
    // Writes are synchronous now — nothing pending to flush.
  }
}
