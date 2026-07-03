import { app } from 'electron'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

export interface DesktopMcpServer {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** One entry per connector Claude Desktop has, importable or not — for the UI. */
export interface DesktopMcpStatus {
  name: string
  source: 'config' | 'extension'
  imported: boolean
  note?: string
}

interface DesktopConfig {
  mcpServers?: Record<
    string,
    { command?: string; args?: string[]; env?: Record<string, string> }
  >
}

interface ExtensionManifest {
  name?: string
  display_name?: string
  server?: {
    mcp_config?: { command?: string; args?: string[]; env?: Record<string, string> }
  }
  user_config?: Record<string, { required?: boolean; default?: unknown }>
}

const claudeDir = (): string => join(app.getPath('appData'), 'Claude')

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** Fill ${__dirname} and ${user_config.*}; returns null when a value is missing. */
function substitute(
  value: string,
  dir: string,
  userConfig: Record<string, unknown>
): string | null {
  let missing = false
  const result = value
    .replaceAll('${__dirname}', dir)
    .replace(/\$\{user_config\.([^}]+)\}/g, (_, key: string) => {
      const v = userConfig[key]
      if (v === undefined || v === null || v === '') {
        missing = true
        return ''
      }
      return Array.isArray(v) ? v.join(',') : String(v)
    })
  return missing ? null : result
}

function loadConfigServers(statuses: DesktopMcpStatus[]): Record<string, DesktopMcpServer> {
  const result: Record<string, DesktopMcpServer> = {}
  const config = readJson<DesktopConfig>(join(claudeDir(), 'claude_desktop_config.json'))
  for (const [name, server] of Object.entries(config?.mcpServers ?? {})) {
    if (!server?.command) {
      statuses.push({ name, source: 'config', imported: false, note: 'not a local server' })
      continue
    }
    result[name] = {
      type: 'stdio',
      command: server.command,
      ...(server.args ? { args: server.args } : {}),
      ...(server.env ? { env: server.env } : {})
    }
    statuses.push({ name, source: 'config', imported: true })
  }
  return result
}

function loadExtensionServers(statuses: DesktopMcpStatus[]): Record<string, DesktopMcpServer> {
  const result: Record<string, DesktopMcpServer> = {}
  const extRoot = join(claudeDir(), 'Claude Extensions')
  const settingsRoot = join(claudeDir(), 'Claude Extensions Settings')
  if (!existsSync(extRoot)) return result

  for (const id of readdirSync(extRoot)) {
    const dir = join(extRoot, id)
    const manifest = readJson<ExtensionManifest>(join(dir, 'manifest.json'))
    if (!manifest) continue
    const name = manifest.display_name || manifest.name || id
    const push = (imported: boolean, note?: string): void => {
      statuses.push({ name, source: 'extension', imported, note })
    }

    const settings = readJson<{ isEnabled?: boolean; userConfig?: Record<string, unknown> }>(
      join(settingsRoot, `${id}.json`)
    )
    if (settings?.isEnabled === false) {
      push(false, 'disabled in Claude Desktop')
      continue
    }
    const mcp = manifest.server?.mcp_config
    if (!mcp?.command) {
      push(false, 'no runnable server')
      continue
    }

    // Values the user configured in Claude Desktop, falling back to manifest defaults.
    const userConfig: Record<string, unknown> = {}
    for (const [key, spec] of Object.entries(manifest.user_config ?? {})) {
      const v = settings?.userConfig?.[key] ?? spec.default
      if (v !== undefined && !(Array.isArray(v) && v.length === 0)) userConfig[key] = v
    }

    const args: string[] = []
    let unresolved = false
    for (const raw of mcp.args ?? []) {
      const sub = substitute(raw, dir, userConfig)
      if (sub === null) unresolved = true
      else args.push(sub)
    }
    const env: Record<string, string> = {}
    for (const [k, raw] of Object.entries(mcp.env ?? {})) {
      const sub = substitute(raw, dir, userConfig)
      if (sub !== null) env[k] = sub
    }
    const requiredMissing = Object.entries(manifest.user_config ?? {}).some(
      ([key, spec]) => spec.required && userConfig[key] === undefined
    )
    if (unresolved && requiredMissing) {
      push(false, 'needs configuration in Claude Desktop')
      continue
    }

    // No cwd field on stdio servers — anchor `uv run` to the extension folder.
    if (mcp.command === 'uv' && args[0] === 'run' && !args.includes('--directory')) {
      args.splice(1, 0, '--directory', dir)
    }

    result[name] = {
      type: 'stdio',
      command: mcp.command,
      ...(args.length ? { args } : {}),
      ...(Object.keys(env).length ? { env } : {})
    }
    push(true)
  }
  return result
}

/**
 * Claude Desktop keeps connectors in two places its config UI hides: the
 * claude_desktop_config.json mcpServers block, and installed extensions
 * (Claude Extensions/<id>/manifest.json). Import both so shell sessions get
 * the same connectors. Config-file servers win on name collisions.
 */
export function loadDesktopMcpServers(): Record<string, DesktopMcpServer> {
  const statuses: DesktopMcpStatus[] = []
  return { ...loadExtensionServers(statuses), ...loadConfigServers(statuses) }
}

/** Import report for the UI — which Desktop connectors sync and which can't. */
export function listDesktopMcp(): DesktopMcpStatus[] {
  const statuses: DesktopMcpStatus[] = []
  loadExtensionServers(statuses)
  loadConfigServers(statuses)
  return statuses
}
