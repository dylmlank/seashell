import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join, relative, sep } from 'path'
import type { UserCommand } from '../shared/types'

/** Project commands live beside the code; user commands are global. Claude Code
 *  reads both these folders, so anything authored here also works in the CLI. */
function commandsDir(cwd: string, scope: 'project' | 'user'): string {
  return scope === 'project'
    ? join(cwd, '.claude', 'commands')
    : join(homedir(), '.claude', 'commands')
}

/** A command name maps 1:1 to a file path; subfolders become `ns:name`. */
const safeName = (name: string): boolean =>
  !!name && !name.includes('..') && !name.startsWith('/') && !name.startsWith('\\')

function nameToFile(dir: string, name: string): string {
  // "git:commit" → <dir>/git/commit.md — mirrors Claude Code's namespacing.
  return join(dir, ...name.split(':')) + '.md'
}

/** Pull `description` / `argument-hint` out of a leading YAML frontmatter block
 *  (only the two keys we surface) and return the remaining prompt body. */
function parse(raw: string): { description?: string; argumentHint?: string; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { body: raw.trim() }
  const out: { description?: string; argumentHint?: string; body: string } = { body: m[2].trim() }
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/)
    if (!kv) continue
    const val = kv[2].replace(/^["']|["']$/g, '').trim()
    if (kv[1] === 'description') out.description = val
    else if (kv[1] === 'argument-hint') out.argumentHint = val
  }
  return out
}

/** Recursively collect `*.md` command files under a scope's folder. */
async function walk(dir: string, scope: 'project' | 'user'): Promise<UserCommand[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true })
  } catch {
    return [] // no commands folder for this scope yet
  }
  const out: UserCommand[] = []
  for (const e of entries) {
    if (e.isDirectory() || !e.name.endsWith('.md')) continue
    const full = join(e.parentPath ?? dir, e.name)
    const name = relative(dir, full).replace(/\.md$/, '').split(sep).join(':')
    try {
      const parsed = parse(await readFile(full, 'utf8'))
      out.push({ name, scope, ...parsed })
    } catch {
      /* skip unreadable file */
    }
  }
  return out
}

export const userCommands = {
  /** Project commands win over same-named user commands, matching Claude Code. */
  async list(cwd: string): Promise<{ commands: UserCommand[] }> {
    const [project, user] = await Promise.all([
      walk(commandsDir(cwd, 'project'), 'project'),
      walk(commandsDir(cwd, 'user'), 'user')
    ])
    const seen = new Set(project.map((c) => c.name))
    const commands = [...project, ...user.filter((c) => !seen.has(c.name))].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    return { commands }
  },

  async save(
    cwd: string,
    scope: 'project' | 'user',
    name: string,
    description: string,
    argumentHint: string,
    body: string
  ): Promise<{ ok: true } | { error: string }> {
    if (!safeName(name)) return { error: 'Bad command name' }
    const file = nameToFile(commandsDir(cwd, scope), name)
    const fm: string[] = []
    if (description.trim()) fm.push(`description: ${description.trim()}`)
    if (argumentHint.trim()) fm.push(`argument-hint: ${argumentHint.trim()}`)
    const content = (fm.length ? `---\n${fm.join('\n')}\n---\n\n` : '') + body.trim() + '\n'
    try {
      await mkdir(join(file, '..'), { recursive: true })
      await writeFile(file, content, 'utf8')
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async remove(
    cwd: string,
    scope: 'project' | 'user',
    name: string
  ): Promise<{ ok: true } | { error: string }> {
    if (!safeName(name)) return { error: 'Bad command name' }
    try {
      await rm(nameToFile(commandsDir(cwd, scope), name))
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
}
