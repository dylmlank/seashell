import { writeFileAtomicSync } from './atomic-write'
import { join } from 'path'
import type { AppSettings } from '../shared/types'
import { DEFAULT_SETTINGS as DEFAULTS } from '../shared/default-settings'
import { readJsonFile } from './json-file'
import { userDataDir } from './paths'



const file = (): string => join(userDataDir(), 'settings.json')

// First cut of the thinking feature used CLI keyword names — map to the ladder.
const THINKING_LEGACY: Record<string, AppSettings['defaultThinkingLevel']> = {
  think: 'low',
  'think-harder': 'medium',
  ultrathink: 'ultra'
}

function sanitize(s: AppSettings): AppSettings {
  const migrated = THINKING_LEGACY[s.defaultThinkingLevel as string]
  if (migrated) s.defaultThinkingLevel = migrated
  return s
}

let cache: AppSettings | null = null

export const settingsStore = {
  get(): AppSettings {
    if (cache) return cache
    try {
      cache = sanitize({ ...DEFAULTS, ...readJsonFile<Partial<AppSettings>>(file()) })
    } catch {
      cache = { ...DEFAULTS }
    }
    return cache
  },

  set(patch: Partial<AppSettings>): AppSettings {
    // Merge from DISK, not the in-memory cache — if another instance wrote
    // settings since we loaded, our stale cache must not clobber its changes.
    let onDisk: Partial<AppSettings> = {}
    try {
      onDisk = readJsonFile<Partial<AppSettings>>(file())
    } catch {
      // no file yet
    }
    cache = sanitize({ ...DEFAULTS, ...onDisk, ...patch })
    // Surface write failures instead of silently keeping memory-only settings.
    writeFileAtomicSync(file(), JSON.stringify(cache, null, 2))
    return cache
  }
}
