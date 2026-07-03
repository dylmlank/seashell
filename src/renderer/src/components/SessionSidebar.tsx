import { useCallback, useEffect, useState } from 'react'
import {
  History,
  MessageSquare,
  Loader2,
  Pencil,
  Trash2,
  Search,
  Check,
  X,
  Download,
  FileSearch
} from 'lucide-react'
import type { SearchHit, SessionSummary } from '@shared/types'
import { createTab, useSessions } from '../stores/sessions'

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
        className="min-w-0 flex-1 rounded border border-accent-dim bg-bg px-1.5 py-0.5 text-sm outline-none"
      />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDone(value.trim() || null)
        }}
        className="rounded p-0.5 text-green-500 hover:bg-surface-2"
      >
        <Check size={13} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDone(null)
        }}
        className="rounded p-0.5 text-text-dim hover:bg-surface-2"
      >
        <X size={13} />
      </button>
    </span>
  )
}

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
  const [resuming, setResuming] = useState<string | null>(null)
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
    const list = await window.api.invoke('history:listSessions', { dir })
    setSessions(list)
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
    await window.api.invoke('history:rename', { sessionId: s.sessionId, title, dir: s.cwd })
    void refresh()
  }

  const remove = async (s: SessionSummary): Promise<void> => {
    if (!confirm(`Delete "${s.title}"? This removes the session transcript permanently.`)) return
    await window.api.invoke('history:delete', { sessionId: s.sessionId, dir: s.cwd })
    void refresh()
  }

  const exportSession = async (sessionId: string): Promise<void> => {
    const result = await window.api.invoke('history:export', { sessionId })
    if ('error' in result) {
      alert(`Export failed: ${result.error}`)
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

  // Compact sidebar: group sessions under their project folder, newest project first.
  const groups = new Map<string, SessionSummary[]>()
  if (compact) {
    for (const s of filtered) {
      const key = s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).pop() || s.cwd : 'other'
      const list = groups.get(key)
      if (list) list.push(s)
      else groups.set(key, [s])
    }
  }
  const sections: [string, SessionSummary[]][] = compact ? [...groups.entries()] : [['', filtered]]

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
              <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50">
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
                      'group cursor-pointer rounded-lg px-3 py-1.5 transition-colors hover:bg-surface-2 ' +
                      (hit.cwd ? '' : 'opacity-50')
                    }
                  >
                    <div className="flex items-start gap-2">
                      {resuming === hit.sessionId ? (
                        <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-accent" />
                      ) : (
                        <MessageSquare size={13} className="mt-0.5 shrink-0 text-text-dim" />
                      )}
                      <span className="line-clamp-2 min-w-0 text-xs leading-snug text-text-dim">
                        {hit.snippet}
                      </span>
                    </div>
                    <div className="ml-5 flex gap-2 text-[11px] text-text-dim/60">
                      <span>{hit.role === 'user' ? 'you said' : 'Claude said'}</span>
                      <span>{timeAgo(hit.lastModified)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          {sections.map(([project, list]) => (
              <div key={project || 'all'}>
                {compact && (
                  <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50">
                    {project}
                  </div>
                )}
                {list.map((s) => {
                  const isOpen = openSessionIds.includes(s.sessionId)
                  return (
                    <div
                      key={s.sessionId}
                      onClick={() => void resume(s)}
                      title={s.firstPrompt}
                      className={
                        'group block w-full cursor-pointer rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2 ' +
                        (isOpen || !s.cwd ? 'opacity-50' : '')
                      }
                    >
                      <div className="flex items-start gap-2">
                        {resuming === s.sessionId ? (
                          <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-accent" />
                        ) : (
                          <MessageSquare size={13} className="mt-0.5 shrink-0 text-text-dim" />
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
                            <span
                              className={
                                'min-w-0 text-sm leading-snug ' +
                                (compact ? 'line-clamp-2' : 'truncate')
                              }
                            >
                              {s.title || '(untitled)'}
                            </span>
                            <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setRenaming(s.sessionId)
                                }}
                                title="Rename"
                                className="rounded p-1 text-text-dim hover:bg-border hover:text-text"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void exportSession(s.sessionId)
                                }}
                                title="Export as Markdown"
                                className="rounded p-1 text-text-dim hover:bg-border hover:text-text"
                              >
                                <Download size={12} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void remove(s)
                                }}
                                title="Delete"
                                className="rounded p-1 text-text-dim hover:bg-border hover:text-red-400"
                              >
                                <Trash2 size={12} />
                              </button>
                            </span>
                          </>
                        )}
                      </div>
                      <div className="ml-5 flex gap-2 text-xs text-text-dim/70">
                        <span>{timeAgo(s.lastModified)}</span>
                        {!compact && s.cwd && <span className="truncate font-mono">{s.cwd}</span>}
                        {isOpen && <span className="text-accent">open</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}
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
