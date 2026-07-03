import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { BranchInfo, ChangedFile } from '../shared/types'

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message))
        else resolve(stdout)
      }
    )
  })
}

export const changes = {
  async list(cwd: string): Promise<{ files: ChangedFile[] } | { error: string }> {
    try {
      const out = await git(cwd, ['status', '--porcelain'])
      const files = out
        .split('\n')
        .filter(Boolean)
        .map((line) => ({
          status: line.slice(0, 2).trim(),
          path: line.slice(3).replace(/^"|"$/g, '')
        }))
      return { files }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async diff(
    cwd: string,
    path: string
  ): Promise<{ oldText: string; newText: string } | { error: string }> {
    try {
      let oldText = ''
      try {
        oldText = await git(cwd, ['show', `HEAD:${path.replace(/\\/g, '/')}`])
      } catch {
        oldText = '' // new/untracked file
      }
      let newText = ''
      try {
        newText = await readFile(join(cwd, path), 'utf8')
      } catch {
        newText = '' // deleted file
      }
      return { oldText, newText }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async revert(cwd: string, path: string): Promise<{ ok: true } | { error: string }> {
    try {
      // Tracked changes → restore from HEAD; untracked → delete.
      const status = await git(cwd, ['status', '--porcelain', '--', path])
      if (status.startsWith('??')) {
        await git(cwd, ['clean', '-f', '--', path])
      } else {
        await git(cwd, ['checkout', 'HEAD', '--', path])
      }
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async branches(cwd: string): Promise<BranchInfo | { error: string }> {
    try {
      const current = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      const out = await git(cwd, ['branch', '--list', '--format=%(refname:short)'])
      return { current, branches: out.split('\n').filter(Boolean) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async checkout(cwd: string, branch: string): Promise<{ ok: true } | { error: string }> {
    try {
      await git(cwd, ['checkout', branch])
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  async commit(
    cwd: string,
    message: string,
    files: string[]
  ): Promise<{ ok: true } | { error: string }> {
    try {
      if (!message.trim()) return { error: 'Commit message is empty' }
      if (files.length === 0) return { error: 'No files selected' }
      await git(cwd, ['add', '--', ...files])
      await git(cwd, ['commit', '-m', message])
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
}
