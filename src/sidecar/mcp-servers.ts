import { spawn } from 'child_process'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { McpCheckResult, McpServerEntry } from '../shared/types'
import { writeFileAtomicSync } from './atomic-write'
import { readJsonFile } from './json-file'

/** MCP servers, managed where Claude Code already looks for them.
 *
 *  Active servers live in the project's `.mcp.json` — the same file the CLI
 *  reads, and the same one the self-extend prompt tells Claude to write to,
 *  so anything configured here works in a terminal session too.
 *
 *  Disabling is a move, not a flag: `.mcp.json` has no "off" switch, and a
 *  Seashell-only one would mean a server the app hides but the CLI still
 *  launches. Disabled entries are parked in `.claude/mcp-disabled.json`, out
 *  of the file everything loads, and moved back on re-enable.
 */

interface RawServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  type?: string
  url?: string
}

type ServerMap = Record<string, RawServer>

const activePath = (cwd: string): string => join(cwd, '.mcp.json')
const parkedPath = (cwd: string): string => join(cwd, '.claude', 'mcp-disabled.json')

function readMap(path: string, key: 'mcpServers' | 'servers'): ServerMap {
  try {
    const parsed = readJsonFile<Record<string, unknown>>(path)
    const map = parsed[key]
    return map && typeof map === 'object' ? (map as ServerMap) : {}
  } catch {
    return {}
  }
}

function toEntry(name: string, raw: RawServer, enabled: boolean): McpServerEntry {
  const transport = raw.url ? (raw.type === 'sse' ? 'sse' : 'http') : 'stdio'
  return {
    name,
    enabled,
    transport,
    ...(raw.command ? { command: raw.command } : {}),
    ...(raw.args?.length ? { args: raw.args } : {}),
    ...(raw.env && Object.keys(raw.env).length ? { env: raw.env } : {}),
    ...(raw.url ? { url: raw.url } : {})
  }
}

function toRaw(entry: McpServerEntry): RawServer {
  if (entry.transport !== 'stdio') {
    return { type: entry.transport, url: entry.url ?? '' }
  }
  return {
    command: entry.command ?? '',
    ...(entry.args?.length ? { args: entry.args } : {}),
    ...(entry.env && Object.keys(entry.env).length ? { env: entry.env } : {})
  }
}

function writeActive(cwd: string, map: ServerMap): void {
  const path = activePath(cwd)
  if (Object.keys(map).length === 0) {
    // Don't leave an empty .mcp.json behind — its absence is meaningful to
    // anyone reading the project.
    if (existsSync(path)) rmSync(path)
    return
  }
  writeFileAtomicSync(path, `${JSON.stringify({ mcpServers: map }, null, 2)}\n`)
}

function writeParked(cwd: string, map: ServerMap): void {
  const path = parkedPath(cwd)
  if (Object.keys(map).length === 0) {
    if (existsSync(path)) rmSync(path)
    return
  }
  mkdirSync(join(cwd, '.claude'), { recursive: true })
  writeFileAtomicSync(path, `${JSON.stringify({ servers: map }, null, 2)}\n`)
}

export const mcpServers = {
  list(cwd: string): { servers: McpServerEntry[]; path: string } {
    const active = readMap(activePath(cwd), 'mcpServers')
    const parked = readMap(parkedPath(cwd), 'servers')
    const servers = [
      ...Object.entries(active).map(([n, r]) => toEntry(n, r, true)),
      ...Object.entries(parked).map(([n, r]) => toEntry(n, r, false))
    ].sort((a, b) => a.name.localeCompare(b.name))
    return { servers, path: activePath(cwd) }
  },

  /** Add or update. `previousName` renames, keeping the rest of the entry. */
  save(
    cwd: string,
    entry: McpServerEntry,
    previousName?: string
  ): { ok: true } | { error: string } {
    const name = entry.name.trim()
    if (!name) return { error: 'Give the server a name' }
    if (entry.transport === 'stdio' && !entry.command?.trim()) {
      return { error: 'A stdio server needs a command' }
    }
    if (entry.transport !== 'stdio' && !entry.url?.trim()) {
      return { error: `A ${entry.transport} server needs a URL` }
    }

    const active = readMap(activePath(cwd), 'mcpServers')
    const parked = readMap(parkedPath(cwd), 'servers')

    // Adding a name that already exists would silently replace someone else's
    // server; renaming onto one would too.
    const taken = name in active || name in parked
    if (taken && name !== previousName) {
      return { error: `A server named "${name}" already exists` }
    }
    if (previousName && previousName !== name) {
      delete active[previousName]
      delete parked[previousName]
    }

    delete active[name]
    delete parked[name]
    if (entry.enabled) active[name] = toRaw(entry)
    else parked[name] = toRaw(entry)

    try {
      writeActive(cwd, active)
      writeParked(cwd, parked)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  remove(cwd: string, name: string): { ok: true } | { error: string } {
    const active = readMap(activePath(cwd), 'mcpServers')
    const parked = readMap(parkedPath(cwd), 'servers')
    delete active[name]
    delete parked[name]
    try {
      writeActive(cwd, active)
      writeParked(cwd, parked)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  setEnabled(cwd: string, name: string, enabled: boolean): { ok: true } | { error: string } {
    const entry = this.list(cwd).servers.find((s) => s.name === name)
    if (!entry) return { error: 'Server not found' }
    return this.save(cwd, { ...entry, enabled }, name)
  },

  /** A real handshake rather than a "does the binary exist" guess: speak MCP
   *  over stdio and report what the server says about itself. */
  check(cwd: string, name: string): Promise<McpCheckResult> {
    const entry = this.list(cwd).servers.find((s) => s.name === name)
    if (!entry) return Promise.resolve({ ok: false, detail: 'Server not found' })
    if (entry.transport !== 'stdio') {
      return Promise.resolve({
        ok: false,
        detail: 'Only stdio servers can be checked from here yet'
      })
    }
    return handshake(cwd, entry)
  }
}

const PROTOCOL_VERSION = '2024-11-05'
const HANDSHAKE_TIMEOUT_MS = 10_000

/** Last couple of stderr lines — where a failing server actually says why. */
function tail(stderr: string): string {
  return stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)
}

function handshake(cwd: string, entry: McpServerEntry): Promise<McpCheckResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(entry.command ?? '', entry.args ?? [], {
        cwd,
        env: { ...process.env, ...entry.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // npx/uvx arrive as .cmd shims on Windows, which CreateProcess won't
        // run directly.
        shell: process.platform === 'win32'
      })
    } catch (err) {
      resolve({ ok: false, detail: err instanceof Error ? err.message : String(err) })
      return
    }

    let settled = false
    let buffer = ''
    let stderr = ''

    const done = (result: McpCheckResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve(result)
    }

    const timer = setTimeout(
      () => done({ ok: false, detail: tail(stderr) || 'No response within 10s' }),
      HANDSHAKE_TIMEOUT_MS
    )

    child.on('error', (err) => done({ ok: false, detail: err.message.replace(/^spawn /, '') }))
    child.on('exit', (code) =>
      done({ ok: false, detail: tail(stderr) || `Exited with code ${code}` })
    )
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString()
    })
    child.stdout?.on('data', (b: Buffer) => {
      buffer += b.toString()
      // MCP stdio frames are newline-delimited JSON. Ours is the one carrying
      // id 1; servers are free to emit notifications before it.
      for (const line of buffer.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('{')) continue
        let msg: {
          id?: number
          result?: { serverInfo?: { name?: string; version?: string } }
          error?: { message?: string }
        }
        try {
          msg = JSON.parse(trimmed)
        } catch {
          continue // partial frame — wait for the rest
        }
        if (msg.id !== 1) continue
        if (msg.error) {
          done({ ok: false, detail: msg.error.message ?? 'Server rejected initialize' })
          return
        }
        const info = msg.result?.serverInfo
        done({
          ok: true,
          detail: info?.name
            ? `Responded as ${info.name}${info.version ? ` ${info.version}` : ''}`
            : 'Responded to initialize'
        })
        return
      }
    })

    child.stdin?.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'seashell', version: '0.2.0' }
        }
      })}\n`
    )
  })
}
