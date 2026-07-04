import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Code2,
  Command,
  File,
  FolderOpen,
  FolderTree,
  GitBranch,
  MessagesSquare,
  Minimize2,
  Play,
  Plus,
  Search,
  Settings2,
  Slash,
  SquareTerminal
} from 'lucide-react'
import clsx from 'clsx'
import { useEditor } from '../stores/editor'
import { createTab, sendMessage, useSessions } from '../stores/sessions'
import { useUi } from '../stores/ui'
import { runInTerminal } from '../lib/terminals'

interface Cmd {
  id: string
  label: string
  hint?: string
  icon: React.ReactNode
  run: () => void
}

/** Cheap fuzzy match: substring beats subsequence beats nothing. */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 1
  const idx = t.indexOf(q)
  if (idx >= 0) return 1000 - idx - t.length / 100
  let ti = 0
  for (const ch of q) {
    ti = t.indexOf(ch, ti)
    if (ti === -1) return -1
    ti++
  }
  return 100 - t.length / 100
}

export function CommandPalette({
  onShowSettings,
  onShowUsage,
  onToggleChanges
}: {
  onShowSettings: () => void
  onShowUsage: () => void
  onToggleChanges: () => void
}): React.JSX.Element | null {
  const palette = useUi((s) => s.palette)
  const setPalette = useUi((s) => s.setPalette)
  const tabs = useSessions((s) => s.tabs)
  const activeTabId = useSessions((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.tabId === activeTabId && !t.side)

  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [scripts, setScripts] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Global shortcuts: Ctrl+K commands, Ctrl+P files, Ctrl+` terminal, Ctrl+B files panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey) return
      const tabId = useSessions.getState().activeTabId
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setPalette(useUi.getState().palette === 'commands' ? null : 'commands')
      } else if (key === 'p' && !e.shiftKey && tabId) {
        e.preventDefault()
        setPalette(useUi.getState().palette === 'files' ? null : 'files')
      } else if (e.key === '`' && tabId) {
        e.preventDefault()
        useUi.getState().togglePanel(tabId, 'terminal')
      } else if (key === 'b' && tabId) {
        e.preventDefault()
        useUi.getState().togglePanel(tabId, 'files')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPalette])

  // Load per-project data when the palette opens.
  useEffect(() => {
    setQuery('')
    setIndex(0)
    if (!palette) return
    inputRef.current?.focus()
    if (!activeTab) return
    if (palette === 'files') {
      void window.api.invoke('fs:listFiles', { tabId: activeTab.tabId }).then((r) => {
        if (!('error' in r)) setFiles(r.files)
      })
    } else {
      void window.api
        .invoke('fs:readFile', { path: `${activeTab.cwd}/package.json` })
        .then((r) => {
          if ('error' in r) return setScripts([])
          try {
            setScripts(Object.keys((JSON.parse(r.content) as { scripts?: Record<string, string> }).scripts ?? {}))
          } catch {
            setScripts([])
          }
        })
    }
  }, [palette, activeTab?.tabId]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = (): void => setPalette(null)

  const commands = useMemo((): Cmd[] => {
    if (palette === 'files') {
      return files.map((rel) => ({
        id: `file:${rel}`,
        label: rel,
        icon: <File size={13} className="text-text-dim" />,
        run: () => {
          if (activeTab) void useEditor.getState().openFile(activeTab.tabId, rel)
        }
      }))
    }
    const list: Cmd[] = []
    if (activeTab) {
      const tabId = activeTab.tabId
      const toggle = useUi.getState().togglePanel
      list.push(
        { id: 'open-file', label: 'Open file…', hint: 'Ctrl+P', icon: <Search size={13} />, run: () => setPalette('files') },
        { id: 'editor', label: 'Toggle editor', icon: <Code2 size={13} />, run: () => toggle(tabId, 'editor') },
        { id: 'files', label: 'Toggle files panel', hint: 'Ctrl+B', icon: <FolderTree size={13} />, run: () => toggle(tabId, 'files') },
        { id: 'terminal', label: 'Toggle terminal', hint: 'Ctrl+`', icon: <SquareTerminal size={13} />, run: () => toggle(tabId, 'terminal') },
        { id: 'sidechat', label: 'Toggle side chat', icon: <MessagesSquare size={13} />, run: () => toggle(tabId, 'sidechat') },
        { id: 'compact', label: 'Compact context now', hint: 'frees context, uses one call', icon: <Minimize2 size={13} />, run: () => sendMessage(tabId, '/compact') },
        ...scripts.map((name) => ({
          id: `script:${name}`,
          label: `Run script: ${name}`,
          hint: 'npm run',
          icon: <Play size={13} className="text-accent" />,
          run: () => {
            useUi.getState().setPanel(tabId, 'terminal')
            void runInTerminal(tabId, activeTab.cwd, `npm run ${name}`)
          }
        }))
      )
    }
    list.push(
      {
        id: 'new-session',
        label: 'New session…',
        icon: <Plus size={13} />,
        run: () => {
          void window.api.invoke('dialog:pickFolder').then((cwd) => {
            if (cwd) void createTab(cwd)
          })
        }
      },
      { id: 'changes', label: 'Toggle git changes', icon: <GitBranch size={13} />, run: onToggleChanges },
      { id: 'slash', label: 'Manage slash commands', hint: '/commands', icon: <Slash size={13} />, run: () => useUi.getState().setCommandsManager(true) },
      { id: 'usage', label: 'Usage & cost', icon: <BarChart3 size={13} />, run: onShowUsage },
      { id: 'settings', label: 'Settings', icon: <Settings2 size={13} />, run: onShowSettings }
    )
    return list
  }, [palette, files, scripts, activeTab, onShowSettings, onShowUsage, onToggleChanges, setPalette])

  const matches = useMemo(() => {
    return commands
      .map((c) => ({ c, score: fuzzyScore(query, c.label) }))
      .filter((m) => m.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((m) => m.c)
  }, [commands, query])

  useEffect(() => setIndex(0), [matches.length, query])

  if (!palette) return null

  const run = (cmd: Cmd): void => {
    close()
    cmd.run()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop-in w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {palette === 'files' ? (
            <FolderOpen size={15} className="text-accent" />
          ) : (
            <Command size={15} className="text-accent" />
          )}
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={palette === 'files' ? 'Jump to a project file…' : 'What do you want to do?'}
            className="w-full bg-transparent text-sm outline-none placeholder:text-text-dim"
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => (i + 1) % Math.max(1, matches.length))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => (i - 1 + matches.length) % Math.max(1, matches.length))
              } else if (e.key === 'Enter' && matches[index]) {
                run(matches[index])
              }
            }}
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim">esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {matches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-dim">No matches.</p>
          ) : (
            matches.map((cmd, i) => (
              <button
                key={cmd.id}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(cmd)}
                className={clsx(
                  'flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm',
                  i === index ? 'bg-accent-dim/25 text-text' : 'text-text-dim'
                )}
              >
                <span className="shrink-0">{cmd.icon}</span>
                <span className={clsx('truncate', palette === 'files' && 'font-mono text-xs')}>
                  {cmd.label}
                </span>
                {cmd.hint && (
                  <span className="ml-auto shrink-0 text-[10px] text-text-dim/60">{cmd.hint}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
