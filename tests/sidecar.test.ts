/// <reference types="bun-types" />
// WS-bridge tests against a real sidecar with an isolated data profile.
// Token-free: no sessions are created, nothing talks to Anthropic.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SECRET = 'test-secret'
let proc: ReturnType<typeof Bun.spawn>
let port = 0
let userData = ''

async function connect(secret: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?s=${secret}`)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error('connect failed'))
  })
}

let ws: WebSocket
let nextId = 1
const pending = new Map<number, (msg: { result?: unknown; error?: string }) => void>()

function invoke(channel: string, arg?: unknown): Promise<{ result?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, channel, arg }))
  })
}

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'claude-shell-test-'))
  proc = Bun.spawn({
    cmd: ['bun', 'run', join(import.meta.dir, '..', 'src', 'sidecar', 'index.ts')],
    env: { ...process.env, SIDECAR_SECRET: SECRET, CLAUDE_SHELL_USER_DATA: userData },
    stdout: 'pipe',
    stderr: 'inherit'
  })
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (port === 0) {
    const { value, done } = await reader.read()
    if (done) throw new Error('sidecar exited before reporting a port')
    buffer += decoder.decode(value)
    const m = buffer.match(/SIDECAR_PORT=(\d+)/)
    if (m) port = Number(m[1])
  }
  reader.releaseLock()

  ws = await connect(SECRET)
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as { id?: number; event?: string }
    if (msg.id !== undefined) {
      pending.get(msg.id)?.(msg as { result?: unknown; error?: string })
      pending.delete(msg.id)
    }
  }
}, 30000)

afterAll(() => {
  ws?.close()
  proc?.kill()
  rmSync(userData, { recursive: true, force: true })
})

test('rejects a wrong secret', async () => {
  await expect(connect('WRONG')).rejects.toThrow()
})

test('settings:get returns defaults in a fresh profile', async () => {
  const res = await invoke('settings:get')
  const settings = res.result as { compactThreshold: number; retroOnlyAfterEdits: boolean }
  expect(settings.compactThreshold).toBe(60000)
  expect(settings.retroOnlyAfterEdits).toBe(true)
})

test('settings:set round-trips', async () => {
  const res = await invoke('settings:set', { compactThreshold: 100000 })
  expect((res.result as { compactThreshold: number }).compactThreshold).toBe(100000)
})

test('history:search returns hits array', async () => {
  const res = await invoke('history:search', { query: 'zz-no-such-string-zz' })
  expect(Array.isArray(res.result)).toBe(true)
})

test('providers:desktopMcp reports connector statuses', async () => {
  const res = await invoke('providers:desktopMcp')
  const list = res.result as { name: string; imported: boolean }[]
  expect(Array.isArray(list)).toBe(true)
})

test('unknown channel errors instead of hanging', async () => {
  const res = await invoke('nope:nope')
  expect(res.error).toContain('Unknown channel')
})

test('ports:list returns listeners', async () => {
  const res = await invoke('ports:list')
  expect(Array.isArray(res.result)).toBe(true)
})
