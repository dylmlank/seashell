import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Brain, Loader2, Trash2 } from 'lucide-react'
import type { MemoryFile } from '@shared/types'

function timeAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

/** Browse and edit what Claude remembers about this project
 *  (~/.claude/projects/<project>/memory). */
export function MemoryPanel({ tabId }: { tabId: string }): React.JSX.Element {
  const [files, setFiles] = useState<MemoryFile[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.api.invoke('memory:list', { tabId })
    if ('error' in result) setError(result.error)
    else setFiles(result.files)
  }, [tabId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openFile = async (name: string): Promise<void> => {
    setOpen(name)
    setContent(null)
    setDirty(false)
    const result = await window.api.invoke('memory:read', { tabId, name })
    if ('error' in result) setError(result.error)
    else setContent(result.content)
  }

  const save = async (): Promise<void> => {
    if (!open || content === null) return
    const result = await window.api.invoke('memory:write', { tabId, name: open, content })
    if ('error' in result) setError(result.error)
    else setDirty(false)
  }

  const remove = async (name: string): Promise<void> => {
    if (!confirm(`Delete memory "${name}"? Claude will forget it permanently.`)) return
    await window.api.invoke('memory:delete', { tabId, name })
    if (open === name) setOpen(null)
    void refresh()
  }

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        {open ? (
          <button
            onClick={() => setOpen(null)}
            title="Back to memory list"
            className="rounded p-0.5 text-text-dim hover:bg-surface-2 hover:text-text"
          >
            <ArrowLeft size={14} />
          </button>
        ) : (
          <Brain size={14} className="text-accent" />
        )}
        <span className="truncate font-mono text-xs">{open ?? 'Memory'}</span>
        {open && (
          <button
            onClick={() => void save()}
            disabled={!dirty || content === null}
            className="ml-auto rounded-lg bg-accent px-2.5 py-0.5 text-xs font-medium text-white hover:bg-accent-dim disabled:opacity-40"
          >
            {dirty ? 'Save' : 'Saved'}
          </button>
        )}
      </div>

      {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}

      {open ? (
        content === null && !error ? (
          <div className="flex items-center gap-2 p-4 text-sm text-text-dim">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <textarea
            value={content ?? ''}
            onChange={(e) => {
              setContent(e.target.value)
              setDirty(true)
            }}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-bg p-3 font-mono text-xs leading-relaxed outline-none"
          />
        )
      ) : files === null && !error ? (
        <div className="flex items-center gap-2 p-4 text-sm text-text-dim">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (files ?? []).length === 0 ? (
        <p className="p-4 text-xs leading-relaxed text-text-dim">
          Nothing remembered for this project yet. Claude writes memories here as you work
          (retrospectives, preferences, project facts).
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {(files ?? []).map((f) => (
            <div
              key={f.name}
              onClick={() => void openFile(f.name)}
              className="group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-2"
            >
              <span className="min-w-0 truncate font-mono text-xs">{f.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-text-dim/60">
                {timeAgo(f.modified)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void remove(f.name)
                }}
                title="Delete memory"
                className="shrink-0 rounded p-0.5 text-text-dim opacity-0 hover:bg-border hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
