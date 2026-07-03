import { useEffect, useState } from 'react'
import { X, Settings2, LogOut, KeyRound, Trash2 } from 'lucide-react'
import type { PermissionMode, Provider } from '@shared/types'
import { updateSettings, useSettings } from '../stores/settings'
import { useAuth } from '../stores/auth'

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
  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const state = await window.api.invoke('providers:getState')
    setKeySet(state.openrouterKeySet)
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
      {keyError && <p className="pb-2 text-xs text-red-400">{keyError}</p>}
    </div>
  )
}

export function SettingsView({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const authState = useAuth((s) => s.auth)

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
              label="Let Claude create its own skills"
              hint="Claude may write reusable project skills and slash commands (.claude/skills, .claude/commands) when it spots a repeatable workflow."
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
            <Row label="Reduce motion" hint="Disable animations.">
              <Toggle
                checked={settings.reducedMotion}
                onChange={(v) => void updateSettings({ reducedMotion: v })}
              />
            </Row>
          </div>

          <div>
            <div className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-text-dim">
              Account
            </div>
            <Row
              label={
                authState.state === 'loggedOut' ? 'Not logged in' : (authState.detail ?? 'Logged in')
              }
              hint="New sessions use this login."
            >
              <button
                onClick={() => void window.api.invoke('auth:logout')}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm hover:bg-border"
              >
                <LogOut size={14} /> Log out
              </button>
            </Row>
          </div>
        </div>
      </div>
    </div>
  )
}
