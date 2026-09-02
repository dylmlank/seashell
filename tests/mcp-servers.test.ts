/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { mcpServers } from '../src/sidecar/mcp-servers'

let cwd = ''

const active = (): string => join(cwd, '.mcp.json')
const parked = (): string => join(cwd, '.claude', 'mcp-disabled.json')
const readActive = (): Record<string, unknown> =>
  JSON.parse(readFileSync(active(), 'utf8')).mcpServers

const stdio = (name: string, command = 'npx'): Parameters<typeof mcpServers.save>[1] => ({
  name,
  enabled: true,
  transport: 'stdio',
  command,
  args: ['-y', 'some-server']
})

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'seashell-mcp-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

test('a project with no config lists nothing', () => {
  expect(mcpServers.list(cwd).servers).toEqual([])
})

test('saving writes the shape the Claude Code CLI reads', () => {
  mcpServers.save(cwd, stdio('files'))
  expect(readActive()).toEqual({ files: { command: 'npx', args: ['-y', 'some-server'] } })
})

test('an existing .mcp.json is read, whoever wrote it', () => {
  writeFileSync(active(), JSON.stringify({ mcpServers: { hand: { command: 'node' } } }))
  const { servers } = mcpServers.list(cwd)
  expect(servers).toHaveLength(1)
  expect(servers[0]).toMatchObject({ name: 'hand', command: 'node', enabled: true })
})

test('refuses to clobber a server that already exists', () => {
  mcpServers.save(cwd, stdio('files'))
  const result = mcpServers.save(cwd, stdio('files', 'other'))
  expect(result).toHaveProperty('error')
  expect(readActive().files).toMatchObject({ command: 'npx' })
})

test('editing in place is allowed', () => {
  mcpServers.save(cwd, stdio('files'))
  const result = mcpServers.save(cwd, { ...stdio('files', 'bunx') }, 'files')
  expect(result).toEqual({ ok: true })
  expect(readActive().files).toMatchObject({ command: 'bunx' })
})

test('renaming moves the entry rather than duplicating it', () => {
  mcpServers.save(cwd, stdio('old'))
  mcpServers.save(cwd, stdio('new'), 'old')
  expect(Object.keys(readActive())).toEqual(['new'])
})

test('disabling parks the server out of .mcp.json entirely', () => {
  mcpServers.save(cwd, stdio('files'))
  mcpServers.setEnabled(cwd, 'files', false)
  // The point of parking: the CLI must not launch it either.
  expect(existsSync(active())).toBe(false)
  expect(existsSync(parked())).toBe(true)
  expect(mcpServers.list(cwd).servers[0]).toMatchObject({ name: 'files', enabled: false })
})

test('re-enabling puts it back where the CLI looks', () => {
  mcpServers.save(cwd, stdio('files'))
  mcpServers.setEnabled(cwd, 'files', false)
  mcpServers.setEnabled(cwd, 'files', true)
  expect(readActive().files).toMatchObject({ command: 'npx' })
  expect(existsSync(parked())).toBe(false)
})

test('a disabled server keeps its settings while parked', () => {
  mcpServers.save(cwd, {
    name: 'files',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'x'],
    env: { TOKEN: 'abc' }
  })
  mcpServers.setEnabled(cwd, 'files', false)
  expect(mcpServers.list(cwd).servers[0]).toMatchObject({
    command: 'npx',
    args: ['-y', 'x'],
    env: { TOKEN: 'abc' }
  })
})

test('removing the last server deletes .mcp.json instead of leaving it empty', () => {
  mcpServers.save(cwd, stdio('files'))
  mcpServers.remove(cwd, 'files')
  expect(existsSync(active())).toBe(false)
})

test('removing one of several leaves the rest alone', () => {
  mcpServers.save(cwd, stdio('a'))
  mcpServers.save(cwd, stdio('b'))
  mcpServers.remove(cwd, 'a')
  expect(Object.keys(readActive())).toEqual(['b'])
})

test('http servers round-trip their url and type', () => {
  mcpServers.save(cwd, { name: 'remote', enabled: true, transport: 'sse', url: 'https://x/sse' })
  expect(readActive().remote).toEqual({ type: 'sse', url: 'https://x/sse' })
  expect(mcpServers.list(cwd).servers[0]).toMatchObject({ transport: 'sse', url: 'https://x/sse' })
})

test('rejects a stdio server with no command', () => {
  expect(mcpServers.save(cwd, { name: 'x', enabled: true, transport: 'stdio' })).toHaveProperty(
    'error'
  )
})

test('rejects a remote server with no url', () => {
  expect(mcpServers.save(cwd, { name: 'x', enabled: true, transport: 'http' })).toHaveProperty(
    'error'
  )
})

test('rejects a blank name', () => {
  expect(mcpServers.save(cwd, { ...stdio('   ') })).toHaveProperty('error')
})

test('a malformed .mcp.json reads as empty rather than throwing', () => {
  writeFileSync(active(), 'not json at all')
  expect(mcpServers.list(cwd).servers).toEqual([])
})

test('checking a command that does not exist reports why', async () => {
  mcpServers.save(cwd, stdio('broken', 'definitely-not-a-real-binary-xyz'))
  const result = await mcpServers.check(cwd, 'broken')
  expect(result.ok).toBe(false)
  expect(result.detail.length).toBeGreaterThan(0)
})

test('checking an unknown server says so', async () => {
  expect(await mcpServers.check(cwd, 'nope')).toMatchObject({ ok: false })
})
