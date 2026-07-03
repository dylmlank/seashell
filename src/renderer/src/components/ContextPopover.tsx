import { useEffect, useState } from 'react'
import { Gauge, Loader2, X } from 'lucide-react'
import type { ContextBreakdown } from '@shared/types'

const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** What's filling the context window, straight from the CLI — makes it obvious
 *  when MCP tool definitions (not the conversation) are eating the budget. */
export function ContextPopover({
  tabId,
  onClose
}: {
  tabId: string
  onClose: () => void
}): React.JSX.Element {
  const [data, setData] = useState<ContextBreakdown | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.invoke('session:contextUsage', { tabId }).then((result) => {
      if ('error' in result) setError(result.error)
      else setData(result)
    })
  }, [tabId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop-in flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <Gauge size={17} className="text-accent" />
          <h2 className="text-sm font-semibold">What&apos;s in the context window</h2>
          <button onClick={onClose} className="ml-auto rounded p-1 hover:bg-surface-2">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-3">
          {error ? (
            <p className="py-2 text-sm text-red-400">{error}</p>
          ) : data === null ? (
            <div className="flex items-center gap-2 py-2 text-sm text-text-dim">
              <Loader2 size={14} className="animate-spin" /> Asking the session…
            </div>
          ) : (
            <>
              <div className="pb-3">
                <div className="flex items-baseline justify-between pb-1 text-sm">
                  <span className="font-medium">
                    {fmt(data.totalTokens)} of {fmt(data.maxTokens)} tokens
                  </span>
                  <span className="text-text-dim">{data.percentage.toFixed(0)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, data.percentage)}%` }}
                  />
                </div>
                <p className="pt-1 font-mono text-[10px] text-text-dim/60">{data.model}</p>
              </div>

              <div className="space-y-1 border-t border-border/60 pt-2">
                {data.categories
                  .filter((c) => c.tokens > 0)
                  .sort((a, b) => b.tokens - a.tokens)
                  .map((c) => (
                    <div key={c.name} className="flex justify-between text-xs">
                      <span className="capitalize text-text-dim">{c.name}</span>
                      <span className="tabular-nums">{fmt(c.tokens)}</span>
                    </div>
                  ))}
              </div>

              {data.mcpServers.length > 0 && (
                <div className="mt-2 border-t border-border/60 pt-2">
                  <p className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
                    MCP connectors (tool definitions)
                  </p>
                  <div className="space-y-1">
                    {data.mcpServers.map((s) => (
                      <div key={s.name} className="flex justify-between text-xs">
                        <span className="font-mono text-text-dim">{s.name}</span>
                        <span className="tabular-nums">{fmt(s.tokens)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="pt-2 text-[11px] leading-snug text-text-dim/70">
                    Most connector tools are deferred — they only enter the context when Claude
                    first uses them, so they usually cost nothing on simple questions.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
