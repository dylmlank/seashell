import { create } from 'zustand'
import type { AppSettings } from '@shared/types'

interface SettingsStore {
  settings: AppSettings
  loaded: boolean
}

export const useSettings = create<SettingsStore>(() => ({
  settings: {
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
    reducedMotion: false
  },
  loaded: false
}))

function applyToDocument(s: AppSettings): void {
  const root = document.documentElement
  root.style.fontSize = s.fontSize === 'sm' ? '14px' : s.fontSize === 'lg' ? '18px' : '16px'
  root.classList.toggle('reduced-motion', s.reducedMotion)
}

declare global {
  interface Window {
    __settingsWired?: boolean
  }
}

if (!window.__settingsWired) {
  window.__settingsWired = true
  void window.api.invoke('settings:get').then((settings) => {
    useSettings.setState({ settings, loaded: true })
    applyToDocument(settings)
  })
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const settings = await window.api.invoke('settings:set', patch)
  useSettings.setState({ settings })
  applyToDocument(settings)
}
