import { create } from 'zustand'
import type { ApprovalRequest } from '@shared/types'

interface ApprovalsStore {
  queue: ApprovalRequest[]
  remove: (requestId: string) => void
}

export const useApprovals = create<ApprovalsStore>((set) => ({
  queue: [],
  remove: (requestId) => set((s) => ({ queue: s.queue.filter((r) => r.requestId !== requestId) }))
}))

declare global {
  interface Window {
    __approvalsWired?: boolean
  }
}

if (!window.__approvalsWired) {
  window.__approvalsWired = true
  window.api.on('approval:request', (req) => {
    useApprovals.setState((s) => ({ queue: [...s.queue, req] }))
  })
  window.api.on('approval:cancelled', ({ requestId }) => {
    useApprovals.getState().remove(requestId)
  })
}

export function respond(
  requestId: string,
  result:
    | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
    | { behavior: 'deny'; message: string }
): void {
  useApprovals.getState().remove(requestId)
  void window.api.invoke('approval:respond', { requestId, ...result })
}
