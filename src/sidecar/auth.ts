import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Events } from '../shared/ipc-contract'
import type { AuthState } from '../shared/types'
import { openTerminalWith } from './platform'
import { secrets } from './secrets'

type Broadcast = <C extends keyof Events>(channel: C, payload: Events[C]) => void

let broadcast: Broadcast = () => {}
export function setAuthBroadcast(fn: Broadcast): void {
  broadcast = fn
}

/** Inject the stored token so the SDK-spawned CLI inherits it. */
export function injectStoredToken(): void {
  const token = secrets.getToken()
  if (token && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token
  }
}

export const auth = {
  getState(): AuthState {
    if (secrets.getToken() || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      return { state: 'token', detail: 'Long-lived Claude token' }
    }
    if (process.env.ANTHROPIC_API_KEY) {
      return { state: 'apiKey', detail: 'ANTHROPIC_API_KEY from environment' }
    }
    // The SDK-spawned CLI reads its own stored login, so an existing
    // `claude /login` session works with no token at all.
    const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    if (existsSync(join(configDir, '.credentials.json'))) {
      return { state: 'token', detail: 'Claude Code CLI login' }
    }
    return { state: 'loggedOut' }
  },

  saveManualToken(token: string): { ok: boolean; error?: string } {
    const trimmed = token.trim()
    if (!trimmed.startsWith('sk-ant-')) {
      return { ok: false, error: 'That does not look like a Claude token (should start with sk-ant-)' }
    }
    secrets.saveToken(trimmed)
    process.env.CLAUDE_CODE_OAUTH_TOKEN = trimmed
    broadcast('auth:state', this.getState())
    return { ok: true }
  },

  logout(): void {
    secrets.clearToken()
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    broadcast('auth:state', this.getState())
  },

  /** Open a visible terminal running `claude setup-token` for the user to complete. */
  openTerminalLogin(): void {
    openTerminalWith('claude setup-token')
  },

  looksLikeAuthError(text: string): boolean {
    return /401|unauthor|invalid.*(api key|token)|authentication|not.*logged.*in|please.*login/i.test(
      text
    )
  },

  notifyLoggedOut(reason: string): void {
    broadcast('auth:state', { state: 'loggedOut', detail: reason })
  }
}
