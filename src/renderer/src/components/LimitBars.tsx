import { useEffect } from 'react'
import clsx from 'clsx'
import type { LimitWindow } from '@shared/types'
import { fetchLimits, useLimits } from '../stores/limits'

function resetLabel(resetsAt?: number): string {
  if (!resetsAt) return ''
  const d = new Date(resetsAt)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `resets ${time}`
  return `resets ${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

function Bar({
  label,
  window,
  detailed
}: {
  label: string
  window: LimitWindow
  detailed?: boolean
}): React.JSX.Element {
  const pct = Math.min(100, Math.max(0, window.utilization))
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-accent'
  return (
    <div title={`${label}: ${pct.toFixed(0)}% used${window.resetsAt ? ` · ${resetLabel(window.resetsAt)}` : ''}`}>
      <div
        className={clsx(
          'flex items-baseline justify-between text-text-dim',
          detailed ? 'pb-1 text-xs' : 'pb-0.5 text-[10px]'
        )}
      >
        <span>{label}</span>
        <span className="tabular-nums">
          {pct.toFixed(0)}%{detailed && window.resetsAt ? ` · ${resetLabel(window.resetsAt)}` : ''}
        </span>
      </div>
      <div className={clsx('overflow-hidden rounded-full bg-surface-2', detailed ? 'h-2' : 'h-1')}>
        <div
          className={clsx('h-full rounded-full transition-all duration-700', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** Claude plan usage bars (5-hour + weekly windows), like Claude Desktop's.
 *  Data flows through a live session; hidden until the first fetch succeeds. */
export function LimitBars({ detailed }: { detailed?: boolean }): React.JSX.Element | null {
  const limits = useLimits((s) => s.limits)

  useEffect(() => {
    void fetchLimits()
    const timer = setInterval(() => void fetchLimits(), 5 * 60_000)
    return () => clearInterval(timer)
  }, [])

  if (!limits?.available || (!limits.fiveHour && !limits.sevenDay)) return null

  return (
    <div className={clsx('flex flex-col', detailed ? 'gap-3' : 'gap-1.5')}>
      {limits.fiveHour && <Bar label={detailed ? 'Session (5-hour window)' : '5h'} window={limits.fiveHour} detailed={detailed} />}
      {limits.sevenDay && <Bar label={detailed ? 'Week (7-day window)' : 'Week'} window={limits.sevenDay} detailed={detailed} />}
    </div>
  )
}
