import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { EVENT_CHANNELS, type EventChannel, type InvokeChannel } from '../shared/ipc-contract'

const api = {
  invoke: (channel: InvokeChannel, arg?: unknown): Promise<unknown> => {
    return ipcRenderer.invoke(channel, arg)
  },
  // File.path is gone in modern Electron — this is the sanctioned way to get
  // the on-disk path of a dropped/picked file.
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  on: (channel: EventChannel, callback: (payload: unknown) => void): (() => void) => {
    if (!EVENT_CHANNELS.includes(channel)) {
      throw new Error(`Unknown event channel: ${channel}`)
    }
    const listener = (_ev: Electron.IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
