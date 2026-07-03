import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UsageTotals } from '../shared/types'
import { userDataDir } from './paths'

const file = (): string => join(userDataDir(), 'usage.json')

let cache: Record<string, UsageTotals> | null = null
let saveTimer: NodeJS.Timeout | null = null

function load(): Record<string, UsageTotals> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, UsageTotals>
  } catch {
    cache = {}
  }
  return cache
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      writeFileSync(file(), JSON.stringify(cache ?? {}))
    } catch (err) {
      console.error('usage-store save failed:', err)
    }
  }, 2000)
}

export const usageStore = {
  /** Replace the running totals for a session (totals are cumulative per session). */
  set(sessionId: string, totals: UsageTotals): void {
    const data = load()
    data[sessionId] = totals
    scheduleSave()
  },

  getAll(): Record<string, UsageTotals> {
    return load()
  },

  flush(): void {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    try {
      writeFileSync(file(), JSON.stringify(cache ?? {}))
    } catch {
      // best effort on shutdown
    }
  }
}
