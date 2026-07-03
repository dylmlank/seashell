import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  ExternalLink,
  Globe,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  SquareTerminal,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { PortInfo } from '@shared/types'
import * as terms from '../lib/terminals'
import { confirmDialog } from '../lib/dialogs'

/** Every TCP port listening on localhost — open in browser or kill the owner. */
function PortsView(): React.JSX.Element {
  const [ports, setPorts] = useState<PortInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const result = await window.api.invoke('ports:list')
    if ('error' in result) setError(result.error)
    else {
      setError(null)
      setPorts(result)
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {error ? (
        <p className="p-2 text-xs text-red-400">{error}</p>
      ) : ports === null ? (
        <div className="flex items-center gap-2 p-2 text-sm text-text-dim">
          <Loader2 size={14} className="animate-spin" /> Scanning ports…
        </div>
      ) : ports.length === 0 ? (
        <p className="p-2 text-xs text-text-dim">Nothing listening on localhost right now.</p>
      ) : (
        <div className="space-y-0.5">
          {ports.map((p) => (
            <div
              key={p.port}
              className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-2"
            >
              <span className="font-mono text-xs text-accent">:{p.port}</span>
              <span className="min-w-0 truncate text-xs text-text-dim">
                {p.process} <span className="text-text-dim/50">pid {p.pid}</span>
              </span>
              <span className="ml-auto flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                <button
                  onClick={() => void window.api.invoke('ports:open', { port: p.port })}
                  title={`Open http://localhost:${p.port} in your browser`}
                  className="rounded p-1 text-text-dim hover:bg-border hover:text-text"
                >
                  <ExternalLink size={12} />
                </button>
                <button
                  onClick={() => {
                    void confirmDialog(
                      `Kill ${p.process} (pid ${p.pid})? This stops whatever it's serving.`
                    ).then((ok) => {
                      if (ok) void window.api.invoke('ports:kill', { pid: p.pid }).then(() => void refresh())
                    })
                  }}
                  title="Kill this process"
                  className="rounded p-1 text-text-dim hover:bg-border hover:text-red-400"
                >
                  <X size={12} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="px-2 pt-2 text-[10px] text-text-dim/50">refreshes every 5s · all of localhost, not just this project</p>
    </div>
  )
}

/** npm scripts from the project's package.json, one click to run. */
function ScriptsMenu({ tabId, cwd, onRun }: { tabId: string; cwd: string; onRun: () => void }): React.JSX.Element | null {
  const [scripts, setScripts] = useState<string[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void window.api.invoke('fs:readFile', { path: `${cwd}/package.json` }).then((result) => {
      if ('error' in result) return
      try {
        const pkg = JSON.parse(result.content) as { scripts?: Record<string, string> }
        setScripts(Object.keys(pkg.scripts ?? {}))
      } catch {
        // unparseable package.json — no scripts menu
      }
    })
  }, [cwd])

  if (scripts.length === 0) return null
  return (
    <span className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Run an npm script in this terminal"
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-dim hover:bg-surface-2 hover:text-text"
      >
        <Play size={12} />
        Scripts
      </button>
      {open && (
        <div className="pop-in absolute right-0 top-full z-20 mt-1 max-h-64 w-48 overflow-y-auto rounded-xl border border-border bg-surface-2 py-1 shadow-xl">
          {scripts.map((name) => (
            <button
              key={name}
              onClick={() => {
                setOpen(false)
                onRun()
                void terms.runInTerminal(tabId, cwd, `npm run ${name}`)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text hover:bg-accent-dim/30 hover:text-accent"
            >
              <Play size={10} className="shrink-0 text-accent" />
              {name}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/** Shell(s) in the project folder. Terminals live in a module-level registry so
 *  they keep running (scrollback and all) when the panel closes or you switch
 *  sessions. Includes a Ports view of everything listening on localhost. */
export function TerminalPanel({ tabId, cwd }: { tabId: string; cwd: string }): React.JSX.Element {
  useSyncExternalStore(terms.subscribe, () => terms.version)
  const [view, setView] = useState<'term' | 'ports'>('term')
  const hostRef = useRef<HTMLDivElement>(null)
  const tab = terms.getTab(tabId)
  const active = tab.entries[tab.active]

  // First open for this session → spawn the initial shell.
  useEffect(() => {
    if (terms.getTab(tabId).entries.length === 0) void terms.createTerm(tabId, cwd)
  }, [tabId, cwd])

  // Adopt the active terminal's DOM node (it survives unmounts detached).
  useEffect(() => {
    const host = hostRef.current
    if (!host || view !== 'term' || !active) return
    host.replaceChildren(active.el)
    terms.resizeTerm(active)
    active.term.focus()

    const observer = new ResizeObserver(() => terms.resizeTerm(active))
    observer.observe(host)
    return () => {
      observer.disconnect()
      // Detach, don't dispose — the terminal keeps running for next time.
      if (active.el.parentElement === host) host.removeChild(active.el)
    }
  }, [view, active])

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-[#0a0a0a]">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-sm font-medium">
        <SquareTerminal size={15} className="mx-1 shrink-0 text-text-dim" />
        {tab.entries.map((entry, i) => (
          <span
            key={entry.key}
            onClick={() => {
              setView('term')
              terms.setActive(tabId, i)
            }}
            className={clsx(
              'group flex cursor-pointer items-center gap-1 rounded-lg px-2 py-0.5 text-xs',
              view === 'term' && i === tab.active
                ? 'bg-surface-2 text-text'
                : 'text-text-dim hover:text-text'
            )}
          >
            {entry.exited ? <span className="opacity-50">{i + 1}·done</span> : i + 1}
            <button
              onClick={(e) => {
                e.stopPropagation()
                terms.closeTerm(tabId, i)
              }}
              title="Close terminal"
              className="rounded p-0.5 opacity-0 hover:bg-border group-hover:opacity-100"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <button
          onClick={() => {
            setView('term')
            void terms.createTerm(tabId, cwd)
          }}
          title="New terminal"
          className="rounded-lg p-1 text-text-dim hover:bg-surface-2 hover:text-text"
        >
          <Plus size={13} />
        </button>
        <span className="ml-auto flex items-center gap-0.5">
          <ScriptsMenu tabId={tabId} cwd={cwd} onRun={() => setView('term')} />
          <button
            onClick={() => setView(view === 'ports' ? 'term' : 'ports')}
            title="Ports listening on localhost"
            className={clsx(
              'flex items-center gap-1 rounded-lg px-2 py-1 text-xs',
              view === 'ports' ? 'bg-accent/15 text-accent' : 'text-text-dim hover:bg-surface-2 hover:text-text'
            )}
          >
            <Globe size={12} />
            Ports
          </button>
        </span>
      </div>

      {view === 'ports' ? (
        <PortsView />
      ) : active?.failed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-text-dim">
            The embedded terminal isn&apos;t available on this machine.
          </p>
          <button
            onClick={() => terms.openExternalTerminal(cwd)}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dim"
          >
            <ExternalLink size={14} />
            Open a terminal window here
          </button>
        </div>
      ) : active ? (
        <div ref={hostRef} className="min-h-0 flex-1 p-2" />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <RefreshCw size={14} className="animate-spin text-text-dim" />
        </div>
      )}
    </div>
  )
}
