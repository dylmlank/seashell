import { randomUUID } from 'crypto'
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { notifyIfUnfocused } from './notify'
import type { Events } from '../shared/ipc-contract'

type Broadcast = <C extends keyof Events>(channel: C, payload: Events[C]) => void

let broadcast: Broadcast = () => {}
export function setApprovalBroadcast(fn: Broadcast): void {
  broadcast = fn
}

interface Pending {
  resolve: (result: PermissionResult) => void
  tabId: string
}

const pending = new Map<string, Pending>()

export const approvals = {
  request(
    tabId: string,
    toolName: string,
    input: Record<string, unknown>,
    ctx: {
      signal?: AbortSignal
      toolUseID?: string
      decisionReason?: string
      title?: string
    }
  ): Promise<PermissionResult> {
    const requestId = randomUUID()
    return new Promise<PermissionResult>((resolve) => {
      pending.set(requestId, { resolve, tabId })
      ctx.signal?.addEventListener('abort', () => {
        if (pending.delete(requestId)) {
          broadcast('approval:cancelled', { requestId })
          resolve({ behavior: 'deny', message: 'Cancelled by interrupt' })
        }
      })
      console.log(`[approvals] prompt for ${toolName} (${requestId})`)
      broadcast('session:status', { tabId, status: 'awaitingApproval' })
      try {
        notifyIfUnfocused('Claude needs approval', ctx.title ?? `Wants to use ${toolName}`)
      } catch (err) {
        console.error('[approvals] notification failed:', err)
      }
      broadcast('approval:request', {
        requestId,
        tabId,
        toolUseId: ctx.toolUseID ?? '',
        toolName,
        input,
        promptText: ctx.title,
        decisionReason: ctx.decisionReason
      })
    })
  },

  respond(
    requestId: string,
    result:
      | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
      | { behavior: 'deny'; message: string }
  ): void {
    const entry = pending.get(requestId)
    if (!entry) return
    pending.delete(requestId)
    broadcast('session:status', { tabId: entry.tabId, status: 'streaming' })
    entry.resolve(result)
  },

  cancelAll(tabId: string): void {
    for (const [id, entry] of pending) {
      if (entry.tabId === tabId) {
        pending.delete(id)
        broadcast('approval:cancelled', { requestId: id })
        entry.resolve({ behavior: 'deny', message: 'Session closed' })
      }
    }
  }
}
