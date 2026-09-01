import { useCallback, useEffect, useState } from 'react'
import { Loader2, Play, RefreshCw, Square, Star } from 'lucide-react'
import type { MissionProject, MissionState } from '@shared/types'
import { createTab } from '../stores/sessions'
import { useUi } from '../stores/ui'
import { alertDialog } from '../lib/dialogs'

type View = 'flagship' | 'agents' | 'all'

const VIEWS: { id: View; label: string }[] = [
  { id: 'flagship', label: 'Flagships' },
  { id: 'agents', label: 'Agents' },
  { id: 'all', label: 'All' }
]

function timeAgo(ms: number): string {
  if (!ms) return 'never'
  const mins = Math.floor((Date.now() - ms) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function Chip({
  tone = 'dim',
  children
}: {
  tone?: 'dim' | 'live' | 'warn' | 'text'
  children: React.ReactNode
}): React.JSX.Element {
  const color =
    tone === 'live'
      ? 'text-emerald-400 border-emerald-500/40'
      : tone === 'warn'
        ? 'text-amber-400 border-amber-500/40'
        : tone === 'text'
          ? 'text-text border-border'
          : 'text-text-dim border-border'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border bg-surface-2 px-1.5 py-0.5 text-[10px] tabular-nums ${color}`}
    >
      {tone === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      {children}
    </span>
  )
}

/** Every project on the drive at a glance: git state, whether its agent is
 *  live, and one click to open a session in it. Backed by the mission-control
 *  server, which the sidecar starts on demand. */
export function MissionControlPanel(): React.JSX.Element {
  const [state, setState] = useState<MissionState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('flagship')
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useUi((s) => s.toast)

  const load = useCallback(async (refresh?: boolean): Promise<void> => {
    const result = await window.api.invoke('mission:state', { refresh })
    if ('error' in result) setError(result.error)
    else {
      setError(null)
      setState(result)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 20_000)
    return () => clearInterval(id)
  }, [load])

  const act = async (key: string, fn: () => Promise<{ ok: true } | { error: string }>) => {
    setBusy(key)
    const result = await fn()
    if ('error' in result) toast(result.error, 'error')
    await load(true)
    setBusy(null)
  }

  const open = async (project: MissionProject): Promise<void> => {
    setBusy(`open:${project.name}`)
    try {
      await createTab(project.path)
    } catch (err) {
      void alertDialog(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-text-dim">{error}</p>
        <button
          onClick={() => void load(true)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-accent hover:text-accent"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={18} className="animate-spin text-accent" />
      </div>
    )
  }

  const projects = state.projects.filter((p) =>
    view === 'flagship' ? p.flagship : view === 'agents' ? p.agent : true
  )
  const live = state.projects.filter((p) => p.agent?.running).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              view === v.id ? 'bg-surface-2 text-text' : 'text-text-dim hover:text-text'
            }`}
          >
            {v.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-text-dim">
          {live} agent{live === 1 ? '' : 's'} live
        </span>
        <button
          onClick={() => void load(true)}
          title="Rescan"
          className="rounded-lg p-1 text-text-dim hover:bg-surface-2 hover:text-text"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {projects.map((p) => (
          <div key={p.name} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-start gap-2">
              <button
                onClick={() => void open(p)}
                title={p.path}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-medium hover:text-accent">{p.label}</p>
                {p.note && <p className="truncate text-[11px] text-text-dim">{p.note}</p>}
              </button>
              <button
                onClick={() =>
                  void act(`pin:${p.name}`, () =>
                    window.api.invoke('mission:flagship', {
                      name: p.name,
                      flagship: !p.flagship
                    })
                  )
                }
                title={p.flagship ? 'Unpin from flagships' : 'Pin as flagship'}
                className={`shrink-0 rounded p-1 ${
                  p.flagship ? 'text-accent' : 'text-text-dim/50 hover:text-text-dim'
                }`}
              >
                <Star size={13} fill={p.flagship ? 'currentColor' : 'none'} />
              </button>
            </div>

            <div className="flex flex-wrap gap-1 pt-2">
              <Chip tone="text">{p.stack}</Chip>
              {p.agent &&
                (p.agent.running ? (
                  <Chip tone="live">pid {p.agent.running.pid}</Chip>
                ) : (
                  <Chip>stopped</Chip>
                ))}
              {p.agent?.connected && <Chip>in Claude Desktop</Chip>}
              {p.git ? (
                <>
                  <Chip>{p.git.branch}</Chip>
                  {p.git.dirty > 0 && <Chip tone="warn">{p.git.dirty} changed</Chip>}
                  {p.git.ahead > 0 && <Chip>↑{p.git.ahead}</Chip>}
                </>
              ) : (
                <Chip>no git</Chip>
              )}
              <Chip>{timeAgo(Math.max(p.lastActive, p.modified))}</Chip>
            </div>

            {p.git?.lastCommit && (
              <p className="truncate pt-1.5 text-[11px] text-text-dim">
                <span className="font-mono text-accent">{p.git.lastCommit.hash}</span>{' '}
                {p.git.lastCommit.subject}
              </p>
            )}

            {p.agent && (
              <button
                onClick={() =>
                  void act(`agent:${p.name}`, () =>
                    p.agent!.running
                      ? window.api.invoke('mission:stopAgent', { pid: p.agent!.running!.pid })
                      : window.api.invoke('mission:startAgent', { name: p.name })
                  )
                }
                disabled={busy === `agent:${p.name}`}
                className={`mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs disabled:opacity-50 ${
                  p.agent.running
                    ? 'border border-border text-text-dim hover:border-red-500/50 hover:text-red-400'
                    : 'bg-accent text-white hover:bg-accent-dim'
                }`}
              >
                {busy === `agent:${p.name}` ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : p.agent.running ? (
                  <Square size={11} />
                ) : (
                  <Play size={11} />
                )}
                {p.agent.running ? 'Stop agent' : 'Start agent'}
              </button>
            )}
          </div>
        ))}

        {projects.length === 0 && (
          <p className="py-8 text-center text-xs text-text-dim">Nothing here yet.</p>
        )}
      </div>
    </div>
  )
}
