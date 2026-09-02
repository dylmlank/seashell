import type { BudgetAlert } from '../shared/types'
import { settingsStore } from './settings-store'
import { usageStore } from './usage-store'

/** Spend guardrails.
 *
 *  The app already knew what every turn cost — it just never said anything.
 *  A long agentic run can quietly spend a lot, and the usage panel only tells
 *  you after you go looking. This watches the same numbers and speaks up.
 *
 *  Each threshold fires once per period. Warnings are not blocking: stopping
 *  a half-finished turn to ask about money would leave the project in a worse
 *  state than letting it finish.
 */

/** `${scope}:${period}:${threshold}` for every alert already delivered. */
const fired = new Set<string>()

const WARN_AT = 0.8

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function check(
  scope: 'daily' | 'session',
  period: string,
  spent: number,
  limit: number | null
): BudgetAlert | null {
  if (!limit || limit <= 0 || spent <= 0) return null
  const ratio = spent / limit
  const level = ratio >= 1 ? 'exceeded' : ratio >= WARN_AT ? 'warning' : null
  if (!level) return null
  const key = `${scope}:${period}:${level}`
  if (fired.has(key)) return null
  // Crossing "exceeded" makes the earlier warning moot — don't re-warn later.
  fired.add(key)
  if (level === 'exceeded') fired.add(`${scope}:${period}:warning`)
  return { scope, level, spentUsd: spent, limitUsd: limit }
}

export const budget = {
  /** Called once per finished turn. Returns alerts that have not fired yet. */
  evaluate(sessionId: string, sessionCostUsd: number): BudgetAlert[] {
    const { dailyBudgetUsd, sessionBudgetUsd } = settingsStore.get()
    const day = today()
    const spentToday = usageStore.getHistory()[day]?.costUsd ?? 0
    return [
      check('daily', day, spentToday, dailyBudgetUsd),
      check('session', sessionId, sessionCostUsd, sessionBudgetUsd)
    ].filter((a): a is BudgetAlert => a !== null)
  },

  /** Editing a limit should let the new one alert immediately. */
  reset(): void {
    fired.clear()
  }
}
