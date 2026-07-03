import { readdir } from 'fs/promises'
import { join } from 'path'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  'target',
  'coverage'
])
const MAX_FILES = 5000
const MAX_DEPTH = 8

/** Relative paths of every project file, for the Ctrl+P quick-open list. */
export async function listProjectFiles(root: string): Promise<string[]> {
  const files: string[] = []

  async function walk(rel: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return
    let dirents
    try {
      dirents = await readdir(join(root, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const d of dirents) {
      if (files.length >= MAX_FILES) return
      const childRel = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) await walk(childRel, depth + 1)
      } else {
        files.push(childRel)
      }
    }
  }

  await walk('', 0)
  return files
}
