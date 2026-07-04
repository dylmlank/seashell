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
    leanSessions: false,
    templates: [],
    responseStyle: 'normal',
    speakReplies: false
  },
  loaded: false
}))

function applyToDocument(s: AppSettings): void {
  const root = document.documentElement
  root.style.fontSize = s.fontSize === 'sm' ? '14px' : s.fontSize === 'lg' ? '18px' : '16px'
  root.classList.toggle('reduced-motion', s.reducedMotion)
  // Highlights derive from this one variable (dim/glows via color-mix).
  root.style.setProperty('--color-accent', s.accent)
  // Palette preset — index.css overrides the color vars per data-theme.
  root.dataset.theme = s.theme
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
  try {
    const settings = await window.api.invoke('settings:set', patch)
    useSettings.setState({ settings })
    applyToDocument(settings)
  } catch (err) {
    const { alertDialog } = await import('../lib/dialogs')
    void alertDialog(
      `Could not save settings: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
