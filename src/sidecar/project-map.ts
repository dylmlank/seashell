import { readFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ProjectMap } from '../shared/types'
import { listProjectFiles } from './file-index'

// Static analysis for the Workflow tab: language mix, module dependency graph
// (from import statements), and external services (from URLs in code).
// Deterministic and local — no model calls.

const SOURCE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'py', 'cs', 'lua', 'go', 'java',
  'c', 'cpp', 'h', 'html', 'css', 'scss', 'vue', 'svelte', 'ps1', 'sh'
])

const LANG_INFO: Record<string, [string, string]> = {
  ts: ['#3178c6', 'TypeScript'],
  tsx: ['#3178c6', 'TypeScript'],
  js: ['#f1e05a', 'JavaScript'],
  jsx: ['#f1e05a', 'JavaScript'],
  mjs: ['#f1e05a', 'JavaScript'],
  cjs: ['#f1e05a', 'JavaScript'],
  rs: ['#dea584', 'Rust'],
  py: ['#3572a5', 'Python'],
  cs: ['#178600', 'C#'],
  lua: ['#000080', 'Lua'],
  go: ['#00add8', 'Go'],
  java: ['#b07219', 'Java'],
  c: ['#555555', 'C'],
  cpp: ['#f34b7d', 'C++'],
  h: ['#555555', 'C'],
  html: ['#e34c26', 'HTML'],
  css: ['#663399', 'CSS'],
  scss: ['#663399', 'CSS'],
  vue: ['#41b883', 'Vue'],
  svelte: ['#ff3e00', 'Svelte'],
  ps1: ['#012456', 'PowerShell'],
  sh: ['#89e051', 'Shell']
}

const MAX_FILES_READ = 400
const MAX_FILE_BYTES = 200_000

/** Which top-level module does a file belong to? src/foo/... → "src/foo". */
function moduleOf(rel: string): string {
  const parts = rel.split('/')
  if (parts.length === 1) return '(root)'
  if (parts[0] === 'src' && parts.length > 2) return `src/${parts[1]}`
  return parts[0]
}

function detectStack(cwd: string): string[] {
  const stack: string[] = []
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const known: [string, string][] = [
      ['react', 'React'],
      ['vue', 'Vue'],
      ['svelte', 'Svelte'],
      ['next', 'Next.js'],
      ['vite', 'Vite'],
      ['electron', 'Electron'],
      ['@tauri-apps/api', 'Tauri'],
      ['express', 'Express'],
      ['fastify', 'Fastify'],
      ['tailwindcss', 'Tailwind'],
      ['typescript', 'TypeScript'],
      ['zustand', 'zustand'],
      ['@anthropic-ai/claude-agent-sdk', 'Claude Agent SDK'],
      ['@anthropic-ai/sdk', 'Claude API']
    ]
    for (const [dep, label] of known) if (deps[dep]) stack.push(label)
  } catch {
    // no package.json
  }
  if (existsSync(join(cwd, 'Cargo.toml')) || existsSync(join(cwd, 'src-tauri', 'Cargo.toml')))
    stack.push('Rust')
  if (existsSync(join(cwd, 'requirements.txt')) || existsSync(join(cwd, 'pyproject.toml')))
    stack.push('Python')
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bunfig.toml'))) stack.push('Bun')
  if (existsSync(join(cwd, '.git'))) stack.push('git')
  return [...new Set(stack)]
}

/** Path aliases from tsconfig ("@shared/*" → "src/shared/*"), plus the common
 *  "@/" → "src/" convention as a fallback. */
function loadAliases(cwd: string): [string, string][] {
  const aliases: [string, string][] = []
  for (const name of ['tsconfig.json', 'tsconfig.web.json', 'tsconfig.base.json']) {
    try {
      const raw = readFileSync(join(cwd, name), 'utf8').replace(/\/\/[^\n"]*$/gm, '')
      const paths = (JSON.parse(raw) as {
        compilerOptions?: { paths?: Record<string, string[]> }
      }).compilerOptions?.paths
      for (const [key, targets] of Object.entries(paths ?? {})) {
        if (!targets[0]) continue
        aliases.push([key.replace(/\*$/, ''), targets[0].replace(/^\.\//, '').replace(/\*$/, '')])
      }
    } catch {
      // missing/unparseable tsconfig
    }
  }
  aliases.push(['@/', 'src/'])
  return aliases
}

/** Resolve a relative or aliased import to the module of its target file. */
function resolveImportModule(
  fromRel: string,
  spec: string,
  aliases: [string, string][]
): string | null {
  for (const [prefix, target] of aliases) {
    if (spec.startsWith(prefix)) return moduleOf(target + spec.slice(prefix.length))
  }
  if (!spec.startsWith('.')) return null // package import — not a project edge
  const fromDir = fromRel.split('/').slice(0, -1)
  const parts = [...fromDir]
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    else if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return moduleOf(parts.join('/'))
}

const IMPORT_RE =
  /(?:import\s[^'"]*from\s*|import\s*\(\s*|require\s*\(\s*|export\s[^'"]*from\s*)['"]([^'"]+)['"]/g
const URL_RE = /(https?|wss?):\/\/([a-zA-Z0-9.-]+(?::\d+)?)/g

export async function analyzeProject(cwd: string): Promise<ProjectMap> {
  const files = await listProjectFiles(cwd)
  const aliases = loadAliases(cwd)
  const langAgg = new Map<string, { color: string; lines: number; files: number }>()
  const moduleAgg = new Map<string, { files: number; lines: number }>()
  const edgeAgg = new Map<string, number>()
  const externalAgg = new Map<string, { kind: 'http' | 'ws'; count: number; files: Set<string> }>()
  let totalLines = 0
  let read = 0

  for (const rel of files) {
    const ext = rel.split('.').pop()?.toLowerCase() ?? ''
    if (!SOURCE_EXT.has(ext)) continue
    if (read >= MAX_FILES_READ) break
    read++

    let text: string
    try {
      const buf = await readFile(join(cwd, rel))
      if (buf.length > MAX_FILE_BYTES) continue
      text = buf.toString('utf8')
    } catch {
      continue
    }
    const lines = text.split('\n').length
    totalLines += lines

    const [color, langName] = LANG_INFO[ext] ?? ['#6b7280', ext]
    const lang = langAgg.get(langName) ?? { color, lines: 0, files: 0 }
    lang.lines += lines
    lang.files++
    langAgg.set(langName, lang)

    const mod = moduleOf(rel)
    const m = moduleAgg.get(mod) ?? { files: 0, lines: 0 }
    m.files++
    m.lines += lines
    moduleAgg.set(mod, m)

    for (const match of text.matchAll(IMPORT_RE)) {
      const target = resolveImportModule(rel, match[1], aliases)
      if (target && target !== mod) {
        const key = `${mod}→${target}`
        edgeAgg.set(key, (edgeAgg.get(key) ?? 0) + 1)
      }
    }

    for (const match of text.matchAll(URL_RE)) {
      const host = match[2]
      if (host === 'www.w3.org' || host === 'schema.tauri.app') continue // xmlns/schema noise
      const kind = match[1].startsWith('ws') ? 'ws' : 'http'
      const entry = externalAgg.get(host) ?? { kind, count: 0, files: new Set<string>() }
      entry.count++
      if (entry.files.size < 5) entry.files.add(rel)
      externalAgg.set(host, entry)
    }
  }

  return {
    stack: detectStack(cwd),
    languages: [...langAgg.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.lines - a.lines),
    modules: [...moduleAgg.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 12),
    edges: [...edgeAgg.entries()]
      .map(([key, count]) => {
        const [from, to] = key.split('→')
        return { from, to, count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 40),
    externals: [...externalAgg.entries()]
      .map(([host, v]) => ({ host, kind: v.kind, count: v.count, files: [...v.files] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    totalFiles: files.length,
    totalLines
  }
}
