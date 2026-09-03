/// <reference types="bun-types" />
import { expect, test } from 'bun:test'
import {
  availableCatalog,
  catalogToEntry,
  MCP_CATALOG,
  type CatalogEntry
} from '../src/shared/mcp-catalog'
import type { McpServerEntry } from '../src/shared/types'

const configured = (...names: string[]): McpServerEntry[] =>
  names.map((name) => ({ name, enabled: true, transport: 'stdio', command: 'x' }))

test('every id is usable as a .mcp.json key', () => {
  // The id becomes the object key and the display name; a space or a slash
  // there produces a config the CLI reads back differently than we wrote it.
  for (const item of MCP_CATALOG) {
    expect(item.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
  }
})

test('ids are unique', () => {
  const ids = MCP_CATALOG.map((c) => c.id)
  expect(new Set(ids).size).toBe(ids.length)
})

test('every entry can actually be launched and read about', () => {
  for (const item of MCP_CATALOG) {
    expect(item.command.length).toBeGreaterThan(0)
    expect(item.args.length).toBeGreaterThan(0)
    expect(item.docs).toStartWith('https://')
    expect(item.blurb.length).toBeGreaterThan(0)
  }
})

test('entries needing a path say so, and carry a placeholder to replace', () => {
  // Otherwise the user adds it, it fails, and nothing indicates why.
  for (const item of MCP_CATALOG) {
    const hasPlaceholder = item.args.some((a) => a.startsWith('<') && a.endsWith('>'))
    expect(hasPlaceholder).toBe(item.needsEditing === true)
  }
})

test('converting to a server entry produces something the manager accepts', () => {
  const entry = catalogToEntry(MCP_CATALOG[0])
  expect(entry).toMatchObject({ enabled: true, transport: 'stdio' })
  expect(entry.name).toBe(MCP_CATALOG[0].id)
  expect(entry.command).toBe(MCP_CATALOG[0].command)
})

test('conversion copies the args rather than aliasing the catalog', () => {
  // Editing a freshly added server must not rewrite the catalog for the rest
  // of the session.
  const item = MCP_CATALOG.find((c) => c.needsEditing) as CatalogEntry
  const entry = catalogToEntry(item)
  entry.args![0] = 'mutated'
  expect(item.args[0]).not.toBe('mutated')
})

test('env keys are seeded empty, never with a fake value', () => {
  const withEnv: CatalogEntry = {
    id: 'x',
    title: 'X',
    blurb: 'b',
    docs: 'https://e.com',
    command: 'npx',
    args: ['-y', 'p'],
    env: [{ key: 'API_TOKEN', hint: 'your token' }]
  }
  expect(catalogToEntry(withEnv).env).toEqual({ API_TOKEN: '' })
})

test('already-configured servers drop out of the browse list', () => {
  const available = availableCatalog(configured('memory'))
  expect(available.some((c) => c.id === 'memory')).toBe(false)
  expect(available.length).toBe(MCP_CATALOG.length - 1)
})

test('the match ignores case, since .mcp.json keys are free-form', () => {
  expect(availableCatalog(configured('MEMORY')).some((c) => c.id === 'memory')).toBe(false)
})

test('nothing configured means the whole catalog is on offer', () => {
  expect(availableCatalog([])).toHaveLength(MCP_CATALOG.length)
})
