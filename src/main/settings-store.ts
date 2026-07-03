import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '../shared/types'

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
  fontSize: 'md',
  reducedMotion: false
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

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
    cache = { ...this.get(), ...patch }
    try {
      writeFileSync(file(), JSON.stringify(cache, null, 2))
    } catch (err) {
      console.error('settings save failed:', err)
    }
    return cache
  }
}
