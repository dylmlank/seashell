import type { Events } from '../shared/ipc-contract'
import { settingsStore } from './settings-store'

type Broadcast = <C extends keyof Events>(channel: C, payload: Events[C]) => void

let broadcast: Broadcast = () => {}
export function setNotifyBroadcast(fn: Broadcast): void {
  broadcast = fn
}

/** Ask the frontend to show an OS notification (it checks focus and shows it
 *  through Tauri's notification plugin). */
export function notifyIfUnfocused(title: string, body: string): void {
  if (!settingsStore.get().notifications) return
  broadcast('notify', { title, body: body.slice(0, 140) })
}
