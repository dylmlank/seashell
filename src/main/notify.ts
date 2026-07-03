import { Notification, type BrowserWindow } from 'electron'
import { settingsStore } from './settings-store'

let getWindow: () => BrowserWindow | null = () => null

export function setNotifyWindow(fn: () => BrowserWindow | null): void {
  getWindow = fn
}

/** Show an OS notification when the window is not focused (and enabled in settings). */
export function notifyIfUnfocused(title: string, body: string): void {
  if (!settingsStore.get().notifications) return
  const win = getWindow()
  if (win?.isFocused()) return
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body: body.slice(0, 140) })
  n.on('click', () => {
    const w = getWindow()
    if (w) {
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    }
  })
  n.show()
  win?.flashFrame(true)
}
