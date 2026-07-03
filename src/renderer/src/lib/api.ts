// The window.api bridge, Tauri edition. Same contract the Electron preload
// exposed, now backed by a WebSocket to the Bun sidecar (sessions, files,
// history…) plus native Tauri commands/plugins for dialogs and notifications.
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open, save } from '@tauri-apps/plugin-dialog'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification'
import type { EventChannel, Events, Invokes } from '@shared/ipc-contract'

interface SidecarInfo {
  port: number
  secret: string
}

type Listener = (payload: unknown) => void

const listeners = new Map<EventChannel, Set<Listener>>()
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let nextId = 1
let ready: Promise<WebSocket>

function dispatchEvent(channel: EventChannel, payload: unknown): void {
  for (const cb of listeners.get(channel) ?? []) cb(payload)
}

function openSocket(info: SidecarInfo): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/?s=${info.secret}`)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error('sidecar socket failed'))
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as
        | { id: number; result?: unknown; error?: string }
        | { event: EventChannel; payload: unknown }
      if ('event' in msg) {
        dispatchEvent(msg.event, msg.payload)
        return
      }
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error !== undefined) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
    }
    ws.onclose = () => {
      for (const [, p] of pending) p.reject(new Error('sidecar disconnected'))
      pending.clear()
      ready = connect() // the Rust shell restarts it; reconnect when it's back
    }
  })
}

async function connect(): Promise<WebSocket> {
  for (;;) {
    try {
      const info = await tauriInvoke<SidecarInfo>('sidecar_info')
      if (info.port > 0) return await openSocket(info)
    } catch {
      // Tauri not ready yet (dev HMR) — keep polling
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}

ready = connect()

export const api = {
  invoke: async <C extends keyof Invokes>(
    channel: C,
    ...args: Parameters<Invokes[C]>
  ): Promise<Awaited<ReturnType<Invokes[C]>>> => {
    if (channel === 'dialog:pickFolder') {
      const dir = await open({ directory: true, multiple: false })
      return (dir ?? null) as unknown as Awaited<ReturnType<Invokes[C]>>
    }
    const ws = await ready
    return new Promise<Awaited<ReturnType<Invokes[C]>>>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      ws.send(JSON.stringify({ id, channel, arg: args[0] }))
    })
  },

  on: <C extends EventChannel>(channel: C, callback: (payload: Events[C]) => void): (() => void) => {
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
    }
    set.add(callback as Listener)
    return () => set.delete(callback as Listener)
  },

  /** Webview File objects carry no disk path — attachments go through pickFiles. */
  pathForFile: (_file: File): string => '',

  /** Native multi-file picker; returns absolute paths. */
  pickFiles: async (): Promise<string[] | null> => {
    const result = await open({ multiple: true })
    if (!result) return null
    return Array.isArray(result) ? result : [result]
  },

  /** Save dialog + write, for exports. Returns the chosen path or null. */
  saveTextFile: async (suggestedName: string, text: string): Promise<string | null> => {
    const path = await save({ defaultPath: suggestedName })
    if (!path) return null
    await tauriInvoke('save_text_file', { path, contents: text })
    return path
  }
}

window.api = api

// Sidecar-requested OS notifications (it can't see window focus; we can).
api.on('notify', ({ title, body }) => {
  void (async () => {
    if (document.hasFocus()) return
    // Taskbar flash always works, even where toasts don't (unpackaged dev builds).
    void tauriInvoke('flash_window')
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === 'granted'
    if (granted) sendNotification({ title, body })
  })()
})

// Tauri owns drag-drop (that's how we get real file paths in a webview) —
// re-broadcast drops as a DOM event the composer picks up.
void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type === 'drop' && event.payload.paths.length) {
    window.dispatchEvent(new CustomEvent('shell-file-drop', { detail: event.payload.paths }))
  }
})

// External links in chat markdown open in the default browser, not the webview.
document.addEventListener('click', (e) => {
  const anchor = (e.target as HTMLElement).closest?.('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return
  if (/^https?:\/\//.test(anchor.href)) {
    e.preventDefault()
    void tauriInvoke('open_external', { url: anchor.href })
  }
})

declare global {
  interface Window {
    api: typeof api
  }
}
