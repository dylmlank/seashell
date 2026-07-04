import { useMemo, useState } from 'react'
import { FileEdit, History, Loader2, Undo2 } from 'lucide-react'
import { confirmDialog } from '../lib/dialogs'
import { rewindTo, useSessions, type ChatItem } from '../stores/sessions'

const MUTATING = /^(Write|Edit|MultiEdit|NotebookEdit)$/

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

interface Checkpoint {
  uuid: string
  turn: number
  text: string
  files: string[]
}

/** Collapse the transcript into one restorable checkpoint per user turn,
 *  tagging each with the files that turn changed. */
function buildCheckpoints(items: ChatItem[]): Checkpoint[] {
  const checkpoints: Checkpoint[] = []
  let turn = 0
  let current: Checkpoint | null = null
  for (const item of items) {
    if (item.kind === 'user') {
      turn += 1
      current = item.uuid
        ? { uuid: item.uuid, turn, text: item.text, files: [] }
        : null
      if (current) checkpoints.push(current)
      continue
    }
    if (current && item.kind === 'tool' && item.status !== 'error' && MUTATING.test(item.toolName)) {
      const path = item.input.file_path ?? item.input.notebook_path
      if (typeof path === 'string' && !current.files.includes(path)) current.files.push(path)
    }
  }
  return checkpoints.reverse()
}

/** Time-travel: a timeline of every turn, each restorable to its exact file state. */
export function Checkpoints({ tabId }: { tabId: string }): React.JSX.Element {
  const items = useSessions((s) => s.tabs.find((t) => t.tabId === tabId)?.items ?? [])
  const checkpoints = useMemo(() => buildCheckpoints(items), [items])
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ uuid: string; ok: boolean; detail: string } | null>(null)

  const restore = async (uuid: string): Promise<void> => {
    if (
      !(await confirmDialog(
        'Restore all files to their state at this checkpoint? The conversation itself is kept.'
      ))
    )
      return
    setBusy(uuid)
    setResult(null)
    const r = await rewindTo(tabId, uuid)
    setBusy(null)
    setResult({ uuid, ok: r.ok, detail: r.detail })
  }

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <History size={15} className="text-accent" />
        Checkpoints
        <span className="ml-auto text-xs font-normal text-text-dim">{checkpoints.length}</span>
      </div>

      {checkpoints.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-text-dim">
          <History size={26} className="opacity-40" />
          <p>No checkpoints yet.</p>
          <p className="text-xs">
            Each message you send becomes a checkpoint you can restore files to.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <ol className="relative space-y-1 border-l border-border/60 pl-4">
            {checkpoints.map((cp) => {
              const isBusy = busy === cp.uuid
              const res = result?.uuid === cp.uuid ? result : null
              return (
                <li key={cp.uuid} className="group relative">
                  <span className="absolute -left-[21px] top-2.5 h-2 w-2 rounded-full bg-border ring-2 ring-surface group-hover:bg-accent" />
                  <div className="rounded-lg px-2 py-2 hover:bg-surface-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-text-dim">Turn {cp.turn}</span>
                      {cp.files.length > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-text-dim">
                          <FileEdit size={11} className="opacity-70" />
                          {cp.files.length} file{cp.files.length > 1 ? 's' : ''}
                        </span>
                      )}
                      <button
                        onClick={() => void restore(cp.uuid)}
                        disabled={isBusy}
                        title="Restore files to this checkpoint"
                        className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-text-dim opacity-0 transition-opacity hover:bg-surface hover:text-accent group-hover:opacity-100 disabled:opacity-100"
                      >
                        {isBusy ? (
                          <Loader2 size={11} className="animate-spin text-accent" />
                        ) : (
                          <Undo2 size={11} />
                        )}
                        Restore
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-text">
                      {cp.text || <span className="text-text-dim italic">(no text)</span>}
                    </p>
                    {cp.files.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {cp.files.slice(0, 6).map((f) => (
                          <span
                            key={f}
                            title={f}
                            className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-dim"
                          >
                            {basename(f)}
                          </span>
                        ))}
                        {cp.files.length > 6 && (
                          <span className="px-1 text-[10px] text-text-dim">
                            +{cp.files.length - 6}
                          </span>
                        )}
                      </div>
                    )}
                    {res && (
                      <p
                        className={
                          'mt-1 text-[11px] ' + (res.ok ? 'text-green-500' : 'text-red-400')
                        }
                      >
                        {res.detail}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
