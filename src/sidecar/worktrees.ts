import { execFile } from 'child_process'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'

// Worktree sessions: risky work runs on its own branch in a sibling folder;
// the user merges back (and the worktree disappears) only if they like it.

const run = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], { windowsHide: true })
  return stdout.trim()
}

export const worktrees = {
  /** Create seashell/wt-* branch + sibling worktree folder; returns its path. */
  async create(cwd: string): Promise<{ path: string; branch: string } | { error: string }> {
    try {
      const root = await git(cwd, 'rev-parse', '--show-toplevel')
      const name = `wt-${Date.now().toString(36)}`
      const branch = `seashell/${name}`
      const path = join(dirname(root), `${basename(root)}-${name}`)
      await git(root, 'worktree', 'add', '-b', branch, path)
      return { path, branch }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  /** Commit anything pending in the worktree, merge its branch into the main
   *  checkout's current branch, then remove worktree + branch. */
  async merge(worktreeCwd: string): Promise<{ ok: true } | { error: string }> {
    try {
      const branch = await git(worktreeCwd, 'rev-parse', '--abbrev-ref', 'HEAD')
      const commonDir = await git(worktreeCwd, 'rev-parse', '--git-common-dir')
      const mainRoot = dirname(commonDir.replace(/\//g, '\\'))
      if (await git(worktreeCwd, 'status', '--porcelain')) {
        await git(worktreeCwd, 'add', '-A')
        await git(worktreeCwd, 'commit', '-m', 'Seashell worktree changes')
      }
      await git(mainRoot, 'merge', '--no-ff', branch, '-m', `Merge ${branch}`)
      await git(mainRoot, 'worktree', 'remove', worktreeCwd, '--force')
      await git(mainRoot, 'branch', '-d', branch)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
}
