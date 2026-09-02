import { renameSync, rmSync, writeFileSync } from 'fs'

/** Write a file via temp + rename, so an interrupted write can never leave a
 *  truncated file behind. Every store under `userDataDir()` goes through this:
 *  a half-written secrets.json costs the user their stored token, and a
 *  half-written settings.json silently reverts every preference to defaults.
 *
 *  rename(2) is atomic within a filesystem, and Node's implementation replaces
 *  an existing destination on Windows too (MoveFileEx + REPLACE_EXISTING).
 */
export function writeFileAtomicSync(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, data, 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    try {
      rmSync(tmp, { force: true })
    } catch {
      // best effort — the original file is still intact either way
    }
    throw err
  }
}
