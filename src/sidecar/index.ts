/// <reference types="bun-types" />
// Seashell sidecar — the whole "main process" now runs under Bun, spawned
// and supervised by the Tauri (Rust) shell. The frontend talks to it over a
// localhost WebSocket speaking the same channels as the old Electron IPC.
import type { ServerWebSocket } from 'bun'
import type { EventChannel, Events, InvokeChannel } from '../shared/ipc-contract'
import { handlers } from './ipc'
import { devserver } from './devserver'
import { history } from './history'
import { settingsStore } from './settings-store'
import { setApprovalBroadcast } from './approvals'
import { auth, injectStoredToken, setAuthBroadcast } from './auth'
import { setNotifyBroadcast } from './notify'
import { ensureRetrospectiveSkill } from './retrospective'
import { sessionManager, setBroadcast } from './session-manager'
import { usageStore } from './usage-store'

// The Rust shell generates this per launch and hands it to both sides. Refuse
// to run without it: an unsecreted sidecar exposes the whole handler table —
// session:create, fs:writeFile, the lot — to anything that can reach the port.
const secret = process.env.SIDECAR_SECRET ?? ''
if (!secret) {
  console.error(
    '[sidecar] refusing to start: SIDECAR_SECRET is not set. ' +
      'Launch via the Tauri shell (bun run dev), or set it yourself for a standalone run.'
  )
  process.exit(1)
}

// WebSocket upgrades are not subject to CORS, so any page in any browser on
// this machine may try ws://127.0.0.1:<port>. A browser always sends Origin;
// our webview sends its own scheme, and non-browser clients (the test suite)
// send none. The secret is still the real gate — this is defence in depth.
const ALLOWED_ORIGINS = new Set([
  'tauri://localhost', // macOS / Linux production webview
  'http://tauri.localhost', // Windows WebView2 production
  'https://tauri.localhost',
  'http://localhost:5173', // vite dev server
  'http://127.0.0.1:5173'
])

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
    if (url.searchParams.get('s') !== secret) {
      return new Response('forbidden', { status: 403 })
    }
    const origin = req.headers.get('origin')
    if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
      return new Response('forbidden', { status: 403 })
    }
    if (srv.upgrade(req)) return undefined
    return new Response('seashell sidecar', { status: 200 })
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

// Auto-tidy: sweep never-used session transcripts (no first prompt, >1 day
// old) shortly after boot and every 6 hours. Real conversations are kept.
async function tidySweep(): Promise<void> {
  try {
    if (!settingsStore.get().autoTidySessions) return
    const removed = await history.tidy(sessionManager.activeSdkIds())
    if (removed > 0) console.log(`[tidy] removed ${removed} empty session(s)`)
  } catch (err) {
    console.error('[tidy] sweep failed:', err)
  }
}
setTimeout(() => void tidySweep(), 90_000)
setInterval(() => void tidySweep(), 6 * 60 * 60 * 1000)

function shutdown(): void {
  sessionManager.disposeAll()
  devserver.stopAll()
  usageStore.flush()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
