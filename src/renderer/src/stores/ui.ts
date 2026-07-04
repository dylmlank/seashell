import { create } from 'zustand'

export type SidePanel =
  | 'files'
  | 'terminal'
  | 'sidechat'
  | 'preview'
  | 'memory'
  | 'editor'
  | 'workflow'
  | 'checkpoints'
  | null

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

interface UiStore {
  /** Which side panel is open, per session tab. */
  panels: Record<string, SidePanel>
  /** Command palette overlay: action list, quick file open, or closed. */
  palette: 'commands' | 'files' | null
  /** Whether the slash-command manager modal is open. */
  commandsManager: boolean
  /** Transient corner notifications (native slash-command feedback). */
  toasts: Toast[]
  /** Second session rendered side-by-side with the active one. */
  split: string | null
  setSplit: (tabId: string | null) => void
  setPanel: (tabId: string, panel: SidePanel) => void
  togglePanel: (tabId: string, panel: Exclude<SidePanel, null>) => void
  setPalette: (palette: 'commands' | 'files' | null) => void
  setCommandsManager: (open: boolean) => void
  toast: (text: string, kind?: 'info' | 'error') => void
  dismissToast: (id: number) => void
}

let toastId = 0

export const useUi = create<UiStore>((set) => ({
  panels: {},
  palette: null,
  commandsManager: false,
  toasts: [],
  split: null,
  setSplit: (tabId) => set((s) => ({ split: s.split === tabId ? null : tabId })),
  setPanel: (tabId, panel) => set((s) => ({ panels: { ...s.panels, [tabId]: panel } })),
  togglePanel: (tabId, panel) =>
    set((s) => ({
      panels: { ...s.panels, [tabId]: s.panels[tabId] === panel ? null : panel }
    })),
  setPalette: (palette) => set({ palette }),
  setCommandsManager: (open) => set({ commandsManager: open }),
  toast: (text, kind = 'info') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
