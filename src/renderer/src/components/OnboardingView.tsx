import { useState } from 'react'
import { KeyRound, TerminalSquare, Check, Loader2 } from 'lucide-react'
import { useAuth } from '../stores/auth'

export function OnboardingView({ reason }: { reason?: string }): React.JSX.Element {
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const result = await window.api.invoke('auth:saveManualToken', { token })
    setSaving(false)
    if (!result.ok) {
      setError(result.error ?? 'Could not save token')
      return
    }
    // auth:state event flips the app out of onboarding.
    void window.api.invoke('auth:getState').then((a) => useAuth.getState().set(a))
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8">
        <div className="mb-2 flex items-center gap-3">
          <KeyRound size={24} className="text-accent" />
          <h1 className="text-xl font-semibold">Log in with your Claude account</h1>
        </div>
        <p className="mb-1 text-sm text-text-dim">
          Seashell uses your Claude subscription through Claude Code.
        </p>
        {reason && (
          <p className="mb-4 rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-300">
            Your session may have expired: {reason}
          </p>
        )}

        <ol className="my-5 space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs">
              1
            </span>
            <div>
              <button
                onClick={() => void window.api.invoke('auth:openTerminalLogin')}
                className="mb-1 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-dim"
              >
                <TerminalSquare size={16} />
                Open terminal &amp; get a token
              </button>
              <p className="text-text-dim">
                A terminal will run <code className="rounded bg-surface-2 px-1">claude setup-token</code>.
                Follow the browser login, then copy the token it prints
                (starts with <code className="rounded bg-surface-2 px-1">sk-ant-</code>).
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs">
              2
            </span>
            <div className="flex-1">
              <div className="flex gap-2">
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your token here (sk-ant-…)"
                  className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs outline-none placeholder:text-text-dim focus:border-accent-dim"
                />
                <button
                  onClick={() => void save()}
                  disabled={saving || !token.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  Save
                </button>
              </div>
              {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
              <p className="mt-2 text-xs text-text-dim">
                Stored encrypted on this machine (Windows DPAPI). Alternatively, run{' '}
                <code className="rounded bg-surface-2 px-1">claude /login</code> once in any terminal
                — Seashell picks that up automatically on restart.
              </p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  )
}
