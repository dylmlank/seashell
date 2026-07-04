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
  /** base64 of DPAPI-encrypted custom-endpoint API key */
  customKey?: string
}

const memory: { oauthToken: string | null; openrouterKey: string | null; customKey: string | null } = {
  oauthToken: null,
  openrouterKey: null,
  customKey: null
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

// macOS Keychain / Linux libsecret: the OS keyring holds the value itself;
// secrets.json just records the KEYRING marker so we know to look there.
const KEYRING = 'os-keyring'

function keyringSave(field: string, value: string): boolean {
  if (process.platform === 'darwin') {
    const r = spawnSync(
      'security',
      ['add-generic-password', '-U', '-a', 'seashell', '-s', `seashell.${field}`, '-w', value],
      { timeout: 15000 }
    )
    return r.status === 0
  }
  const r = spawnSync(
    'secret-tool',
    ['store', '--label=Seashell', 'service', 'seashell', 'field', field],
    { input: value, encoding: 'utf8', timeout: 15000 }
  )
  return r.status === 0
}

function keyringRead(field: string): string | null {
  const r =
    process.platform === 'darwin'
      ? spawnSync(
          'security',
          ['find-generic-password', '-a', 'seashell', '-s', `seashell.${field}`, '-w'],
          { encoding: 'utf8', timeout: 15000 }
        )
      : spawnSync('secret-tool', ['lookup', 'service', 'seashell', 'field', field], {
          encoding: 'utf8',
          timeout: 15000
        })
  if (r.status !== 0) return null
  const out = r.stdout.replace(/\n$/, '')
  return out || null
}

function keyringClear(field: string): void {
  if (process.platform === 'darwin') {
    spawnSync('security', ['delete-generic-password', '-a', 'seashell', '-s', `seashell.${field}`], {
      timeout: 15000
    })
  } else {
    spawnSync('secret-tool', ['clear', 'service', 'seashell', 'field', field], { timeout: 15000 })
  }
}

function encrypt(field: string, plain: string): string | null {
  if (process.platform === 'win32') {
    return dpapi('Protect', Buffer.from(plain, 'utf8').toString('base64'))
  }
  return keyringSave(field, plain) ? KEYRING : null
}

function decrypt(field: string, stored: string | undefined): string | null {
  if (!stored) return null
  if (stored === KEYRING) return keyringRead(field)
  if (process.platform !== 'win32') return null // DPAPI blob on the wrong OS
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
  const blob = encrypt(field, value)
  if (!blob) return false
  const data = readSecrets()
  data[field] = blob
  writeFileSync(file(), JSON.stringify(data))
  return true
}

function clear(field: keyof SecretsFile): void {
  memory[field] = null
  if (process.platform !== 'win32') keyringClear(field)
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
    return (memory.oauthToken ??= decrypt('oauthToken', readSecrets().oauthToken))
  },
  saveToken(token: string): boolean {
    return save('oauthToken', token)
  },
  clearToken(): void {
    clear('oauthToken')
  },

  getOpenRouterKey(): string | null {
    return (memory.openrouterKey ??= decrypt('openrouterKey', readSecrets().openrouterKey))
  },
  saveOpenRouterKey(key: string): boolean {
    return save('openrouterKey', key)
  },
  clearOpenRouterKey(): void {
    clear('openrouterKey')
  },

  getCustomKey(): string | null {
    return (memory.customKey ??= decrypt('customKey', readSecrets().customKey))
  },
  saveCustomKey(key: string): boolean {
    return save('customKey', key)
  },
  clearCustomKey(): void {
    clear('customKey')
  }
}
