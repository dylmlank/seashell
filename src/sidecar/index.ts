/// <reference types="bun-types" />
// Claude Shell sidecar — the whole "main process" now runs under Bun, spawned
// and supervised by the Tauri (Rust) shell. The frontend talks to it over a
// localhost WebSocket speaking the same channels as the old Electron IPC.
import type { ServerWebSocket } from 'bun'
import type { EventChannel, Events, InvokeChannel } from '../shared/ipc-contract'
import { handlers } from './ipc'
import { devserver } from './devserver'
import { setApprovalBroadcast } from './approvals'
import { auth, injectStoredToken, setAuthBroadcast } from './auth'
import { setNotifyBroadcast } from './notify'
import { ensureRetrospectiveSkill } from './retrospective'
import { sessionManager, setBroadcast } from './session-manager'
import { usageStore } from './usage-store'

const secret = process.env.SIDECAR_SECRET ?? ''

interface WireRequest {
  id: number
  channel: InvokeChannel
  arg?: unknown
}

const clients = new Set<ServerWebSocket<unknown>>()

function broadcast<C extends EventChannel>(channel: C, payload: Events[C]): void {
  const msg = JSON.stringify({ event: channel, payload })
  for (const ws of clients) ws.send(msg)
}

setBroadcast(broadcast)
setApprovalBroadcast(broadcast)
setAuthBroadcast(broadcast)
setNotifyBroadcast(broadcast)
injectStoredToken()
ensureRetrospectiveSkill()

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.SIDECAR_PORT ?? 0),
  fetch(req, srv) {
    const url = new URL(req.url)
    if (secret && url.searchParams.get('s') !== secret) {
      return new Response('forbidden', { status: 403 })
    }
    if (srv.upgrade(req)) return undefined
    return new Response('claude-shell sidecar', { status: 200 })
  },
  websocket: {
    open(ws) {
      clients.add(ws)
      // Late joiners (reconnects) need the auth state without asking.
      ws.send(JSON.stringify({ event: 'auth:state', payload: auth.getState() }))
    },
    close(ws) {
      clients.delete(ws)
    },
    async message(ws, raw) {
      let req: WireRequest
      try {
        req = JSON.parse(String(raw)) as WireRequest
      } catch {
        return
      }
      try {
        const handler = handlers[req.channel as keyof typeof handlers] as
          | ((arg: unknown) => unknown)
          | undefined
        if (!handler) throw new Error(`Unknown channel: ${req.channel}`)
        const result = await handler(req.arg)
        ws.send(JSON.stringify({ id: req.id, result: result ?? null }))
      } catch (err) {
        ws.send(
          JSON.stringify({ id: req.id, error: err instanceof Error ? err.message : String(err) })
        )
      }
    }
  }
})

// The Rust shell reads this line from stdout to learn where to point the frontend.
console.log(`SIDECAR_PORT=${server.port}`)

function shutdown(): void {
  sessionManager.disposeAll()
  devserver.stopAll()
  usageStore.flush()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
