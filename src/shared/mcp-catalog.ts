import type { McpServerEntry } from './types'

/** A server you can add without knowing its invocation by heart. */
export interface CatalogEntry {
  /** Suggested name — also the `.mcp.json` key, so it must be a valid one. */
  id: string
  title: string
  blurb: string
  /** Where to read what it does and what it needs. */
  docs: string
  command: string
  args: string[]
  /** Env vars the server needs, with what each is for. Values are the user's
   *  to supply — the catalog never ships a credential or guesses one. */
  env?: { key: string; hint: string }[]
  /** Args the user must edit before it will work (a path, a database URL). */
  needsEditing?: boolean
}

/**
 * A starting set of well-known MCP servers.
 *
 * Deliberately small and static rather than fetched from a registry: the app
 * would otherwise depend on a network call to show a list, and a remote
 * catalog is a channel for someone else to suggest commands that run on your
 * machine. Everything here is a published package under a known namespace,
 * and nothing is installed until you press Add — at which point it lands in
 * the normal editor so you can read the command before saving it.
 *
 * These will drift as packages move. That is what the Test button is for: it
 * speaks a real MCP handshake, so a stale entry fails loudly at the moment you
 * add it rather than silently later.
 */
export const MCP_CATALOG: CatalogEntry[] = [
  {
    id: 'filesystem',
    title: 'Filesystem',
    blurb: 'Read and write files in directories you nominate.',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '<path-to-allow>'],
    needsEditing: true
  },
  {
    id: 'memory',
    title: 'Memory',
    blurb: 'A knowledge graph Claude can write to and recall across sessions.',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory']
  },
  {
    id: 'sequential-thinking',
    title: 'Sequential Thinking',
    blurb: 'Structured step-by-step reasoning for problems that need unpicking.',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
  },
  {
    id: 'git',
    title: 'Git',
    blurb: 'Read history, diffs and blame from a local repository.',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '<path-to-repo>'],
    needsEditing: true
  },
  {
    id: 'fetch',
    title: 'Fetch',
    blurb: 'Retrieve a URL and convert it to markdown for reading.',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    command: 'uvx',
    args: ['mcp-server-fetch']
  },
  {
    id: 'time',
    title: 'Time',
    blurb: 'Current time and timezone conversion.',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    command: 'uvx',
    args: ['mcp-server-time']
  },
  {
    id: 'everything',
    title: 'Everything (reference)',
    blurb: 'The reference server exercising every MCP feature — useful for testing.',
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything']
  }
]

/** Turn a catalog entry into the editable server the manager already knows.
 *  Env keys are seeded blank on purpose: a placeholder value looks configured
 *  and fails at runtime, whereas an empty one is visibly yours to fill in. */
export function catalogToEntry(item: CatalogEntry): McpServerEntry {
  return {
    name: item.id,
    enabled: true,
    transport: 'stdio',
    command: item.command,
    args: [...item.args],
    ...(item.env?.length
      ? { env: Object.fromEntries(item.env.map((e) => [e.key, ''])) }
      : {})
  }
}

/** Catalog entries not already configured, so the browser doesn't offer
 *  something that's sitting in the list right above it. */
export function availableCatalog(configured: McpServerEntry[]): CatalogEntry[] {
  const taken = new Set(configured.map((s) => s.name.toLowerCase()))
  return MCP_CATALOG.filter((c) => !taken.has(c.id.toLowerCase()))
}
