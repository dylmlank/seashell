import { X, BarChart3 } from 'lucide-react'
import { useUsage } from '../stores/usage'
import { LimitBars } from './LimitBars'

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
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
