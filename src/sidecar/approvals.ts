import { randomUUID } from 'crypto'
import { resolve } from 'path'
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
  /** Original tool input — allow responses must echo it as updatedInput
   *  (the CLI's response schema requires a record there, not undefined). */
  input: Record<string, unknown>
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
      pending.set(requestId, { resolve, tabId, input })
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
    if (result.behavior === 'allow') {
      // Plain allows echo the original input — the CLI's schema rejects
      // { behavior: 'allow' } without a record updatedInput (ZodError).
      entry.resolve({ behavior: 'allow', updatedInput: result.updatedInput ?? entry.input })
    } else {
      entry.resolve(result)
    }
  },

  /** Is this path the subject of an approval this tab is currently waiting on?
   *  The approval UI has to render a diff against the file Claude is about to
   *  write, and that file is legitimately allowed to sit outside the project
   *  (Claude editing ~/.claude/settings.json, say) — so the read guard in
   *  ipc.ts consults this instead of refusing every out-of-project read. */
  isPendingPath(tabId: string, absPath: string): boolean {
    const target = resolve(absPath)
    for (const entry of pending.values()) {
      if (entry.tabId !== tabId) continue
      for (const key of ['file_path', 'path', 'notebook_path']) {
        const value = entry.input[key]
        if (typeof value === 'string' && resolve(value) === target) return true
      }
    }
    return false
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
