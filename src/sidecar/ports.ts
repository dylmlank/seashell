import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import type { PortInfo } from '../shared/types'

const run = promisify(exec)

/** Listening TCP ports on localhost, with owning process names (Windows). */
export const ports = {
  async list(): Promise<PortInfo[] | { error: string }> {
    try {
      const [netstat, tasklist] = await Promise.all([
        run('netstat -ano -p TCP', { windowsHide: true, maxBuffer: 4_000_000 }),
        run('tasklist /FO CSV /NH', { windowsHide: true, maxBuffer: 4_000_000 })
      ])

      const nameByPid = new Map<number, string>()
      for (const line of tasklist.stdout.split('\n')) {
        // "name.exe","1234",...
        const m = line.match(/^"([^"]+)","(\d+)"/)
        if (m) nameByPid.set(Number(m[2]), m[1])
      }

      const byPort = new Map<number, PortInfo>()
      for (const line of netstat.stdout.split('\n')) {
        const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/)
        if (!m) continue
        const address = m[1]
        if (!['0.0.0.0', '127.0.0.1', '[::]', '[::1]', '::'].includes(address)) continue
        const port = Number(m[2])
        const pid = Number(m[3])
        if (!byPort.has(port)) {
          byPort.set(port, { port, pid, process: nameByPid.get(pid) ?? `pid ${pid}` })
        }
      }
      return [...byPort.values()].sort((a, b) => a.port - b.port)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async kill(pid: number): Promise<{ ok: true } | { error: string }> {
    try {
      await run(`taskkill /PID ${pid} /T /F`, { windowsHide: true })
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  open(port: number): void {
    // `start` goes through the shell's URL handler — same as shell.openExternal did.
    spawn('cmd.exe', ['/c', 'start', '', `http://localhost:${port}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref()
  }
}
