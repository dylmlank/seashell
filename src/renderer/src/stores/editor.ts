import { create } from 'zustand'
import { useSessions } from './sessions'
import { useUi } from './ui'

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', 'exe', 'dll', 'node',
  'woff', 'woff2', 'ttf', 'mp3', 'mp4', 'wav', 'blend', 'db'
])
const MAX_EDIT_SIZE = 400_000

export interface FileBuf {
  rel: string
  text: string
  savedText: string
  /** Set when the file can't be edited (binary, too large, read failure). */
  error?: string
}

interface TabEditor {
  open: FileBuf[]
  active: string | null
  /** Diff-review mode: compare the active file against git HEAD. */
  diff: boolean
}

interface EditorStore {
  byTab: Record<string, TabEditor>
  openFile: (tabId: string, rel: string) => Promise<void>
  setText: (tabId: string, rel: string, text: string) => void
  save: (tabId: string, rel: string) => Promise<string | null>
  closeFile: (tabId: string, rel: string) => void
  setActive: (tabId: string, rel: string) => void
  toggleDiff: (tabId: string) => void
}

const empty = (): TabEditor => ({ open: [], active: null, diff: false })

function cwdOf(tabId: string): string | undefined {
  return useSessions.getState().tabs.find((t) => t.tabId === tabId)?.cwd
}

export const useEditor = create<EditorStore>((set, get) => ({
  byTab: {},

  openFile: async (tabId, rel) => {
    const tab = get().byTab[tabId] ?? empty()
    useUi.getState().setPanel(tabId, 'editor')
    if (tab.open.some((b) => b.rel === rel)) {
      set((s) => ({ byTab: { ...s.byTab, [tabId]: { ...tab, active: rel } } }))
      return
    }

    const ext = rel.split('.').pop()?.toLowerCase() ?? ''
    let buf: FileBuf
    if (BINARY_EXT.has(ext)) {
      buf = { rel, text: '', savedText: '', error: 'Binary file — nothing to edit here.' }
    } else {
      const cwd = cwdOf(tabId)
      const result = cwd
        ? await window.api.invoke('fs:readFile', { path: `${cwd}/${rel}` })
        : { error: 'Session not found' }
      buf =
        'error' in result
          ? { rel, text: '', savedText: '', error: result.error }
          : result.content.length > MAX_EDIT_SIZE
            ? { rel, text: '', savedText: '', error: 'File too large to edit here (>400 KB).' }
            : { rel, text: result.content, savedText: result.content }
    }
    set((s) => {
      const cur = s.byTab[tabId] ?? empty()
      // Re-check: a second click may have raced the read.
      if (cur.open.some((b) => b.rel === rel)) {
        return { byTab: { ...s.byTab, [tabId]: { ...cur, active: rel } } }
      }
      return {
        byTab: { ...s.byTab, [tabId]: { ...cur, open: [...cur.open, buf], active: rel } }
      }
    })
  },

  setText: (tabId, rel, text) =>
    set((s) => {
      const tab = s.byTab[tabId]
      if (!tab) return s
      return {
        byTab: {
          ...s.byTab,
          [tabId]: {
            ...tab,
            open: tab.open.map((b) => (b.rel === rel ? { ...b, text } : b))
          }
        }
      }
    }),

  save: async (tabId, rel) => {
    const buf = get().byTab[tabId]?.open.find((b) => b.rel === rel)
    if (!buf || buf.error) return null
    const result = await window.api.invoke('fs:writeFile', { tabId, rel, content: buf.text })
    if ('error' in result) return result.error
    set((s) => {
      const tab = s.byTab[tabId]
      if (!tab) return s
      return {
        byTab: {
          ...s.byTab,
          [tabId]: {
            ...tab,
            open: tab.open.map((b) => (b.rel === rel ? { ...b, savedText: b.text } : b))
          }
        }
      }
    })
    return null
  },

  closeFile: (tabId, rel) =>
    set((s) => {
      const tab = s.byTab[tabId]
      if (!tab) return s
      const open = tab.open.filter((b) => b.rel !== rel)
      return {
        byTab: {
          ...s.byTab,
          [tabId]: {
            ...tab,
            open,
            active: tab.active === rel ? (open[open.length - 1]?.rel ?? null) : tab.active
          }
        }
      }
    }),

  setActive: (tabId, rel) =>
    set((s) => {
      const tab = s.byTab[tabId] ?? empty()
      return { byTab: { ...s.byTab, [tabId]: { ...tab, active: rel } } }
    }),

  toggleDiff: (tabId) =>
    set((s) => {
      const tab = s.byTab[tabId] ?? empty()
      return { byTab: { ...s.byTab, [tabId]: { ...tab, diff: !tab.diff } } }
    })
}))

/** Claude edited a file on disk — refresh any clean open buffer for it.
 *  Dirty buffers are left alone so the user's typing is never clobbered. */
export async function reloadFromDisk(tabId: string, filePath: string): Promise<void> {
  const cwd = cwdOf(tabId)
  const tab = useEditor.getState().byTab[tabId]
  if (!cwd || !tab) return
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  const buf = tab.open.find(
    (b) => !b.error && normalized.endsWith(b.rel.replace(/\\/g, '/').toLowerCase())
  )
  if (!buf || buf.text !== buf.savedText) return
  const result = await window.api.invoke('fs:readFile', { path: `${cwd}/${buf.rel}` })
  if ('error' in result) return
  useEditor.setState((s) => {
    const cur = s.byTab[tabId]
    if (!cur) return s
    return {
      byTab: {
        ...s.byTab,
        [tabId]: {
          ...cur,
          open: cur.open.map((b) =>
            b.rel === buf.rel && b.text === b.savedText
              ? { ...b, text: result.content, savedText: result.content }
              : b
          )
        }
      }
    }
  })
}
