import { useEffect, useState } from 'react'
import { X, Settings2, LogIn, LogOut, KeyRound, SquareTerminal, Trash2 } from 'lucide-react'
import type { PermissionMode, Provider, ThinkingLevel } from '@shared/types'
import { updateSettings, useSettings } from '../stores/settings'
import { useAuth } from '../stores/auth'

/** Log in with your Claude (Anthropic) account so sessions bill the
 *  subscription: guided setup-token flow in a terminal + manual paste. */
function AccountSection(): React.JSX.Element {
  const authState = useAuth((s) => s.auth)
  const [token, setToken] = useState('')
  const [tokenState, setTokenState] = useState<'idle' | 'busy' | 'error' | 'saved'>('idle')
  const [tokenError, setTokenError] = useState('')
  const loggedIn = authState.state === 'token' || authState.state === 'apiKey'

  const saveToken = async (): Promise<void> => {
    setTokenState('busy')
    const result = await window.api.invoke('auth:saveManualToken', { token: token.trim() })
    if (result.ok) {
      setTokenState('saved')
      setToken('')
    } else {
      setTokenState('error')
      setTokenError(result.error ?? 'Could not save the token')
    }
  }

  return (
    <div>
      <div className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-dim">
        Account
      </div>

      <Row
        label={authState.state === 'loggedOut' ? 'Not logged in' : (authState.detail ?? 'Logged in')}
        hint={
          loggedIn
            ? 'New sessions use this login and bill your Claude subscription.'
            : 'Log in with your Claude account so sessions use your subscription instead of an API key.'
        }
      >
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${loggedIn ? 'bg-green-500' : 'bg-red-500'}`}
          />
          {loggedIn && (
            <button
              onClick={() => void window.api.invoke('auth:logout')}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-border"
            >
              <LogOut size={14} /> Log out
            </button>
          )}
        </span>
      </Row>

      <Row
        label="Log in with Claude"
        hint="Opens a terminal running `claude setup-token` — finish the sign-in in your browser, then paste the sk-ant-… token it prints into the field below."
      >
        <button
          onClick={() => void window.api.invoke('auth:openTerminalLogin')}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dim"
        >
          <SquareTerminal size={14} /> Start login
        </button>
      </Row>

      <Row label="Paste a token" hint="A long-lived token from `claude setup-token` (starts with sk-ant-). Stored encrypted with Windows DPAPI.">
        <span className="flex items-center gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value)
              setTokenState('idle')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && token.trim()) void saveToken()
            }}
            placeholder="sk-ant-…"
            className="w-52 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent-dim"
          />
          <button
            onClick={() => void saveToken()}
            disabled={!token.trim() || tokenState === 'busy'}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
          >
            <LogIn size={14} /> {tokenState === 'saved' ? 'Saved' : 'Save'}
          </button>
        </span>
      </Row>
      {tokenState === 'error' && <p className="pb-2 text-xs text-red-400">{tokenError}</p>}
      {tokenState === 'saved' && (
        <p className="pb-2 text-xs text-accent">Logged in — new sessions will use your subscription.</p>
      )}
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="mt-0.5 max-w-sm text-xs text-text-dim">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ' +
        (checked ? 'bg-accent' : 'bg-surface-2')
      }
    >
      <span
        className={
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ' +
          (checked ? 'left-[22px]' : 'left-0.5')
        }
      />
    </button>
  )
}

const MODEL_CHOICES = [
  { value: null, label: 'Claude Code default' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' }
]

const MODE_CHOICES: { value: PermissionMode; label: string }[] = [
  { value: 'default', label: 'Ask before tools' },
  { value: 'acceptEdits', label: 'Auto-accept edits' },
  { value: 'plan', label: 'Plan mode' }
]

function ProvidersSection(): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const [keySet, setKeySet] = useState(false)
  const [customKeySet, setCustomKeySet] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [customKeyInput, setCustomKeyInput] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const state = await window.api.invoke('providers:getState')
    setKeySet(state.openrouterKeySet)
    setCustomKeySet(state.customKeySet)
  }
  useEffect(() => {
    void refresh()
  }, [])

  const saveKey = async (): Promise<void> => {
    setKeyError(null)
    const result = await window.api.invoke('providers:saveOpenRouterKey', { key: keyInput })
    if (!result.ok) {
      setKeyError(result.error ?? 'Could not save key')
      return
    }
    setKeyInput('')
    void refresh()
  }

  const saveCustomKey = async (): Promise<void> => {
    setKeyError(null)
    const result = await window.api.invoke('providers:saveCustomKey', { key: customKeyInput })
    if (!result.ok) {
      setKeyError(result.error ?? 'Could not save key')
      return
    }
    setCustomKeyInput('')
    void refresh()
  }

  const customReady = customKeySet && !!settings.customBaseUrl

  return (
    <div>
      <div className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-dim">
        Providers
      </div>
      <Row
        label="Provider for new sessions"
        hint={
          settings.defaultProvider === 'openrouter'
            ? 'OpenRouter bills its own credits per token — this does NOT use your Claude subscription.'
            : 'Anthropic uses your Claude subscription login.'
        }
      >
        <select
          value={settings.defaultProvider}
          onChange={(e) => void updateSettings({ defaultProvider: e.target.value as Provider })}
          className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none"
        >
          <option value="anthropic">Anthropic (subscription)</option>
          <option value="openrouter" disabled={!keySet}>
            OpenRouter (credits){keySet ? '' : ' — add key first'}
          </option>
          <option value="custom" disabled={!customReady}>
            Custom endpoint{customReady ? '' : ' — set URL & key first'}
          </option>
        </select>
      </Row>
      <Row
        label="OpenRouter API key"
        hint={
          keySet
            ? 'Key saved (encrypted). New OpenRouter sessions use it.'
            : 'Get one at openrouter.ai/settings/keys. Stored encrypted on this machine.'
        }
      >
        {keySet ? (
          <button
            onClick={() => {
              void window.api.invoke('providers:clearOpenRouterKey').then(() => {
                void updateSettings({ defaultProvider: 'anthropic' })
                void refresh()
              })
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-border"
          >
            <Trash2 size={14} /> Remove key
          </button>
        ) : (
          <span className="flex items-center gap-1.5">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-or-…"
              className="w-44 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-accent-dim"
            />
            <button
              onClick={() => void saveKey()}
              disabled={!keyInput.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-dim disabled:opacity-40"
            >
              <KeyRound size={14} /> Save
            </button>
          </span>
        )}
      </Row>
      <Row
        label="Custom endpoint URL"
        hint="Any Anthropic-compatible API — a LiteLLM/Ollama proxy, a gateway, another vendor's compat endpoint."
      >
        <input
          type="text"
          value={settings.customBaseUrl ?? ''}
          onChange={(e) => void updateSettings({ customBaseUrl: e.target.value.trim() || null })}
          placeholder="https://host/v1 or http://localhost:4000"
          className="w-64 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-accent-dim"
        />
      </Row>
      <Row
        label="Custom endpoint key"
        hint={
          customKeySet
            ? 'Key saved (encrypted). New custom sessions use it.'
            : 'Whatever the endpoint expects as its API key. Stored encrypted on this machine.'
        }
      >
        {customKeySet ? (
          <button
            onClick={() => {
              void window.api.invoke('providers:clearCustomKey').then(() => {
                if (settings.defaultProvider === 'custom')
                  void updateSettings({ defaultProvider: 'anthropic' })
                void refresh()
              })
            }}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-border"
          >
            <Trash2 size={14} /> Remove key
          </button>
        ) : (
          <span className="flex items-center gap-1.5">
            <input
              type="password"
              value={customKeyInput}
              onChange={(e) => setCustomKeyInput(e.target.value)}
              placeholder="key"
              className="w-44 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-accent-dim"
            />
            <button
              onClick={() => void saveCustomKey()}
              disabled={!customKeyInput.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-dim disabled:opacity-40"
            >
              <KeyRound size={14} /> Save
            </button>
          </span>
        )}
      </Row>
      <Row
        label="Custom endpoint model"
        hint="Model id new custom sessions start with (whatever your endpoint serves)."
      >
        <input
          type="text"
          value={settings.customModel ?? ''}
          onChange={(e) => void updateSettings({ customModel: e.target.value.trim() || null })}
          placeholder="e.g. glm-4.7 or deepseek-chat"
          className="w-64 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-accent-dim"
        />
      </Row>
      {keyError && <p className="pb-2 text-xs text-red-400">{keyError}</p>}
    </div>
  )
}

export function SettingsView({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useSettings((s) => s.settings)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8">
      <div className="flex max-h-full w-full max-w-xl flex-col rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Settings2 size={18} className="text-accent" />
          <h2 className="font-semibold">Settings</h2>
          <button onClick={onClose} className="ml-auto rounded p-1 hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>

        <div className="divide-y divide-border/60 overflow-y-auto px-6 pb-4">
          <div className="pt-3">
            <div className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-dim">
              New sessions
            </div>
            <Row label="Default model" hint="Used when a new tab opens.">
              <select
                value={settings.defaultModel ?? ''}
                onChange={(e) => void updateSettings({ defaultModel: e.target.value || null })}
                className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none"
              >
                {MODEL_CHOICES.map((m) => (
                  <option key={m.label} value={m.value ?? ''}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Default permission mode">
              <select
                value={settings.defaultPermissionMode}
                onChange={(e) =>
                  void updateSettings({ defaultPermissionMode: e.target.value as PermissionMode })
                }
                className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none"
              >
                {MODE_CHOICES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row
              label="Default thinking"
              hint="Extended-thinking budget for new sessions — adjustable per session from the composer."
            >
              <select
                value={settings.defaultThinkingLevel}
                onChange={(e) =>
                  void updateSettings({ defaultThinkingLevel: e.target.value as ThinkingLevel })
                }
                className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none"
              >
                <option value="off">No thinking</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="ultra">Ultra</option>
              </select>
            </Row>
            <Row
              label="Let Claude extend itself"
              hint="Claude may create skills for repeated or hard tasks, slash commands, subagents, and its own tools, and install plugins/MCP servers when they fit — it always tells you what it added."
            >
              <Toggle
                checked={settings.allowSelfSkills}
                onChange={(v) => void updateSettings({ allowSelfSkills: v })}
              />
            </Row>
          </div>

          <ProvidersSection />

          <div>
            <div className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-dim">
              After every answer
            </div>
            <Row
              label="Auto-retrospective"
              hint="After each answer, Claude reflects on the exchange and saves durable lessons to its memory. Uses one extra (small) turn per answer, which counts toward your plan's usage."
            >
              <Toggle
                checked={settings.autoRetrospective}
                onChange={(v) => void updateSettings({ autoRetrospective: v })}
              />
            </Row>
            <Row
              label="Retrospective only after changes"
              hint="Skip the retrospective when the answer didn't touch any files or run commands — pure questions have nothing to remember. Saves one turn per read-only answer."
            >
              <Toggle
                checked={settings.retroOnlyAfterEdits}
                onChange={(v) => void updateSettings({ retroOnlyAfterEdits: v })}
              />
            </Row>
            <Row
              label="Auto-compact"
              hint="Compacts the conversation once the context grows past the threshold below. Compacting itself costs one call over the whole context, so it only runs when it pays off."
            >
              <Toggle
                checked={settings.autoCompact}
                onChange={(v) => void updateSettings({ autoCompact: v })}
              />
            </Row>
            <Row
              label="Compact threshold"
              hint="Only auto-compact when the context exceeds this many tokens. Higher = fewer compaction calls = cheaper, at the cost of a fuller context."
            >
              <select
                value={String(settings.compactThreshold)}
                onChange={(e) => void updateSettings({ compactThreshold: Number(e.target.value) })}
                className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm outline-none"
              >
                <option value="30000">30k tokens</option>
                <option value="60000">60k tokens</option>
                <option value="100000">100k tokens</option>
                <option value="140000">140k tokens</option>
              </select>
            </Row>
          </div>

          <div>
            <div className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-dim">
              App
            </div>
            <Row label="Notifications" hint="Toast when approval is needed or a turn finishes in the background.">
              <Toggle
                checked={settings.notifications}
                onChange={(v) => void updateSettings({ notifications: v })}
              />
            </Row>
            <Row
              label="Auto-screenshot visual changes"
              hint="When a turn edits pages, styles, or components, capture the result (dev server or the written HTML) with headless Edge and paste before/after frames into the chat."
            >
              <Toggle
                checked={settings.autoScreenshots}
                onChange={(v) => void updateSettings({ autoScreenshots: v })}
              />
            </Row>
            <Row
              label="Use Claude Desktop connectors"
              hint="Loads the MCP connectors from your Claude Desktop config (Blender, studiokit, etc.) into every new session, alongside your Claude Code plugins and skills."
            >
              <Toggle
                checked={settings.importDesktopMcp}
                onChange={(v) => void updateSettings({ importDesktopMcp: v })}
              />
            </Row>
            <Row label="Font size">
              <div className="flex overflow-hidden rounded-lg border border-border text-xs">
                {(['sm', 'md', 'lg'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => void updateSettings({ fontSize: size })}
                    className={
                      'px-3 py-1.5 ' +
                      (settings.fontSize === size
                        ? 'bg-accent-dim/40 text-accent'
                        : 'bg-surface-2 text-text-dim hover:text-text')
                    }
                  >
                    {size.toUpperCase()}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Chat width" hint="How wide the conversation and composer fill the window.">
              <div className="flex overflow-hidden rounded-lg border border-border text-xs">
                {(['comfortable', 'wide', 'full'] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => void updateSettings({ chatWidth: w })}
                    className={
                      'px-3 py-1.5 capitalize ' +
                      (settings.chatWidth === w
                        ? 'bg-accent-dim/40 text-accent'
                        : 'bg-surface-2 text-text-dim hover:text-text')
                    }
                  >
                    {w}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Reduce motion" hint="Disable animations.">
              <Toggle
                checked={settings.reducedMotion}
                onChange={(v) => void updateSettings({ reducedMotion: v })}
              />
            </Row>
            <Row label="Smooth streaming" hint="Reveal answers block by block with the word fade. Off = text appears as fast as it arrives.">
              <Toggle
                checked={settings.smoothStreaming}
                onChange={(v) => void updateSettings({ smoothStreaming: v })}
              />
            </Row>
            <Row label="Theme" hint="The palette — backgrounds, panels, text. Accent color applies on top.">
              <div className="flex gap-1.5">
                {(
                  [
                    ['abyss', 'Abyss', '#0a0a0a', '#1d1d1d'],
                    ['midnight', 'Midnight', '#000000', '#161616'],
                    ['lagoon', 'Lagoon', '#061219', '#112a36'],
                    ['reef', 'Reef', '#120d0a', '#251b16'],
                    ['sandbar', 'Sandbar', '#f3efe6', '#ebe5d7']
                  ] as const
                ).map(([id, label, bg, surface]) => (
                  <button
                    key={id}
                    onClick={() => void updateSettings({ theme: id })}
                    title={label}
                    className={
                      'flex h-9 w-12 flex-col overflow-hidden rounded-lg border transition-transform hover:scale-105 ' +
                      (settings.theme === id
                        ? 'border-accent ring-1 ring-accent'
                        : 'border-border')
                    }
                  >
                    <span className="h-2/3 w-full" style={{ backgroundColor: bg }} />
                    <span className="h-1/3 w-full" style={{ backgroundColor: surface }} />
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Accent color" hint="Buttons, glows, gauges — works with any theme.">
              <div className="flex gap-1.5">
                {['#14b8a6', '#d97757', '#7c3aed', '#3b82f6', '#ec4899', '#22c55e', '#eab308'].map(
                  (color) => (
                    <button
                      key={color}
                      onClick={() => void updateSettings({ accent: color })}
                      title={color}
                      style={{ backgroundColor: color }}
                      className={
                        'h-6 w-6 rounded-full transition-transform hover:scale-110 ' +
                        (settings.accent === color
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-surface'
                          : '')
                      }
                    />
                  )
                )}
              </div>
            </Row>
            <Row label="Editor font size">
              <select
                value={String(settings.editorFontSize)}
                onChange={(e) => void updateSettings({ editorFontSize: Number(e.target.value) })}
                className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm outline-none"
              >
                {[11, 12, 13, 14, 16, 18].map((n) => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Terminal shell" hint="New terminals use this shell.">
              <select
                value={settings.terminalShell}
                onChange={(e) =>
                  void updateSettings({
                    terminalShell: e.target.value as 'cmd' | 'powershell' | 'pwsh'
                  })
                }
                className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm outline-none"
              >
                <option value="cmd">Command Prompt</option>
                <option value="powershell">Windows PowerShell</option>
                <option value="pwsh">PowerShell 7 (pwsh)</option>
              </select>
            </Row>
            <Row label="Terminal font size">
              <select
                value={String(settings.terminalFontSize)}
                onChange={(e) =>
                  void updateSettings({ terminalFontSize: Number(e.target.value) })
                }
                className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm outline-none"
              >
                {[11, 12, 13, 14, 16, 18].map((n) => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
              </select>
            </Row>
            <Row
              label="Reopen last project on launch"
              hint="Skip the welcome screen and jump straight back into what you were doing."
            >
              <Toggle
                checked={settings.reopenLastProject}
                onChange={(v) => void updateSettings({ reopenLastProject: v })}
              />
            </Row>
          </div>

          <div>
            <div className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-dim">
              Data
            </div>
            <Row
              label="App data folder"
              hint="Settings, usage history, secrets (encrypted), and preview caches."
            >
              <button
                onClick={() => void window.api.invoke('app:openDataFolder')}
                className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-border"
              >
                Open folder
              </button>
            </Row>
            <Row
              label="Preview cache"
              hint="Project cover screenshots and turn captures. Safe to clear — they regenerate."
            >
              <button
                onClick={() => void window.api.invoke('previews:clearCache')}
                className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-border"
              >
                Clear cache
              </button>
            </Row>
          </div>

          <AccountSection />
        </div>
      </div>
    </div>
  )
}
