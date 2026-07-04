import { useEffect, useState } from 'react'
import { Gauge, Loader2, X } from 'lucide-react'
import type { ContextBreakdown } from '@shared/types'

const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

// The CLI reports terminal-ish color names; map them onto the app palette.
const CLI_COLORS: Record<string, string> = {
  red: '#ef4444',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#eab308',
  magenta: '#d946ef',
  purple: '#a855f7',
  cyan: '#06b6d4',
  orange: '#f97316',
  pink: '#ec4899',
  teal: '#14b8a6',
  gray: '#4b5563',
  grey: '#4b5563',
  white: '#e5e7eb'
}

// Fallback pool for categories whose CLI color is missing or already taken —
// guarantees every category gets its own distinguishable color.
const PALETTE = [
  '#14b8a6',
  '#3b82f6',
  '#a855f7',
  '#f97316',
  '#eab308',
  '#ec4899',
  '#22c55e',
  '#06b6d4',
  '#ef4444',
  '#d946ef'
]

const FREE_CELL = 'var(--color-surface-2)'

type Category = ContextBreakdown['categories'][number]

/** One distinct color per category: honor the CLI's color when it resolves and
 *  isn't already used by a bigger category, otherwise pull from the palette. */
function assignColors(categories: Category[]): Map<string, string> {
  const used = new Set<string>()
  const out = new Map<string, string>()
  for (const c of categories) {
    if (/free/i.test(c.name)) {
      out.set(c.name, FREE_CELL)
      continue
    }
    const wanted = c.color.startsWith('#') ? c.color : CLI_COLORS[c.color.toLowerCase()]
    const color =
      wanted && !used.has(wanted) ? wanted : (PALETTE.find((p) => !used.has(p)) ?? '#6b7280')
    used.add(color)
    out.set(c.name, color)
  }
  return out
}

/** 10×10 grid, 1 cell = 1% of the window, cells colored by category share. */
function buildGrid(data: ContextBreakdown, colors: Map<string, string>): string[] {
  const cells: string[] = []
  for (const c of data.categories) {
    if (c.tokens <= 0 || /free/i.test(c.name)) continue
    const n = Math.max(1, Math.round((c.tokens / data.maxTokens) * 100))
    for (let i = 0; i < n && cells.length < 100; i++) cells.push(colors.get(c.name) ?? '#6b7280')
  }
  while (cells.length < 100) cells.push(FREE_CELL)
  return cells
}

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

  const sorted = (data?.categories ?? [])
    .filter((c) => c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
  const colors = assignColors(sorted)

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
                {sorted.length > 0 ? (
                  <div className="grid grid-cols-10 gap-[3px] pt-1">
                    {buildGrid(data, colors).map((color, i) => (
                      <span
                        key={i}
                        className="aspect-square w-full rounded-[3px]"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(100, data.percentage)}%` }}
                    />
                  </div>
                )}
                <p className="pt-1.5 font-mono text-[10px] text-text-dim/60">{data.model}</p>
              </div>

              <div className="space-y-1 border-t border-border/60 pt-2">
                {sorted.map((c) => (
                  <div key={c.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ backgroundColor: colors.get(c.name) }}
                    />
                    <span className="capitalize text-text-dim">{c.name}</span>
                    <span className="ml-auto tabular-nums">
                      {fmt(c.tokens)}
                      <span className="pl-1 text-text-dim/50">
                        {((c.tokens / data.maxTokens) * 100).toFixed(1)}%
                      </span>
                    </span>
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
