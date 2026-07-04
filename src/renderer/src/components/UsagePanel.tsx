import { useEffect, useState } from 'react'
import { X, BarChart3 } from 'lucide-react'
import type { DayUsage } from '@shared/types'
import { useUsage } from '../stores/usage'
import { LimitBars } from './LimitBars'

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Last-14-days token bars (output solid, input as the dim base). */
function HistoryGraph(): React.JSX.Element | null {
  const [days, setDays] = useState<{ label: string; day: DayUsage | undefined }[] | null>(null)
  useEffect(() => {
    void window.api.invoke('usage:history').then((history) => {
      const next: { label: string; day: DayUsage | undefined }[] = []
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000)
        next.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, day: history[d.toISOString().slice(0, 10)] })
      }
      setDays(next)
    })
  }, [])
  if (!days) return null

  const max = Math.max(1, ...days.map((d) => (d.day?.outputTokens ?? 0) + (d.day?.inputTokens ?? 0)))
  if (max <= 1) return null

  return (
    <div className="border-b border-border px-5 py-4">
      <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-text-dim">
        Last 14 days
      </p>
      <div className="flex h-24 items-end gap-1.5">
        {days.map(({ label, day }) => {
          const total = (day?.outputTokens ?? 0) + (day?.inputTokens ?? 0)
          const outShare = total > 0 ? (day!.outputTokens / total) * 100 : 0
          return (
            <div key={label} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
              <div
                title={
                  day
                    ? `${label}: ${fmt(day.outputTokens)} out · ${fmt(day.inputTokens)} in · ${day.turns} turns`
                    : `${label}: no usage`
                }
                className="flex w-full flex-col justify-end overflow-hidden rounded-t-md bg-surface-2"
                style={{ height: `${Math.max(3, (total / max) * 100)}%` }}
              >
                <span className="w-full bg-accent/35" style={{ height: `${100 - outShare}%` }} />
                <span className="w-full bg-accent" style={{ height: `${outShare}%` }} />
              </div>
              <span className="truncate text-[9px] text-text-dim/60">{label}</span>
            </div>
          )
        })}
      </div>
      <p className="pt-1.5 text-[10px] text-text-dim/60">
        solid = output tokens · dim = fresh input tokens (cache reads excluded)
      </p>
    </div>
  )
}

export function UsagePanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const bySession = useUsage((s) => s.bySession)
  const rows = Object.entries(bySession)

  const total = rows.reduce(
    (acc, [, u]) => ({
      input: acc.input + u.inputTokens,
      output: acc.output + u.outputTokens,
      cacheRead: acc.cacheRead + u.cacheReadTokens,
      cost: acc.cost + u.costUsd
    }),
    { input: 0, output: 0, cacheRead: 0, cost: 0 }
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <BarChart3 size={18} className="text-accent" />
          <h2 className="font-semibold">Usage</h2>
          <span className="text-xs text-text-dim">
            reported by Claude Code — informational on a subscription
          </span>
          <button onClick={onClose} className="ml-auto rounded p-1 hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>

        <HistoryGraph />

        <div className="border-b border-border px-5 py-4">
          <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-text-dim">
            Plan limits
          </p>
          <LimitBars detailed />
          <p className="pt-2 text-[11px] text-text-dim/60">
            These are your Claude plan&apos;s rate-limit windows — the same numbers Claude Desktop
            shows. Needs an open session to refresh.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-3 border-b border-border px-5 py-4">
          {[
            ['Input tokens', fmt(total.input)],
            ['Output tokens', fmt(total.output)],
            ['Cache reads', fmt(total.cacheRead)],
            ['Total cost', `$${total.cost.toFixed(2)}`]
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-surface-2 px-4 py-3">
              <div className="text-lg font-semibold">{value}</div>
              <div className="text-xs text-text-dim">{label}</div>
            </div>
          ))}
        </div>

        <div className="overflow-y-auto px-5 py-3">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-dim">No usage recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-dim">
                  <th className="py-1.5 font-medium">Session</th>
                  <th className="font-medium">Model</th>
                  <th className="text-right font-medium">In</th>
                  <th className="text-right font-medium">Out</th>
                  <th className="text-right font-medium">Cache</th>
                  <th className="text-right font-medium">Turns</th>
                  <th className="text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([sessionId, u]) => (
                  <tr key={sessionId} className="border-t border-border/50">
                    <td className="py-1.5 font-mono text-xs text-text-dim">
                      {sessionId.slice(0, 8)}
                    </td>
                    <td className="text-xs">{u.model?.replace('claude-', '') ?? '—'}</td>
                    <td className="text-right">{fmt(u.inputTokens)}</td>
                    <td className="text-right">{fmt(u.outputTokens)}</td>
                    <td className="text-right">{fmt(u.cacheReadTokens)}</td>
                    <td className="text-right">{u.turns}</td>
                    <td className="text-right">${u.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
