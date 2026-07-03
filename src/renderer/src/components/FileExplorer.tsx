import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FolderTree,
  Loader2
} from 'lucide-react'
import type { DirEntry } from '@shared/types'
import { useEditor } from '../stores/editor'

function TreeLevel({
  tabId,
  rel,
  depth,
  onOpenFile
}: {
  tabId: string
  rel: string
  depth: number
  onOpenFile: (rel: string) => void
}): React.JSX.Element {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    void window.api.invoke('fs:listDir', { tabId, rel }).then((result) => {
      if (!alive) return
      if ('error' in result) setError(result.error)
      else setEntries(result.entries)
    })
    return () => {
      alive = false
    }
  }, [tabId, rel])

  if (error) return <p className="px-3 py-1 text-xs text-text-dim">{error}</p>
  if (entries === null)
    return (
      <div className="px-3 py-1" style={{ paddingLeft: depth * 14 + 12 }}>
        <Loader2 size={12} className="animate-spin text-text-dim" />
      </div>
    )

  return (
    <>
      {entries.map((e) => {
        const childRel = rel ? `${rel}/${e.name}` : e.name
        const isOpen = expanded.has(e.name)
        return (
          <div key={e.name}>
            <button
              onClick={() => {
                if (e.isDir) {
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(e.name)) next.delete(e.name)
                    else next.add(e.name)
                    return next
                  })
                } else {
                  onOpenFile(childRel)
                }
              }}
              style={{ paddingLeft: depth * 14 + 8 }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm text-text-dim hover:bg-surface-2 hover:text-text"
            >
              {e.isDir ? (
                <>
                  {isOpen ? (
                    <ChevronDown size={12} className="shrink-0" />
                  ) : (
                    <ChevronRight size={12} className="shrink-0" />
                  )}
                  {isOpen ? (
                    <FolderOpen size={13} className="shrink-0 text-accent/70" />
                  ) : (
                    <Folder size={13} className="shrink-0 text-accent/70" />
                  )}
                </>
              ) : (
                <File size={13} className="ml-4 shrink-0 opacity-60" />
              )}
              <span className="truncate">{e.name}</span>
            </button>
            {e.isDir && isOpen && (
              <TreeLevel tabId={tabId} rel={childRel} depth={depth + 1} onOpenFile={onOpenFile} />
            )}
          </div>
        )
      })}
      {entries.length === 0 && (
        <p className="px-3 py-1 text-xs text-text-dim/60" style={{ paddingLeft: depth * 14 + 12 }}>
          empty
        </p>
      )}
    </>
  )
}

/** Project file tree; clicking a file opens it in the editor pane. */
export function FileExplorer({ tabId }: { tabId: string }): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
        <FolderTree size={15} className="text-text-dim" />
        Files
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <TreeLevel
          tabId={tabId}
          rel=""
          depth={0}
          onOpenFile={(rel) => void useEditor.getState().openFile(tabId, rel)}
        />
      </div>
    </div>
  )
}
