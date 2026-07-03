import { readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { MemoryFile } from '../shared/types'

/** Claude Code munges a project cwd into its ~/.claude/projects dir name. */
function mungeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function memoryDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', mungeCwd(cwd), 'memory')
}

const safeName = (name: string): boolean =>
  !!name && !name.includes('/') && !name.includes('\\') && !name.includes('..')

export const memoryFiles = {
  async list(cwd: string): Promise<{ dir: string; files: MemoryFile[] }> {
    const dir = memoryDir(cwd)
    try {
      const names = (await readdir(dir)).filter((n) => n.endsWith('.md'))
      const files: MemoryFile[] = []
      for (const name of names) {
        const st = await stat(join(dir, name))
        files.push({ name, size: st.size, modified: st.mtimeMs })
      }
      // MEMORY.md (the index) first, then most recently touched.
      files.sort((a, b) =>
        a.name === 'MEMORY.md' ? -1 : b.name === 'MEMORY.md' ? 1 : b.modified - a.modified
      )
      return { dir, files }
    } catch {
      return { dir, files: [] } // no memory yet for this project
    }
  },

  async read(cwd: string, name: string): Promise<{ content: string } | { error: string }> {
    if (!safeName(name)) return { error: 'Bad file name' }
    try {
      return { content: await readFile(join(memoryDir(cwd), name), 'utf8') }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async write(cwd: string, name: string, content: string): Promise<{ ok: true } | { error: string }> {
    if (!safeName(name)) return { error: 'Bad file name' }
    try {
      await writeFile(join(memoryDir(cwd), name), content, 'utf8')
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async remove(cwd: string, name: string): Promise<{ ok: true } | { error: string }> {
    if (!safeName(name)) return { error: 'Bad file name' }
    try {
      await rm(join(memoryDir(cwd), name))
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
}
