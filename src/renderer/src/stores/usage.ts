import { create } from 'zustand'
import type { BudgetAlert, UsageTotals } from '@shared/types'

interface UsageStore {
  bySession: Record<string, UsageTotals>
  /** Latest unacknowledged spend warning. A toast would auto-dismiss in three
   *  seconds, which is the wrong lifetime for "you've spent $20 today". */
  alert: BudgetAlert | null
  dismissAlert: () => void
}

export const useUsage = create<UsageStore>((set) => ({
  bySession: {},
  alert: null,
  dismissAlert: () => set({ alert: null })
}))

declare global {
  interface Window {
    __usageWired?: boolean
  }
}

if (!window.__usageWired) {
  window.__usageWired = true
  void window.api.invoke('usage:getAll').then((bySession) => useUsage.setState({ bySession }))
  window.api.on('usage:update', ({ sessionId, totals }) => {
    useUsage.setState((s) => ({ bySession: { ...s.bySession, [sessionId]: totals } }))
  })
  window.api.on('budget:alert', (alert) => {
    // An "exceeded" supersedes a warning still sitting on screen.
    useUsage.setState((s) =>
      s.alert?.level === 'exceeded' && alert.level === 'warning' ? s : { alert }
    )
  })
}
