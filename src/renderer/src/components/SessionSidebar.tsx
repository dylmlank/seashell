import { useCallback, useEffect, useState } from 'react'
import {
  ChevronRight,
  History,
  MessageSquare,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  Search,
  Check,
  X,
  Download,
  FileSearch
} from 'lucide-react'
import type { SearchHit, SessionSummary } from '@shared/types'
import { createTab, useSessions } from '../stores/sessions'
import { alertDialog, confirmDialog } from '../lib/dialogs'

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function RenameInput({
  initial,
  onDone
}: {
  initial: string
  onDone: (value: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <span className="flex flex-1 items-center gap-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onDone(value.trim() || null)
          if (e.key === 'Escape') onDone(null)
        }}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 rounded border border-accent-dim bg-bg px-1.5 py-0.5 text-[13px] outline-none"
      />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDone(value.trim() || null)
        }}
        className="rounded p-0.5 text-green-500 hover:bg-surface-2"
      >
        <Check size={12} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDone(null)
        }}
        className="rounded p-0.5 text-text-dim hover:bg-surface-2"
      >
        <X size={12} />
      </button>
    </span>
  )
}

const SECTION_HEADER =
  'flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50'

export function SessionList({
  dir,
  onResume,
  compact
}: {
  dir?: string
  onResume?: () => void
  compact?: boolean
}): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [pinned, setPinned] = useState<string[]>([])
  const [resuming, setResuming] = useState<string | null>(null)
  const [creating, setCreating] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('collapsed-projects') ?? '[]') as unknown
      return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : []
    } catch {
      return []
    }
  })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const tabs = useSessions((s) => s.tabs)
  const openSessionIds = tabs.map((t) => t.sdkSessionId)

  // Debounced full-text search across every past transcript.
  useEffect(() => {
    const q = search.trim()
    if (q.length < 3) {
      setHits(null)
      return
    }
    const timer = setTimeout(() => {
      void window.api.invoke('history:search', { query: q }).then((res) => setHits(res))
    }, 350)
    return () => clearTimeout(timer)
  }, [search])

  const refresh = useCallback(async (): Promise<void> => {
    const [list, pinList] = await Promise.all([
      window.api.invoke('history:listSessions', { dir }),
      window.api.invoke('history:pins')
    ])
    setSessions(list)
    setPinned(pinList)
  }, [dir])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const resume = async (s: SessionSummary): Promise<void> => {
    if (!s.cwd || resuming || renaming) return
    setResuming(s.sessionId)
    try {
      await createTab(s.cwd, s.sessionId)
      onResume?.()
    } finally {
      setResuming(null)
    }
  }

  const rename = async (s: SessionSummary, title: string): Promise<void> => {
    await window.api.invoke('history:rename', { sessionId: s.sessionId, title })
    void refresh()
  }

  const remove = async (s: SessionSummary): Promise<void> => {
    if (!(await confirmDialog(`Delete "${s.title}"? This removes the session transcript permanently.`))) return
    await window.api.invoke('history:delete', { sessionId: s.sessionId })
    void refresh()
  }

  const togglePin = async (s: SessionSummary): Promise<void> => {
    setPinned(await window.api.invoke('history:togglePin', { sessionId: s.sessionId }))
  }

  const exportSession = async (sessionId: string): Promise<void> => {
    const result = await window.api.invoke('history:export', { sessionId })
    if ('error' in result) {
      void alertDialog(`Export failed: ${result.error}`)
      return
    }
    await window.api.saveTextFile(result.suggestedName, result.markdown)
  }

  const resumeHit = async (hit: SearchHit): Promise<void> => {
    if (!hit.cwd || resuming) return
    setResuming(hit.sessionId)
    try {
      await createTab(hit.cwd, hit.sessionId)
      onResume?.()
    } finally {
      setResuming(null)
    }
  }

  const filtered = (sessions ?? []).filter((s) => {
    if (!search.trim()) return true
    const needle = search.toLowerCase()
    return (
      s.title.toLowerCase().includes(needle) ||
      (s.firstPrompt ?? '').toLowerCase().includes(needle) ||
      (s.cwd ?? '').toLowerCase().includes(needle)
    )
  })

  const pinnedSessions = filtered.filter((s) => pinned.includes(s.sessionId))
  const unpinned = filtered.filter((s) => !pinned.includes(s.sessionId))

  // Every session belongs to a project — the folder it ran in. Group by the
  // FULL path (two folders that share a name stay separate projects).
  const groups = new Map<string, SessionSummary[]>()
  if (compact) {
    for (const s of unpinned) {
      const key = s.cwd ?? ''
      const list = groups.get(key)
      if (list) list.push(s)
      else groups.set(key, [s])
    }
  }
  const sections: [string, SessionSummary[]][] = compact ? [...groups.entries()] : [['', unpinned]]

  const toggleCollapse = (cwd: string): void => {
    setCollapsed((prev) => {
      const next = prev.includes(cwd) ? prev.filter((c) => c !== cwd) : [...prev, cwd]
      localStorage.setItem('collapsed-projects', JSON.stringify(next))
      return next
    })
  }

  const newInProject = async (cwd: string): Promise<void> => {
    if (creating) return
    setCreating(cwd)
    try {
      await createTab(cwd)
      onResume?.()
    } finally {
      setCreating(null)
    }
  }

  const renderRow = (s: SessionSummary): React.JSX.Element => {
    const isOpen = openSessionIds.includes(s.sessionId)
    const isPinned = pinned.includes(s.sessionId)
    return (
      <div
        key={s.sessionId}
        onClick={() => void resume(s)}
        title={s.firstPrompt}
        className={
          'group block w-full cursor-pointer rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface-2 ' +
          (isOpen || !s.cwd ? 'opacity-50' : '')
        }
      >
        <div className="flex items-center gap-1.5">
          {resuming === s.sessionId ? (
            <Loader2 size={11} className="shrink-0 animate-spin text-accent" />
          ) : isPinned ? (
            <Pin size={11} className="shrink-0 text-accent" />
          ) : (
            <MessageSquare size={11} className="shrink-0 text-text-dim" />
          )}
          {renaming === s.sessionId ? (
            <RenameInput
              initial={s.title}
              onDone={(value) => {
                setRenaming(null)
                if (value) void rename(s, value)
              }}
            />
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-xs leading-tight">
                {s.title || '(untitled)'}
              </span>
              {/* time makes way for the action buttons on hover */}
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-text-dim/60 group-hover:hidden">
                {isOpen && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="open now" />}
                {timeAgo(s.lastModified)}
              </span>
              <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void togglePin(s)
                  }}
                  title={isPinned ? 'Unpin' : 'Pin to top'}
                  className="rounded p-0.5 text-text-dim hover:bg-border hover:text-accent"
                >
                  {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenaming(s.sessionId)
                  }}
                  title="Rename"
                  className="rounded p-0.5 text-text-dim hover:bg-border hover:text-text"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void exportSession(s.sessionId)
                  }}
                  title="Export as Markdown"
                  className="rounded p-0.5 text-text-dim hover:bg-border hover:text-text"
                >
                  <Download size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void remove(s)
                  }}
                  title="Delete"
                  className="rounded p-0.5 text-text-dim hover:bg-border hover:text-red-400"
                >
                  <Trash2 size={11} />
                </button>
              </span>
            </>
          )}
        </div>
        {!compact && s.cwd && (
          <p className="ml-[17px] truncate font-mono text-[10px] text-text-dim/60">{s.cwd}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Search size={13} className="shrink-0 text-text-dim" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-text-dim"
        />
      </div>

      {sessions === null ? (
        <div className="flex items-center gap-2 p-4 text-sm text-text-dim">
          <Loader2 size={14} className="animate-spin" /> Loading history…
        </div>
      ) : filtered.length === 0 && !hits?.length ? (
        <div className="p-4 text-sm text-text-dim">
          {search ? 'No sessions match.' : 'No past sessions here yet.'}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {hits !== null && (
            <div className="pb-1">
              <div className={SECTION_HEADER}>
                <FileSearch size={11} />
                In transcripts ({hits.length})
              </div>
              {hits.length === 0 ? (
                <p className="px-2 py-1 text-xs text-text-dim/60">no message matches</p>
              ) : (
                hits.map((hit) => (
                  <div
                    key={hit.sessionId}
                    onClick={() => void resumeHit(hit)}
                    title={hit.cwd ?? 'project path unknown — cannot resume'}
                    className={
                      'group cursor-pointer rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-2 ' +
                      (hit.cwd ? '' : 'opacity-50')
                    }
                  >
                    <div className="flex items-start gap-1.5">
                      {resuming === hit.sessionId ? (
                        <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-accent" />
                      ) : (
                        <MessageSquare size={12} className="mt-0.5 shrink-0 text-text-dim" />
                      )}
                      <span className="line-clamp-2 min-w-0 text-xs leading-snug text-text-dim">
                        {hit.snippet}
                      </span>
                    </div>
                    <div className="ml-[18px] flex gap-2 text-[11px] text-text-dim/60">
                      <span>{hit.role === 'user' ? 'you said' : 'Claude said'}</span>
                      <span>{timeAgo(hit.lastModified)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          {pinnedSessions.length > 0 && (
            <div className="border-b border-border/40 pb-1.5">
              <div className={SECTION_HEADER}>
                <Pin size={11} />
                Pinned
              </div>
              {pinnedSessions.map(renderRow)}
            </div>
          )}
          {sections.map(([cwd, list]) => {
            if (list.length === 0) return null
            // Searching expands everything so matches never hide.
            const isCollapsed = compact && !search.trim() && !!cwd && collapsed.includes(cwd)
            return (
              <div key={cwd || 'all'}>
                {compact && (
                  <div
                    className={`group/project ${SECTION_HEADER} cursor-pointer select-none hover:text-text-dim`}
                    title={cwd || undefined}
                    onClick={() => cwd && toggleCollapse(cwd)}
                  >
                    <ChevronRight
                      size={11}
                      className={
                        'shrink-0 transition-transform ' + (isCollapsed ? '' : 'rotate-90')
                      }
                    />
                    <span className="truncate">
                      {cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || cwd : 'unknown folder'}
                    </span>
                    <span className="font-normal text-text-dim/40">{list.length}</span>
                    {cwd && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void newInProject(cwd)
                        }}
                        title={`New session in ${cwd}`}
                        className="ml-auto rounded p-0.5 text-text-dim opacity-0 hover:bg-border hover:text-accent group-hover/project:opacity-100"
                      >
                        {creating === cwd ? (
                          <Loader2 size={12} className="animate-spin text-accent" />
                        ) : (
                          <Plus size={12} />
                        )}
                      </button>
                    )}
                  </div>
                )}
                {!isCollapsed && list.map(renderRow)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SessionSidebar({ dir }: { dir: string }): React.JSX.Element {
  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border bg-surface anim-in">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
        <History size={15} className="text-text-dim" />
        Session history
      </div>
      <SessionList dir={dir} />
    </div>
  )
}
