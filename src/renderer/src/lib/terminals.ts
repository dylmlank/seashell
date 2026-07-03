import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// Terminals live OUTSIDE React so they survive panel toggles and session
// switches — each keeps its xterm instance (scrollback included) attached to a
// detached DOM node that the panel re-adopts on mount.

export interface TermEntry {
  key: number
  termId: string | null
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  exited: boolean
  failed: boolean
}

interface TabTerms {
  entries: TermEntry[]
  active: number
}

const byTab = new Map<string, TabTerms>()
const subs = new Set<() => void>()
let keyCounter = 0
export let version = 0

function emit(): void {
  version++
  subs.forEach((cb) => cb())
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function getTab(tabId: string): TabTerms {
  let tab = byTab.get(tabId)
  if (!tab) {
    tab = { entries: [], active: 0 }
    byTab.set(tabId, tab)
  }
  return tab
}

let wired = false
function wire(): void {
  if (wired) return
  wired = true
  window.api.on('term:data', ({ termId, data }) => {
    for (const tab of byTab.values()) {
      const entry = tab.entries.find((e) => e.termId === termId)
      if (entry) entry.term.write(data)
    }
  })
  window.api.on('term:exit', ({ termId }) => {
    for (const tab of byTab.values()) {
      const entry = tab.entries.find((e) => e.termId === termId)
      if (entry && !entry.exited) {
        entry.exited = true
        entry.term.writeln('\r\n\x1b[90m[process exited]\x1b[0m')
        emit()
      }
    }
  })
}

export async function createTerm(tabId: string): Promise<TermEntry> {
  wire()
  const tab = getTab(tabId)
  const el = document.createElement('div')
  el.className = 'h-full w-full'
  const term = new Terminal({
    fontFamily: "'Cascadia Code', Consolas, monospace",
    fontSize: 13,
    theme: {
      background: '#0a0a0a',
      foreground: '#ededed',
      cursor: '#14b8a6',
      selectionBackground: '#0e3c36'
    }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(el)

  const entry: TermEntry = { key: ++keyCounter, termId: null, term, fit, el, exited: false, failed: false }
  tab.entries.push(entry)
  tab.active = tab.entries.length - 1
  emit()

  const result = await window.api.invoke('term:create', { tabId })
  if ('error' in result) {
    entry.failed = true
    emit()
    return entry
  }
  entry.termId = result.termId
  term.onData((data) => {
    if (entry.termId && !entry.exited) {
      void window.api.invoke('term:input', { termId: entry.termId, data })
    }
  })
  void window.api.invoke('term:resize', { termId: entry.termId, cols: term.cols, rows: term.rows })
  emit()
  return entry
}

export function setActive(tabId: string, index: number): void {
  const tab = getTab(tabId)
  tab.active = Math.max(0, Math.min(index, tab.entries.length - 1))
  emit()
}

export function closeTerm(tabId: string, index: number): void {
  const tab = getTab(tabId)
  const entry = tab.entries[index]
  if (!entry) return
  if (entry.termId) void window.api.invoke('term:kill', { termId: entry.termId })
  entry.term.dispose()
  tab.entries.splice(index, 1)
  tab.active = Math.min(tab.active, tab.entries.length - 1)
  emit()
}

/** Kill every terminal for a closed session tab. */
export function disposeAll(tabId: string): void {
  const tab = byTab.get(tabId)
  if (!tab) return
  for (const entry of tab.entries) {
    if (entry.termId) void window.api.invoke('term:kill', { termId: entry.termId })
    entry.term.dispose()
  }
  byTab.delete(tabId)
  emit()
}

/** Run a shell command in this tab's active terminal, creating one if needed. */
export async function runInTerminal(tabId: string, command: string): Promise<void> {
  const tab = getTab(tabId)
  let entry = tab.entries[tab.active]
  if (!entry || entry.exited || entry.failed) entry = await createTerm(tabId)
  if (entry.termId && !entry.failed) {
    void window.api.invoke('term:input', { termId: entry.termId, data: `${command}\r` })
  }
}
