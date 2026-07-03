import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '../shared/types'
import { userDataDir } from './paths'

const DEFAULTS: AppSettings = {
  defaultModel: null,
  defaultPermissionMode: 'default',
  defaultProvider: 'anthropic',
  openrouterModel: null,
  notifications: true,
  allowSelfSkills: false,
  autoCompact: false,
  compactThreshold: 60_000,
  autoRetrospective: false,
  retroOnlyAfterEdits: true,
  importDesktopMcp: true,
  autoScreenshots: true,
  fontSize: 'md',
  reducedMotion: false,
  accent: '#14b8a6',
  terminalShell: 'cmd',
  terminalFontSize: 13,
  editorFontSize: 13,
  smoothStreaming: true,
  reopenLastProject: false
}

const file = (): string => join(userDataDir(), 'settings.json')

let cache: AppSettings | null = null

export const settingsStore = {
  get(): AppSettings {
    if (cache) return cache
    try {
      cache = { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<AppSettings>) }
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
      onDisk = JSON.parse(readFileSync(file(), 'utf8')) as Partial<AppSettings>
    } catch {
      // no file yet
    }
    cache = { ...DEFAULTS, ...onDisk, ...patch }
    // Surface write failures instead of silently keeping memory-only settings.
    writeFileSync(file(), JSON.stringify(cache, null, 2))
    return cache
  }
}
