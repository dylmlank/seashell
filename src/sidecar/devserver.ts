import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { DevServerStatus } from '../shared/types'

interface DevProc {
  child: ChildProcess
  command: string
  url?: string
  log: string[]
  error?: string
  exited: boolean
}

const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^\s'"]*)/i

/** Prefer the conventional dev scripts, in order. */
const SCRIPT_PRIORITY = ['dev', 'start', 'serve', 'preview']

function detectPackageManager(cwd: string): string {
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun'
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function detectScript(cwd: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    const scripts = pkg.scripts ?? {}
    return SCRIPT_PRIORITY.find((s) => typeof scripts[s] === 'string')
  } catch {
    return undefined
  }
}

/** Long-lived dev servers we launch on the user's behalf, keyed by project cwd. */
export const devserver = {
  procs: new Map<string, DevProc>(),

  status(cwd: string): DevServerStatus {
    const proc = this.procs.get(cwd)
    if (!proc || proc.exited) {
      return { running: false, starting: false, log: proc?.log ?? [], error: proc?.error }
    }
    return {
      running: true,
      starting: !proc.url,
      command: proc.command,
      url: proc.url,
      pid: proc.child.pid,
      log: proc.log,
      error: proc.error
    }
  },

  start(cwd: string): DevServerStatus {
    const existing = this.procs.get(cwd)
    if (existing && !existing.exited) return this.status(cwd)

    if (!existsSync(join(cwd, 'package.json'))) {
      return { running: false, starting: false, log: [], error: 'No package.json in this project' }
    }
    const script = detectScript(cwd)
    if (!script) {
      return {
        running: false,
        starting: false,
        log: [],
        error: 'No dev/start/serve/preview script found in package.json'
      }
    }
    const pm = detectPackageManager(cwd)
    const command = `${pm} run ${script}`

    let child: ChildProcess
    try {
      // shell:true resolves the pm's .cmd shim on Windows; a new process group
      // so we can tree-kill it later.
      child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '0', BROWSER: 'none' }
      })
    } catch (err) {
      return {
        running: false,
        starting: false,
        log: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }

    const proc: DevProc = { child, command, log: [], exited: false }
    this.procs.set(cwd, proc)

    const onData = (buf: Buffer): void => {
      const text = buf.toString()
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        proc.log.push(line)
        if (proc.log.length > 60) proc.log.shift()
        if (!proc.url) {
          const m = line.match(URL_RE)
          if (m) proc.url = m[1].replace('0.0.0.0', 'localhost').replace(/\/$/, '')
        }
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (err) => {
      proc.error = err.message
      proc.exited = true
    })
    child.on('exit', (code) => {
      proc.exited = true
      if (code && code !== 0 && !proc.url) {
        proc.error = `Dev server exited (code ${code})`
      }
    })

    return this.status(cwd)
  },

  stop(cwd: string): { ok: true } {
    const proc = this.procs.get(cwd)
    if (proc && !proc.exited && proc.child.pid) {
      // Tree-kill the shell and its node child.
      spawn('taskkill', ['/PID', String(proc.child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
    }
    this.procs.delete(cwd)
    return { ok: true }
  },

  stopAll(): void {
    for (const cwd of this.procs.keys()) this.stop(cwd)
  }
}
