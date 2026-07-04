import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/** Per-OS config root — also where Claude Desktop keeps its config. */
export function appDataDir(): string {
  if (process.platform === 'win32')
    return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
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
