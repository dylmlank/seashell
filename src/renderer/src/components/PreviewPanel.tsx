import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Square
} from 'lucide-react'
import clsx from 'clsx'
import type { DevServerStatus, PortInfo } from '@shared/types'
import { useSessions, type ChatItem } from '../stores/sessions'
import { Markdown } from './Markdown'

type ShotsItem = Extract<ChatItem, { kind: 'shots' }>

/** Every screenshot captured this session, newest first, with a lightbox. */
function ShotsGallery({ shots }: { shots: ShotsItem[] }): React.JSX.Element {
  const [zoom, setZoom] = useState<{ data: string; label: string } | null>(null)
  if (shots.length === 0) {
    return (
      <p className="p-4 text-xs leading-relaxed text-text-dim">
        No screenshots yet. When a turn changes something visual, Seashell captures
        before/after frames automatically — they show up in the chat and collect here.
      </p>
    )
  }
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      {[...shots].reverse().map((s) => (
        <div key={s.id}>
          <p className="pb-1.5 truncate font-mono text-[11px] text-text-dim">{s.title}</p>
          <div className="grid grid-cols-2 gap-2">
            {s.frames.map((f) => (
              <button
                key={`${s.id}-${f.label}`}
                onClick={() => setZoom({ data: f.data, label: `${s.title} — ${f.label}` })}
                className="group overflow-hidden rounded-lg border border-border bg-black/30 text-left transition-transform hover:scale-[1.02]"
                title="Click to enlarge"
              >
                <img
                  src={`data:image/png;base64,${f.data}`}
                  alt={f.label}
                  className="max-h-40 w-full object-contain"
                />
                <span className="block px-2 py-1 text-[10px] capitalize text-text-dim group-hover:text-text">
                  {f.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-black/85 p-6"
          onClick={() => setZoom(null)}
        >
          <img
            src={`data:image/png;base64,${zoom.data}`}
            alt={zoom.label}
            className="max-h-[90%] max-w-full rounded-xl border border-border shadow-2xl"
          />
          <p className="text-xs text-text-dim">{zoom.label}</p>
        </div>
      )}
    </div>
  )
}

function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\')
}

/** Dev servers we'd rather auto-focus, in priority order. */
const DEV_PORTS = [5173, 5174, 3000, 3001, 4321, 8080, 8000, 4000, 4200, 5000]

function pickDevPort(ports: PortInfo[]): number | undefined {
  for (const p of DEV_PORTS) if (ports.some((x) => x.port === p)) return p
  return ports[0]?.port
}

/** Live preview: an embedded browser pointed at the project's dev server, plus a
 *  file mode for the last HTML/SVG/Markdown artifact Claude wrote. */
export function PreviewPanel({
  path,
  cwd,
  tabId
}: {
  path?: string
  cwd: string
  tabId?: string
}): React.JSX.Element {
  const shots = useSessions(
    (s) =>
      (s.tabs.find((t) => t.tabId === tabId)?.items.filter((i) => i.kind === 'shots') ??
        []) as ShotsItem[]
  )
  const [mode, setMode] = useState<'live' | 'file' | 'shots'>(
    path ? 'file' : shots.length > 0 ? 'shots' : 'live'
  )

  // --- live browser state ---
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [url, setUrl] = useState('http://localhost:3000')
  const [draft, setDraft] = useState('http://localhost:3000')
  const [reloadKey, setReloadKey] = useState(0)
  const [auto, setAuto] = useState(false)
  const pickedRef = useRef(false)

  // --- dev-server launcher state ---
  const [dev, setDev] = useState<DevServerStatus | null>(null)
  const [picked, setPicked] = useState(false)
  const startedRef = useRef(false)

  const focusUrl = useCallback((next: string): void => {
    setPicked(true)
    setUrl(next)
    setDraft(next)
    setReloadKey((k) => k + 1)
  }, [])

  const scanPorts = useCallback(async (): Promise<boolean> => {
    const result = await window.api.invoke('ports:list')
    if ('error' in result) return pickedRef.current
    setPorts(result)
    // Auto-focus a detected dev server once, so the pane isn't blank on open.
    if (!pickedRef.current) {
      const port = pickDevPort(result)
      if (port) {
        pickedRef.current = true
        setPicked(true)
        const next = `http://localhost:${port}`
        setUrl(next)
        setDraft(next)
      }
    }
    return pickedRef.current
  }, [])

  const startDev = useCallback(async (): Promise<void> => {
    startedRef.current = true
    const status = await window.api.invoke('dev:start', { cwd })
    setDev(status)
    if (status.url) {
      pickedRef.current = true
      focusUrl(status.url)
    }
  }, [cwd, focusUrl])

  const stopDev = useCallback(async (): Promise<void> => {
    await window.api.invoke('dev:stop', { cwd })
    setDev(null)
    startedRef.current = false
    pickedRef.current = false
    setPicked(false)
  }, [cwd])

  // On opening the live pane: if nothing is already serving, launch the
  // project's dev server automatically.
  useEffect(() => {
    if (mode !== 'live') return
    let alive = true
    void (async () => {
      const existing = await window.api.invoke('dev:status', { cwd })
      if (!alive) return
      if (existing.running) {
        setDev(existing)
        startedRef.current = true
        if (existing.url) {
          pickedRef.current = true
          focusUrl(existing.url)
        }
        return
      }
      const found = await scanPorts()
      if (!alive || found || startedRef.current) return
      void startDev()
    })()
    return () => {
      alive = false
    }
  }, [mode, cwd, scanPorts, startDev, focusUrl])

  // While the launched server is booting, poll until it prints its URL (or errors).
  useEffect(() => {
    if (!dev?.running || dev.url || dev.error) return
    const timer = setInterval(() => {
      void (async () => {
        const status = await window.api.invoke('dev:status', { cwd })
        setDev(status)
        if (status.url) {
          pickedRef.current = true
          focusUrl(status.url)
          void scanPorts()
        }
      })()
    }, 1200)
    return () => clearInterval(timer)
  }, [dev, cwd, focusUrl, scanPorts])

  useEffect(() => {
    if (!auto || mode !== 'live') return
    const timer = setInterval(() => setReloadKey((k) => k + 1), 2000)
    return () => clearInterval(timer)
  }, [auto, mode])

  const go = (raw: string): void => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const next = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
    setUrl(next)
    setDraft(next)
    setReloadKey((k) => k + 1)
  }

  const openExternal = (): void => {
    const m = url.match(/:(\d+)/)
    if (m) void window.api.invoke('ports:open', { port: Number(m[1]) })
  }

  // --- file mode state ---
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const absPath = path
    ? isAbsolute(path)
      ? path
      : `${cwd.replace(/[\\/]+$/, '')}\\${path}`
    : ''
  const name = path ? (path.split(/[\\/]/).pop() ?? path) : ''
  const isMarkdown = /\.(md|markdown)$/i.test(name)

  const loadFile = useCallback(async (): Promise<void> => {
    if (!absPath) return
    setError(null)
    const result = await window.api.invoke('fs:readFile', { path: absPath })
    if ('error' in result) {
      setError(result.error)
      setContent(null)
    } else {
      setContent(result.content)
    }
  }, [absPath])

  useEffect(() => {
    if (mode === 'file') void loadFile()
  }, [mode, loadFile])

  const tabCls = (active: boolean): string =>
    clsx(
      'flex items-center gap-1 rounded-md px-2 py-0.5 text-xs',
      active ? 'bg-accent/15 text-accent' : 'text-text-dim hover:bg-surface-2 hover:text-text'
    )

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-surface">
      {/* Mode tabs */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <Eye size={14} className="shrink-0 text-accent" />
        <button onClick={() => setMode('live')} className={tabCls(mode === 'live')}>
          <Globe size={12} /> Live
        </button>
        {path && (
          <button onClick={() => setMode('file')} className={tabCls(mode === 'file')}>
            <FileText size={12} /> {name}
          </button>
        )}
        <button onClick={() => setMode('shots')} className={tabCls(mode === 'shots')}>
          <Camera size={12} /> Shots{shots.length > 0 ? ` (${shots.length})` : ''}
        </button>
      </div>

      {mode === 'shots' ? (
        <ShotsGallery shots={shots} />
      ) : mode === 'live' ? (
        <>
          {/* URL bar */}
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go(draft)}
              placeholder="http://localhost:3000"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs outline-none placeholder:text-text-dim/60"
            />
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              title="Reload"
              className="rounded p-1 text-text-dim hover:bg-surface-2 hover:text-text"
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={() => setAuto((a) => !a)}
              title={auto ? 'Auto-refresh on (every 2s)' : 'Auto-refresh off'}
              className={clsx(
                'rounded p-1 hover:bg-surface-2',
                auto ? 'text-accent' : 'text-text-dim hover:text-text'
              )}
            >
              <RotateCw size={13} className={auto ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={openExternal}
              title="Open in your browser"
              className="rounded p-1 text-text-dim hover:bg-surface-2 hover:text-text"
            >
              <ExternalLink size={13} />
            </button>
          </div>

          {/* Dev-server launcher status */}
          {dev?.error ? (
            <div className="border-b border-border/60 bg-red-950/30 px-2 py-1.5 text-[11px]">
              <div className="flex items-center gap-1.5 text-red-400">
                <AlertTriangle size={12} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{dev.error}</span>
                <button
                  onClick={() => void startDev()}
                  className="rounded px-1.5 py-0.5 text-text-dim hover:bg-surface-2 hover:text-text"
                >
                  Retry
                </button>
              </div>
              {dev.log.length > 0 && (
                <p className="mt-1 truncate font-mono text-[10px] text-text-dim/70">
                  {dev.log[dev.log.length - 1]}
                </p>
              )}
            </div>
          ) : dev?.starting ? (
            <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5 text-[11px] text-text-dim">
              <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
              <span className="min-w-0 flex-1 truncate">
                Starting dev server…{' '}
                {dev.command && <span className="font-mono text-text-dim/70">{dev.command}</span>}
              </span>
              <button
                onClick={() => void stopDev()}
                title="Stop dev server"
                className="rounded p-0.5 hover:bg-surface-2 hover:text-text"
              >
                <Square size={11} />
              </button>
            </div>
          ) : dev?.running ? (
            <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5 text-[11px] text-text-dim">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
              <span className="min-w-0 flex-1 truncate">
                Dev server running{' '}
                {dev.command && <span className="font-mono text-text-dim/70">{dev.command}</span>}
              </span>
              <button
                onClick={() => void stopDev()}
                title="Stop dev server"
                className="rounded p-0.5 hover:bg-surface-2 hover:text-text"
              >
                <Square size={11} />
              </button>
            </div>
          ) : (
            !picked && (
              <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5 text-[11px] text-text-dim">
                <span className="min-w-0 flex-1 truncate">No dev server detected.</span>
                <button
                  onClick={() => void startDev()}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-surface-2"
                >
                  <Play size={11} /> Start dev server
                </button>
              </div>
            )
          )}

          {/* Detected dev servers */}
          {ports.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-border/60 px-2 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-text-dim/60">Running</span>
              {ports.slice(0, 8).map((p) => (
                <button
                  key={`${p.port}-${p.pid}`}
                  onClick={() => go(`http://localhost:${p.port}`)}
                  title={`${p.process} (pid ${p.pid})`}
                  className={clsx(
                    'rounded-md px-1.5 py-0.5 font-mono text-[11px]',
                    url.includes(`:${p.port}`)
                      ? 'bg-accent/15 text-accent'
                      : 'bg-surface-2 text-text-dim hover:text-text'
                  )}
                >
                  :{p.port}
                </button>
              ))}
              <button
                onClick={() => void scanPorts()}
                title="Rescan ports"
                className="ml-auto rounded p-0.5 text-text-dim hover:text-text"
              >
                <RefreshCw size={11} />
              </button>
            </div>
          )}

          <iframe
            key={reloadKey}
            title="live preview"
            src={url}
            className="min-h-0 flex-1 border-0 bg-white"
          />
        </>
      ) : error ? (
        <div className="flex items-center justify-between gap-2 p-4 text-sm">
          <span className="text-red-400">{error}</span>
          <button
            onClick={() => void loadFile()}
            className="rounded p-1 text-text-dim hover:bg-surface-2 hover:text-text"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      ) : content === null ? (
        <div className="flex items-center gap-2 p-4 text-sm text-text-dim">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-xs text-text-dim">
            <span className="truncate font-mono" title={absPath}>
              {name}
            </span>
            <button
              onClick={() => void loadFile()}
              title="Reload"
              className="ml-auto rounded p-1 hover:bg-surface-2 hover:text-text"
            >
              <RefreshCw size={13} />
            </button>
          </div>
          {isMarkdown ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
              <Markdown text={content} />
            </div>
          ) : (
            // Scripts stay enabled so interactive artifacts work; the sandbox still
            // blocks navigation, popups, and anything outside the frame.
            <iframe
              title="artifact preview"
              sandbox="allow-scripts"
              srcDoc={content}
              className="min-h-0 flex-1 border-0 bg-white"
            />
          )}
        </>
      )}
    </div>
  )
}
