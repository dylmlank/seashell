import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/** %APPDATA% (Roaming) — also where Claude Desktop keeps its config. */
export function appDataDir(): string {
  return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
}

let ensured = false

/** App data dir — same location the Electron build used, so settings,
 *  usage, and secrets carry straight over. Overridable for test profiles. */
export function userDataDir(): string {
  const dir = process.env.CLAUDE_SHELL_USER_DATA ?? join(appDataDir(), 'claude-shell')
  if (!ensured) {
    ensured = true
    mkdirSync(dir, { recursive: true })
  }
  return dir
}
