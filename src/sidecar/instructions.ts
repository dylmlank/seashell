import { mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'

function pathFor(scope: 'project' | 'global', cwd?: string): string | null {
  if (scope === 'global') return join(homedir(), '.claude', 'CLAUDE.md')
  return cwd ? join(cwd, 'CLAUDE.md') : null
}

export const instructions = {
  async get(scope: 'project' | 'global', cwd?: string): Promise<{ content: string; path: string } | { error: string }> {
    const path = pathFor(scope, cwd)
    if (!path) return { error: 'No project folder for this session' }
    try {
      return { content: await readFile(path, 'utf8'), path }
    } catch {
      return { content: '', path } // not created yet — empty editor
    }
  },

  async set(scope: 'project' | 'global', content: string, cwd?: string): Promise<{ ok: true } | { error: string }> {
    const path = pathFor(scope, cwd)
    if (!path) return { error: 'No project folder for this session' }
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
}
