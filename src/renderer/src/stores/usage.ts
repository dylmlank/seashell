import { create } from 'zustand'
import type { UsageTotals } from '@shared/types'

interface UsageStore {
  bySession: Record<string, UsageTotals>
}

export const useUsage = create<UsageStore>(() => ({
  bySession: {}
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
}
