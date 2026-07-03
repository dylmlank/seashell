import { useCallback, useEffect, useState } from 'react'
import {
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  Undo2,
  FilePlus2,
  FilePen,
  FileX2,
  Loader2
} from 'lucide-react'
import type { BranchInfo, ChangedFile } from '@shared/types'
import { useSessions } from '../stores/sessions'
import { DiffView } from './DiffView'
import { alertDialog, confirmDialog } from '../lib/dialogs'

function statusIcon(status: string): React.JSX.Element {
  if (status === '??' || status.includes('A')) return <FilePlus2 size={13} className="text-green-500" />
  if (status.includes('D')) return <FileX2 size={13} className="text-red-400" />
  return <FilePen size={13} className="text-accent" />
}

export function ChangesPanel({ tabId }: { tabId: string }): React.JSX.Element {
  const status = useSessions((s) => s.tabs.find((t) => t.tabId === tabId)?.status)
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ oldText: string; newText: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [branches, setBranches] = useState<BranchInfo | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [commitError, setCommitError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.api.invoke('changes:list', { tabId })
    if ('error' in result) {
      setError(result.error)
      setFiles(null)
    } else {
      setError(null)
      setFiles(result.files)
      setSelected((prev) => (prev && result.files.some((f) => f.path === prev) ? prev : null))
    }
    const b = await window.api.invoke('changes:branches', { tabId })
    setBranches('error' in b ? null : b)
  }, [tabId])

  const checkout = async (branch: string): Promise<void> => {
    setBusy(true)
    const result = await window.api.invoke('changes:checkout', { tabId, branch })
    setBusy(false)
    if ('error' in result) void alertDialog(`Could not switch branch: ${result.error}`)
    void refresh()
  }

  const commit = async (): Promise<void> => {
    if (!files) return
    const chosen = files.map((f) => f.path).filter((p) => !excluded.has(p))
    setCommitError(null)
    setBusy(true)
    const result = await window.api.invoke('changes:commit', {
      tabId,
      message,
      files: chosen
    })
    setBusy(false)
    if ('error' in result) {
      setCommitError(result.error)
    } else {
      setMessage('')
      setExcluded(new Set())
      void refresh()
    }
  }

  // Refresh when the panel opens and whenever a turn finishes.
  useEffect(() => {
    void refresh()
  }, [refresh, status === 'idle'])

  useEffect(() => {
    if (!selected) {
      setDiff(null)
      return
    }
    let alive = true
    void window.api.invoke('changes:diff', { tabId, path: selected }).then((result) => {
      if (alive) setDiff('error' in result ? null : result)
    })
    return () => {
      alive = false
    }
  }, [tabId, selected, files])

  const revert = async (path: string): Promise<void> => {
    if (!(await confirmDialog(`Revert ${path} to its last committed state? This discards the changes.`))) return
    setBusy(true)
    await window.api.invoke('changes:revert', { tabId, path })
    setBusy(false)
    void refresh()
  }

  return (
    <div className="flex w-96 shrink-0 flex-col border-l border-border bg-surface anim-in">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
        <GitBranch size={15} className="text-text-dim" />
        Changes
        {files && <span className="text-xs text-text-dim">({files.length})</span>}
        {branches && (
          <select
            value={branches.current}
            disabled={busy}
            onChange={(e) => void checkout(e.target.value)}
            title="Switch branch"
            className="ml-1 max-w-32 rounded-lg border border-border bg-surface-2 px-2 py-0.5 text-xs text-text-dim outline-none hover:text-text"
          >
            {branches.branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => void refresh()}
          title="Refresh"
          className="ml-auto rounded p-1 text-text-dim hover:bg-surface-2 hover:text-text"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {error ? (
        <p className="p-4 text-xs text-text-dim">
          Not a git repository (or git unavailable): {error}
        </p>
      ) : files === null ? (
        <div className="flex items-center gap-2 p-4 text-sm text-text-dim">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : files.length === 0 ? (
        <p className="p-4 text-sm text-text-dim">Working tree clean — no changes yet.</p>
      ) : (
        <>
          <div className="max-h-48 shrink-0 overflow-y-auto border-b border-border p-1.5">
            {files.map((f) => (
              <div
                key={f.path}
                className={
                  'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ' +
                  (selected === f.path ? 'bg-surface-2' : 'hover:bg-surface-2/60')
                }
              >
                <input
                  type="checkbox"
                  checked={!excluded.has(f.path)}
                  onChange={(e) => {
                    setExcluded((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.delete(f.path)
                      else next.add(f.path)
                      return next
                    })
                  }}
                  title="Include in commit"
                  className="shrink-0 accent-[#14b8a6]"
                />
                <button
                  onClick={() => setSelected(f.path)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {statusIcon(f.status)}
                  <span className="truncate font-mono text-xs">{f.path}</span>
                </button>
                <button
                  onClick={() => void revert(f.path)}
                  disabled={busy}
                  title="Revert this file"
                  className="rounded p-1 text-text-dim opacity-0 hover:bg-border hover:text-red-400 group-hover:opacity-100"
                >
                  <Undo2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {selected && diff ? (
              <DiffView oldValue={diff.oldText} newValue={diff.newText} />
            ) : (
              <p className="p-3 text-xs text-text-dim">Select a file to see its diff.</p>
            )}
          </div>
          <div className="shrink-0 border-t border-border p-2.5">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Commit message…"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm outline-none placeholder:text-text-dim focus:border-accent-dim"
            />
            {commitError && <p className="pb-1 text-xs text-red-400">{commitError}</p>}
            <button
              onClick={() => void commit()}
              disabled={
                busy || !message.trim() || files.every((f) => excluded.has(f.path))
              }
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
            >
              <GitCommitHorizontal size={15} />
              Commit {files.length - excluded.size} file
              {files.length - excluded.size === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
