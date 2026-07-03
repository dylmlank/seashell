import { useEffect, useState } from 'react'
import { CircleHelp, ShieldAlert, Check, X } from 'lucide-react'
import clsx from 'clsx'
import type { ApprovalRequest } from '@shared/types'
import { respond, useApprovals } from '../stores/approvals'
import { DiffView } from './DiffView'

interface AskQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

/** AskUserQuestion isn't a permission prompt — Claude is asking the user to
 *  pick options. Render the real question; the choices go back to the CLI as
 *  updatedInput.answers. */
function QuestionForm({ req }: { req: ApprovalRequest }): React.JSX.Element {
  const questions = (req.input.questions ?? []) as AskQuestion[]
  const [picked, setPicked] = useState<Record<number, Set<string>>>({})
  const [other, setOther] = useState<Record<number, string>>({})

  const toggle = (qi: number, label: string, multi: boolean): void => {
    setPicked((prev) => {
      const current = new Set(prev[qi] ?? [])
      if (current.has(label)) current.delete(label)
      else {
        if (!multi) current.clear()
        current.add(label)
      }
      return { ...prev, [qi]: current }
    })
  }

  const answered = questions.every(
    (_, qi) => (picked[qi]?.size ?? 0) > 0 || (other[qi]?.trim().length ?? 0) > 0
  )

  const submit = (): void => {
    const answers: Record<string, string> = {}
    questions.forEach((q, qi) => {
      const chosen = [...(picked[qi] ?? [])]
      if (other[qi]?.trim()) chosen.push(other[qi].trim())
      answers[q.question] = chosen.join(',')
    })
    respond(req.requestId, { behavior: 'allow', updatedInput: { ...req.input, answers } })
  }

  return (
    <div className="flex flex-col gap-4">
      {questions.map((q, qi) => (
        <div key={qi}>
          <p className="pb-2 text-sm font-medium">{q.question}</p>
          <div className="flex flex-col gap-1.5">
            {q.options.map((opt) => {
              const selected = picked[qi]?.has(opt.label) ?? false
              return (
                <button
                  key={opt.label}
                  onClick={() => toggle(qi, opt.label, q.multiSelect ?? false)}
                  className={clsx(
                    'rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                    selected
                      ? 'border-accent bg-accent/10 text-text'
                      : 'border-border bg-bg text-text-dim hover:border-accent-dim hover:text-text'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={clsx(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        selected ? 'border-accent bg-accent text-white' : 'border-border'
                      )}
                    >
                      {selected && <Check size={11} strokeWidth={3} />}
                    </span>
                    {opt.label}
                  </span>
                  {opt.description && (
                    <span className="mt-0.5 block pl-6 text-xs text-text-dim">
                      {opt.description}
                    </span>
                  )}
                </button>
              )
            })}
            <input
              value={other[qi] ?? ''}
              onChange={(e) => setOther((prev) => ({ ...prev, [qi]: e.target.value }))}
              placeholder="Other — type your own answer…"
              className="rounded-xl border border-border bg-bg px-3 py-2 text-sm outline-none placeholder:text-text-dim/60 focus:border-accent-dim"
            />
          </div>
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <button
          onClick={() =>
            respond(req.requestId, {
              behavior: 'deny',
              message: 'The user dismissed the question — continue with your best judgment.'
            })
          }
          className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm hover:bg-border"
        >
          Skip
        </button>
        <button
          onClick={submit}
          disabled={!answered}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
        >
          <Check size={15} /> Answer
        </button>
      </div>
    </div>
  )
}

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

  // Claude asking a question is its own flow, not a permission check.
  if (req.toolName === 'AskUserQuestion') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8">
        <div className="flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl">
          <div className="flex items-center gap-3">
            <CircleHelp size={22} className="shrink-0 text-accent" />
            <div className="font-semibold">Claude has a question</div>
            {queue.length > 1 && (
              <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-dim">
                +{queue.length - 1} more
              </span>
            )}
          </div>
          <QuestionForm key={req.requestId} req={req} />
        </div>
      </div>
    )
  }

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
