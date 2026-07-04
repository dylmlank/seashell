import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { SearchHit } from '../shared/types'

const projectsRoot = (): string => join(homedir(), '.claude', 'projects')

interface ParsedLine {
  role: 'user' | 'assistant'
  text: string
}

interface CacheEntry {
  mtimeMs: number
  cwd?: string
  texts: ParsedLine[]
}

// Transcript text extracted per file, keyed by path. Personal-scale corpus —
// a plain in-memory cache keeps repeat searches instant.
const cache = new Map<string, CacheEntry>()

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        return (block as { text?: string }).text ?? ''
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

async function parseFile(path: string, mtimeMs: number): Promise<CacheEntry> {
  const cached = cache.get(path)
  if (cached && cached.mtimeMs === mtimeMs) return cached

  const entry: CacheEntry = { mtimeMs, texts: [] }
  try {
    const raw = await readFile(path, 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line) as {
          type?: string
          isMeta?: boolean
          cwd?: string
          message?: { content?: unknown }
        }
        if (!entry.cwd && obj.cwd) entry.cwd = obj.cwd
        if (obj.isMeta) continue
        if (obj.type !== 'user' && obj.type !== 'assistant') continue
        const text = extractText(obj.message?.content)
        // Skip command wrappers and empty/tool-only messages.
        if (!text.trim() || text.startsWith('<')) continue
        entry.texts.push({ role: obj.type, text })
      } catch {
        // transcript format is internal — skip unparseable lines
      }
    }
  } catch {
    // unreadable file → empty entry
  }
  cache.set(path, entry)
  return entry
}

function snippetAround(text: string, index: number, needleLen: number): string {
  const start = Math.max(0, index - 60)
  const end = Math.min(text.length, index + needleLen + 60)
  const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()
  return (
    (start > 0 ? '…' : '') + clean(text.slice(start, end)) + (end < text.length ? '…' : '')
  )
}

export const transcriptSearch = {
  /** Case-insensitive full-text search across every session transcript. */
  async search(queryText: string, limit = 30): Promise<SearchHit[]> {
    const needle = queryText.trim().toLowerCase()
    if (needle.length < 2) return []

    const root = projectsRoot()
    let projectDirs: string[]
    try {
      projectDirs = (await readdir(root, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => join(root, d.name))
    } catch {
      return []
    }

    // Newest-first file list so hits surface recent sessions before old ones.
    const files: { path: string; sessionId: string; mtimeMs: number }[] = []
    for (const dir of projectDirs) {
      try {
        for (const f of await readdir(dir)) {
          if (!f.endsWith('.jsonl')) continue
          const path = join(dir, f)
          const st = await stat(path)
          files.push({ path, sessionId: f.slice(0, -6), mtimeMs: st.mtimeMs })
        }
      } catch {
        // skip unreadable project dir
      }
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs)

    const hits: SearchHit[] = []
    for (const file of files) {
      if (hits.length >= limit) break
      const entry = await parseFile(file.path, file.mtimeMs)
      for (const { role, text } of entry.texts) {
        const idx = text.toLowerCase().indexOf(needle)
        if (idx === -1) continue
        hits.push({
          sessionId: file.sessionId,
          cwd: entry.cwd,
          role,
          snippet: snippetAround(text, idx, needle.length),
          lastModified: file.mtimeMs
        })
        break // one hit per session is enough for the result list
      }
    }
    return hits
  },

  /** Render a session transcript as Markdown for export. */
  async exportMarkdown(sessionId: string): Promise<string | null> {
    const root = projectsRoot()
    let found: string | null = null
    try {
      for (const d of await readdir(root, { withFileTypes: true })) {
        if (!d.isDirectory()) continue
        const candidate = join(root, d.name, `${sessionId}.jsonl`)
        try {
          await stat(candidate)
          found = candidate
          break
        } catch {
          // not in this project dir
        }
      }
    } catch {
      return null
    }
    if (!found) return null

    const lines: string[] = []
    let cwd: string | undefined
    const raw = await readFile(found, 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line) as {
          type?: string
          isMeta?: boolean
          cwd?: string
          message?: { content?: unknown }
        }
        if (!cwd && obj.cwd) cwd = obj.cwd
        if (obj.isMeta) continue
        if (obj.type === 'user') {
          const text = extractText(obj.message?.content)
          if (text.trim() && !text.startsWith('<')) lines.push(`## You\n\n${text.trim()}`)
        } else if (obj.type === 'assistant') {
          const content = obj.message?.content
          const text = extractText(content)
          if (text.trim()) lines.push(`## Claude\n\n${text.trim()}`)
          if (Array.isArray(content)) {
            for (const block of content) {
              const b = block as { type?: string; name?: string; input?: Record<string, unknown> }
              if (b.type === 'tool_use' && b.name) {
                const hint =
                  (b.input?.command as string) ??
                  (b.input?.file_path as string) ??
                  (b.input?.pattern as string) ??
                  ''
                lines.push(`> 🔧 **${b.name}**${hint ? ` — \`${String(hint).slice(0, 120)}\`` : ''}`)
              }
            }
          }
        }
      } catch {
        // skip unparseable lines
      }
    }

    const header = [
      `# Claude session ${sessionId}`,
      '',
      `*Exported from Seashell on ${new Date().toLocaleString()}${cwd ? ` · project: \`${cwd}\`` : ''}*`,
      ''
    ].join('\n')
    return `${header}\n${lines.join('\n\n')}\n`
  }
}
