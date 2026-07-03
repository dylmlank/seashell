import type { Events, Invokes, EventChannel } from '../shared/ipc-contract'

declare global {
  interface Window {
    api: {
      invoke: <C extends keyof Invokes>(
        channel: C,
        ...args: Parameters<Invokes[C]>
      ) => Promise<Awaited<ReturnType<Invokes[C]>>>
      on: <C extends EventChannel>(channel: C, callback: (payload: Events[C]) => void) => () => void
      pathForFile: (file: File) => string
    }
  }
}

export {}
