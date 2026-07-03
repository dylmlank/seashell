import { memo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Wrench, Bot } from 'lucide-react'
import type { ChatItem } from '../stores/sessions'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

export function summarizeInput(input: Record<string, unknown>): string {
  const first =
    (input.file_path as string) ??
    (input.command as string) ??
    (input.pattern as string) ??
    (input.path as string) ??
    (input.url as string) ??
    (input.description as string) ??
    ''
  const s = String(first)
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}

export const ToolCallCard = memo(function ToolCallCard({
  item
}: {
  item: ToolItem
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const StatusIcon =
    item.status === 'running' ? (
      <Loader2 size={14} className="animate-spin text-accent" />
    ) : item.status === 'error' ? (
      <XCircle size={14} className="text-red-400" />
    ) : (
      <CheckCircle2 size={14} className="text-green-500" />
    )

  return (
    <div className="my-0.5 rounded-xl border border-border/60 text-sm anim-in">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-surface"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={13} className="text-text-dim" />
        <span className="font-medium">{item.toolName}</span>
        <span className="truncate font-mono text-xs text-text-dim">
          {summarizeInput(item.input)}
        </span>
        <span className="ml-auto">{StatusIcon}</span>
      </button>
      {item.subagent && item.subagent.length > 0 && (
        <div className="border-t border-border/60 px-3 py-1.5">
          <div className="flex items-center gap-1.5 text-xs text-text-dim">
            <Bot size={12} className="text-accent" />
            agent activity
          </div>
          <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto pl-4">
            {item.subagent.slice(-12).map((line, i) => (
              <div key={i} className="truncate text-xs text-text-dim anim-in">
                {line.split('\n')[0]}
              </div>
            ))}
          </div>
        </div>
      )}
      {open && (
        <div className="border-t border-border px-3 py-2">
          <div className="mb-1 text-xs font-semibold text-text-dim">Input</div>
          <pre className="max-h-48 overflow-auto rounded bg-bg p-2 text-xs">
            {JSON.stringify(item.input, null, 2)}
          </pre>
          {item.result !== undefined && (
            <>
              <div className="mb-1 mt-2 text-xs font-semibold text-text-dim">
                {item.isError ? 'Error' : 'Result'}
              </div>
              <pre className="max-h-48 overflow-auto rounded bg-bg p-2 text-xs whitespace-pre-wrap">
                {item.result.length > 4000 ? item.result.slice(0, 4000) + '\n…(truncated)' : item.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
})
