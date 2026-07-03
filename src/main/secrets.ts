import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const file = (): string => join(app.getPath('userData'), 'secrets.json')

interface SecretsFile {
  /** base64 of safeStorage-encrypted CLAUDE_CODE_OAUTH_TOKEN */
  oauthToken?: string
  /** base64 of safeStorage-encrypted OpenRouter API key */
  openrouterKey?: string
}

const memory: { oauthToken: string | null; openrouterKey: string | null } = {
  oauthToken: null,
  openrouterKey: null
}

function readSecrets(): SecretsFile {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as SecretsFile
  } catch {
    return {}
  }
}

function decrypt(stored: string | undefined): string | null {
  if (!stored) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

/** Returns false when encryption is unavailable (value kept in memory only). */
function save(field: keyof SecretsFile, value: string): boolean {
  memory[field] = value
  if (!safeStorage.isEncryptionAvailable()) return false
  const data = readSecrets()
  data[field] = safeStorage.encryptString(value).toString('base64')
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
    return memory.oauthToken ?? decrypt(readSecrets().oauthToken)
  },
  saveToken(token: string): boolean {
    return save('oauthToken', token)
  },
  clearToken(): void {
    clear('oauthToken')
  },

  getOpenRouterKey(): string | null {
    return memory.openrouterKey ?? decrypt(readSecrets().openrouterKey)
  },
  saveOpenRouterKey(key: string): boolean {
    return save('openrouterKey', key)
  },
  clearOpenRouterKey(): void {
    clear('openrouterKey')
  }
}
