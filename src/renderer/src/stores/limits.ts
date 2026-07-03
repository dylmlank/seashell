import { create } from 'zustand'
import type { PlanLimits } from '@shared/types'

interface LimitsStore {
  limits: PlanLimits | null
}

export const useLimits = create<LimitsStore>(() => ({ limits: null }))

declare global {
  interface Window {
    __limitsWired?: boolean
  }
}

if (!window.__limitsWired) {
  window.__limitsWired = true
  window.api.on('limits:update', (limits) => {
    if (limits.available) useLimits.setState({ limits })
  })
}

/** Pull the latest plan windows (sidecar caches for 60s; needs a live session). */
export async function fetchLimits(): Promise<void> {
  const limits = await window.api.invoke('usage:limits')
  if (limits.available) useLimits.setState({ limits })
}
