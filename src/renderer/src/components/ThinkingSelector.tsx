import { useEffect, useRef, useState } from 'react'
import { Brain, Check, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import type { ThinkingLevel } from '@shared/types'
import { setThinking, useSessions } from '../stores/sessions'

const LEVELS: { id: ThinkingLevel; label: string; hint: string }[] = [
  { id: 'off', label: 'No thinking', hint: 'Fastest — straight to the answer' },
  { id: 'low', label: 'Low', hint: 'Quick reasoning for simple tasks' },
  { id: 'medium', label: 'Medium', hint: 'Balanced reasoning' },
  { id: 'high', label: 'High', hint: 'Deep reasoning for tricky problems' },
  { id: 'ultra', label: 'Ultra', hint: 'Maximum reasoning budget' }
]

/** Claude Desktop-style extended-thinking control. Changes take effect live —
 *  the sidecar re-budgets thinking tokens for the rest of the session. */
export function ThinkingSelector({ tabId }: { tabId: string }): React.JSX.Element {
  const level = useSessions((s) => s.tabs.find((t) => t.tabId === tabId)?.thinkingLevel ?? 'off')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const on = level !== 'off'
  const current = LEVELS.find((l) => l.id === level) ?? LEVELS[0]

  const pick = (id: ThinkingLevel): void => {
    setOpen(false)
    if (id !== level) setThinking(tabId, id)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Extended thinking — how much Claude reasons before answering"
        className={clsx(
          'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-surface-2',
          on ? 'text-accent' : 'text-text-dim hover:text-text'
        )}
      >
        <Brain size={12} className={on ? '' : 'opacity-70'} />
        <span className="max-w-28 truncate">{on ? current.label : 'Think'}</span>
        <ChevronDown size={12} className={'transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {open && (
        <div className="pop-in absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-surface-2 py-1 shadow-2xl shadow-black/50">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              onClick={() => pick(l.id)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-border/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{l.label}</span>
                <span className="block text-[11px] text-text-dim">{l.hint}</span>
              </span>
              {l.id === level && <Check size={13} className="mt-0.5 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
