import { exec } from 'child_process'
import { promisify } from 'util'
import type { PortInfo } from '../shared/types'
import { IS_MAC, IS_WIN, openUrl } from './platform'

const run = promisify(exec)

const LOCAL = ['0.0.0.0', '127.0.0.1', '[::]', '[::1]', '::', '*']

async function listWindows(): Promise<PortInfo[]> {
  const [netstat, tasklist] = await Promise.all([
    run('netstat -ano -p TCP', { windowsHide: true, maxBuffer: 4_000_000 }),
    run('tasklist /FO CSV /NH', { windowsHide: true, maxBuffer: 4_000_000 })
  ])
  const nameByPid = new Map<number, string>()
  for (const line of tasklist.stdout.split('\n')) {
    const m = line.match(/^"([^"]+)","(\d+)"/)
    if (m) nameByPid.set(Number(m[2]), m[1])
  }
  const byPort = new Map<number, PortInfo>()
  for (const line of netstat.stdout.split('\n')) {
    const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/)
    if (!m) continue
    if (!LOCAL.includes(m[1])) continue
    const port = Number(m[2])
    const pid = Number(m[3])
    if (!byPort.has(port)) {
      byPort.set(port, { port, pid, process: nameByPid.get(pid) ?? `pid ${pid}` })
    }
  }
  return [...byPort.values()]
}

/** macOS and Linux share lsof's output shape. */
async function listUnix(): Promise<PortInfo[]> {
  const { stdout } = await run('lsof -iTCP -sTCP:LISTEN -P -n', { maxBuffer: 4_000_000 })
  const byPort = new Map<number, PortInfo>()
  for (const line of stdout.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue
    const port = Number(parts[parts.length - 2].match(/:(\d+)$/)?.[1])
    if (!port) continue
    if (!byPort.has(port)) {
      byPort.set(port, { port, pid: Number(parts[1]), process: parts[0] })
    }
  }
  return [...byPort.values()]
}

/** Listening TCP ports on localhost, with owning process names. */
export const ports = {
  async list(): Promise<PortInfo[] | { error: string }> {
    try {
      const found = IS_WIN ? await listWindows() : await listUnix()
      return found.sort((a, b) => a.port - b.port)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async kill(pid: number): Promise<{ ok: true } | { error: string }> {
    try {
      if (IS_WIN) await run(`taskkill /PID ${pid} /T /F`, { windowsHide: true })
      else process.kill(pid, IS_MAC ? 'SIGKILL' : 'SIGTERM')
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  open(port: number): void {
    openUrl(`http://localhost:${port}`)
  }
}
