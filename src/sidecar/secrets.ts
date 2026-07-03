import { spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { userDataDir } from './paths'

const file = (): string => join(userDataDir(), 'secrets.json')

interface SecretsFile {
  /** base64 of DPAPI-encrypted CLAUDE_CODE_OAUTH_TOKEN */
  oauthToken?: string
  /** base64 of DPAPI-encrypted OpenRouter API key */
  openrouterKey?: string
}

const memory: { oauthToken: string | null; openrouterKey: string | null } = {
  oauthToken: null,
  openrouterKey: null
}

// DPAPI (CurrentUser) via .NET ProtectedData — the same Windows API Electron's
// safeStorage wrapped, so blobs written by the old Electron build still decrypt.
// Values travel over stdin/stdout, never the command line.
function dpapi(direction: 'Protect' | 'Unprotect', b64In: string): string | null {
  const script =
    'Add-Type -AssemblyName System.Security; ' +
    '$in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ' +
    `$out = [Security.Cryptography.ProtectedData]::${direction}($in, $null, 'CurrentUser'); ` +
    '[Console]::Out.Write([Convert]::ToBase64String($out))'
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: b64In,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000
  })
  if (result.status !== 0 || !result.stdout.trim()) return null
  return result.stdout.trim()
}

function encrypt(plain: string): string | null {
  return dpapi('Protect', Buffer.from(plain, 'utf8').toString('base64'))
}

function decrypt(stored: string | undefined): string | null {
  if (!stored) return null
  const b64 = dpapi('Unprotect', stored)
  return b64 ? Buffer.from(b64, 'base64').toString('utf8') : null
}

function readSecrets(): SecretsFile {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as SecretsFile
  } catch {
    return {}
  }
}

/** Returns false when encryption is unavailable (value kept in memory only). */
function save(field: keyof SecretsFile, value: string): boolean {
  memory[field] = value
  const blob = encrypt(value)
  if (!blob) return false
  const data = readSecrets()
  data[field] = blob
  writeFileSync(file(), JSON.stringify(data))
  return true
}

function clear(field: keyof SecretsFile): void {
  memory[field] = null
  const data = readSecrets()
  delete data[field]
  if (Object.keys(data).length === 0) {
    if (existsSync(file())) rmSync(file())
  } else {
    writeFileSync(file(), JSON.stringify(data))
  }
}

export const secrets = {
  getToken(): string | null {
    return (memory.oauthToken ??= decrypt(readSecrets().oauthToken))
  },
  saveToken(token: string): boolean {
    return save('oauthToken', token)
  },
  clearToken(): void {
    clear('oauthToken')
  },

  getOpenRouterKey(): string | null {
    return (memory.openrouterKey ??= decrypt(readSecrets().openrouterKey))
  },
  saveOpenRouterKey(key: string): boolean {
    return save('openrouterKey', key)
  },
  clearOpenRouterKey(): void {
    clear('openrouterKey')
  }
}
