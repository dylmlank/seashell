import { Wallet, X } from 'lucide-react'
import clsx from 'clsx'
import { useUsage } from '../stores/usage'

const money = (n: number): string => `$${n.toFixed(2)}`

/** Spend warnings sit in the same top slot as the update banner. Deliberately
 *  not a modal: the turn that crossed the threshold has already finished, and
 *  blocking the app over money the user has already spent helps nobody. */
export function BudgetBanner(): React.JSX.Element | null {
  const alert = useUsage((s) => s.alert)
  const dismiss = useUsage((s) => s.dismissAlert)
  if (!alert) return null

  const period = alert.scope === 'daily' ? 'Today' : 'This session'
  const exceeded = alert.level === 'exceeded'

  return (
    <div
      className={clsx(
        'flex items-center gap-3 border-b px-4 py-2 text-sm',
        exceeded ? 'border-red-500/30 bg-red-500/10' : 'border-border bg-surface-2'
      )}
    >
      <Wallet size={15} className={clsx('shrink-0', exceeded ? 'text-red-400' : 'text-accent')} />
      <span className="text-text">
        {period} has {exceeded ? 'passed' : 'reached 80% of'} your{' '}
        {money(alert.limitUsd)} limit — {money(alert.spentUsd)} so far.
      </span>
      <button
        onClick={dismiss}
        className="ml-auto rounded p-1 text-text-dim hover:bg-border hover:text-text"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  )
}
