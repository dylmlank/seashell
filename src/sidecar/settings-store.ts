import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '../shared/types'
import { userDataDir } from './paths'

const DEFAULTS: AppSettings = {
  defaultModel: null,
  defaultPermissionMode: 'default',
  defaultProvider: 'anthropic',
  openrouterModel: null,
  customBaseUrl: null,
  customModel: null,
  notifications: true,
  allowSelfSkills: true,
  autoCompact: false,
  compactThreshold: 60_000,
  autoRetrospective: false,
  retroOnlyAfterEdits: true,
  importDesktopMcp: true,
  autoScreenshots: true,
  fontSize: 'md',
  reducedMotion: false,
  accent: '#14b8a6',
  theme: 'abyss',
  terminalShell: 'cmd',
  terminalFontSize: 13,
  editorFontSize: 13,
  smoothStreaming: true,
  reopenLastProject: true,
  chatWidth: 'wide',
  defaultThinkingLevel: 'medium',
  smartThinking: true,
  smartModel: true,
  leanSessions: false,
  templates: [],
  responseStyle: 'normal',
  speakReplies: false,
  autoTidySessions: true,
  projectsRoot: null
}

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
      cache = sanitize({
        ...DEFAULTS,
        ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<AppSettings>)
      })
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
    cache = sanitize({ ...DEFAULTS, ...onDisk, ...patch })
    // Surface write failures instead of silently keeping memory-only settings.
    writeFileSync(file(), JSON.stringify(cache, null, 2))
    return cache
  }
}
