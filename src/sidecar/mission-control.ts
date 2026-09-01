import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, parse } from 'path'
import type { MissionState } from '../shared/types'

/** The mission-control server owns all the scanning logic, so this module is a
 *  thin adapter — no project discovery is duplicated here. */
const PORT = Number(process.env.MISSION_CONTROL_PORT ?? process.env.MC_PORT ?? 4317)
const BASE = `http://127.0.0.1:${PORT}`

let starting: Promise<void> | null = null

/** mission-control is a separate checkout that sits next to the projects it
 *  scans, so there's no path we can assume. Try the obvious neighbours and let
 *  MISSION_CONTROL_DIR settle it when they all miss. */
function locate(): string | null {
  const explicit = process.env.MISSION_CONTROL_DIR
  if (explicit) return existsSync(join(explicit, 'server.mjs')) ? explicit : null

  const cwd = process.cwd()
  const candidates = [
    join(cwd, '..', 'mission-control'), // sibling of the app checkout
    join(parse(cwd).root, 'mission-control'), // root of the projects drive
    join(homedir(), 'mission-control')
  ]
  return candidates.find((dir) => existsSync(join(dir, 'server.mjs'))) ?? null
}

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

/** Launch the server if it isn't already up. Concurrent callers share one
 *  attempt so opening the panel twice doesn't spawn two servers. */
async function ensureRunning(): Promise<void> {
  if (await reachable()) return
  if (starting) return starting

  starting = (async () => {
    const dir = locate()
    if (!dir) throw new Error('mission-control not found — set MISSION_CONTROL_DIR to its checkout')

    const child = spawn('node', [join(dir, 'server.mjs')], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // The server reads MC_PORT; keep both ends on the same port.
      env: { ...process.env, MC_PORT: String(PORT) }
    })
    child.unref()

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250))
      if (await reachable()) return
    }
    throw new Error('mission-control did not start')
  })().finally(() => {
    starting = null
  })

  return starting
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  await ensureRunning()
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  })
  return (await res.json()) as T
}

export const missionControl = {
  async state(refresh?: boolean): Promise<MissionState | { error: string }> {
    try {
      return await call<MissionState>(`/api/state${refresh ? '?refresh=1' : ''}`)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async setFlagship(name: string, flagship: boolean): Promise<{ ok: true } | { error: string }> {
    try {
      await call('/api/flagship', { name, flagship })
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async startAgent(name: string): Promise<{ ok: true } | { error: string }> {
    try {
      const result = await call<{ error?: string }>('/api/agent/start', { name })
      return result.error ? { error: result.error } : { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async stopAgent(pid: number): Promise<{ ok: true } | { error: string }> {
    try {
      const result = await call<{ error?: string }>('/api/agent/stop', { pid })
      return result.error ? { error: result.error } : { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
}
