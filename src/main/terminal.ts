import { spawn as spawnChild } from 'child_process'
import type { Events } from '../shared/ipc-contract'

type Broadcast = <C extends keyof Events>(channel: C, payload: Events[C]) => void

let broadcast: Broadcast = () => {}
export function setTerminalBroadcast(fn: Broadcast): void {
  broadcast = fn
}

interface PtyProcess {
  onData(cb: (data: string) => void): void
  onExit(cb: () => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }
  ): PtyProcess
}

// Native module — may fail to load (ABI mismatch, missing prebuild). The UI
// falls back to opening a real terminal window when unavailable.
let pty: PtyModule | null | undefined
function loadPty(): PtyModule | null {
  if (pty !== undefined) return pty
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pty = require('@homebridge/node-pty-prebuilt-multiarch') as PtyModule
  } catch (err) {
    console.error('node-pty unavailable, terminal disabled:', err)
    pty = null
  }
  return pty
}

const terms = new Map<string, PtyProcess>()
let counter = 0

export const terminal = {
  create(cwd: string): { termId: string } | { error: string } {
    const mod = loadPty()
    if (!mod) return { error: 'pty-unavailable' }
    try {
      const shell = process.env.COMSPEC ?? 'cmd.exe'
      const proc = mod.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd,
        env: process.env
      })
      const termId = `term-${++counter}`
      terms.set(termId, proc)
      proc.onData((data) => broadcast('term:data', { termId, data }))
      proc.onExit(() => {
        terms.delete(termId)
        broadcast('term:exit', { termId })
      })
      return { termId }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  input(termId: string, data: string): void {
    terms.get(termId)?.write(data)
  },

  resize(termId: string, cols: number, rows: number): void {
    try {
      terms.get(termId)?.resize(cols, rows)
    } catch {
      // resize on a dead pty throws — ignore
    }
  },

  kill(termId: string): void {
    terms.get(termId)?.kill()
    terms.delete(termId)
  },

  killAll(): void {
    for (const t of terms.values()) t.kill()
    terms.clear()
  },

  /** Fallback: open a real Windows terminal in the project folder. */
  openExternal(cwd: string): void {
    spawnChild('cmd.exe', ['/c', 'start', 'cmd'], { cwd, detached: true, windowsHide: false })
  }
}
