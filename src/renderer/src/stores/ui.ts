import { create } from 'zustand'

export type SidePanel =
  | 'files'
  | 'terminal'
  | 'sidechat'
  | 'preview'
  | 'memory'
  | 'editor'
  | null

interface UiStore {
  /** Which side panel is open, per session tab. */
  panels: Record<string, SidePanel>
  /** Command palette overlay: action list, quick file open, or closed. */
  palette: 'commands' | 'files' | null
  setPanel: (tabId: string, panel: SidePanel) => void
  togglePanel: (tabId: string, panel: Exclude<SidePanel, null>) => void
  setPalette: (palette: 'commands' | 'files' | null) => void
}

export const useUi = create<UiStore>((set) => ({
  panels: {},
  palette: null,
  setPanel: (tabId, panel) => set((s) => ({ panels: { ...s.panels, [tabId]: panel } })),
  togglePanel: (tabId, panel) =>
    set((s) => ({
      panels: { ...s.panels, [tabId]: s.panels[tabId] === panel ? null : panel }
    })),
  setPalette: (palette) => set({ palette })
}))
