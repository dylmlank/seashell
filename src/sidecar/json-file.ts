import { readFileSync } from 'fs'

/** Read and parse a JSON file, tolerating a UTF-8 byte-order mark. Windows
 *  tools (Notepad, PowerShell's Set-Content) prepend one and JSON.parse throws
 *  on it — which silently reverted every saved setting to defaults. */
export function readJsonFile<T>(path: string): T {
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) as T
}
