import { useEffect, useState } from 'react'
import { ShieldAlert, Check, X } from 'lucide-react'
import type { ApprovalRequest } from '@shared/types'
import { respond, useApprovals } from '../stores/approvals'
import { DiffView } from './DiffView'

function EditDiff({ req }: { req: ApprovalRequest }): React.JSX.Element {
  const oldString = String(req.input.old_string ?? '')
  const newString = String(req.input.new_string ?? '')
  return <DiffView oldValue={oldString} newValue={newString} />
}

function WriteDiff({ req }: { req: ApprovalRequest }): React.JSX.Element {
  const [current, setCurrent] = useState<string | null>(null)
  const filePath = String(req.input.file_path ?? '')

  useEffect(() => {
    let alive = true
    void window.api.invoke('fs:readFile', { path: filePath }).then((res) => {
      if (alive) setCurrent('content' in res ? res.content : '')
    })
    return () => {
      alive = false
    }
  }, [filePath])

  if (current === null) return <div className="text-sm text-text-dim">Loading current file…</div>
  return <DiffView oldValue={current} newValue={String(req.input.content ?? '')} />
}

function RequestBody({ req }: { req: ApprovalRequest }): React.JSX.Element {
  switch (req.toolName) {
    case 'Edit':
      return <EditDiff req={req} />
    case 'Write':
      return <WriteDiff req={req} />
    case 'Bash':
      return (
        <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-bg p-3 text-sm">
          {String(req.input.command ?? '')}
        </pre>
      )
    default:
      return (
        <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-bg p-3 text-xs">
          {JSON.stringify(req.input, null, 2)}
        </pre>
      )
  }
}

function headline(req: ApprovalRequest): string {
  if (req.promptText) return req.promptText
  const target = req.input.file_path ?? req.input.command ?? req.input.path ?? ''
  return `Claude wants to use ${req.toolName}${target ? `: ${String(target).slice(0, 100)}` : ''}`
}

export function ApprovalModal(): React.JSX.Element | null {
  const queue = useApprovals((s) => s.queue)
  const req = queue[0]
  const [denyReason, setDenyReason] = useState('')

  useEffect(() => setDenyReason(''), [req?.requestId])

  if (!req) return null

  const deny = (): void =>
    respond(req.requestId, {
      behavior: 'deny',
      message: denyReason.trim() || 'The user declined this action.'
    })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8">
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <ShieldAlert size={22} className="shrink-0 text-accent" />
          <div>
            <div className="font-semibold">{headline(req)}</div>
            {req.decisionReason && (
              <div className="text-xs text-text-dim">{req.decisionReason}</div>
            )}
          </div>
          {queue.length > 1 && (
            <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-dim">
              +{queue.length - 1} more
            </span>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto">
          <RequestBody req={req} />
        </div>

        <input
          value={denyReason}
          onChange={(e) => setDenyReason(e.target.value)}
          placeholder="Optional: tell Claude why, if denying…"
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none placeholder:text-text-dim focus:border-accent-dim"
        />

        <div className="flex justify-end gap-2">
          <button
            autoFocus
            onClick={deny}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm hover:bg-border"
          >
            <X size={15} /> Deny
          </button>
          <button
            onClick={() => respond(req.requestId, { behavior: 'allow' })}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
          >
            <Check size={15} /> Allow
          </button>
        </div>
      </div>
    </div>
  )
}
