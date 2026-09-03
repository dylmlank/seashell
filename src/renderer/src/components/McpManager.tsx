import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Library, Loader2, Plug, Plus, Trash2, X, XCircle } from 'lucide-react'
import clsx from 'clsx'
import type { McpCheckResult, McpServerEntry } from '@shared/types'
import { availableCatalog, catalogToEntry } from '@shared/mcp-catalog'
import { useSessions } from '../stores/sessions'
import { useUi } from '../stores/ui'

const BLANK: McpServerEntry = { name: '', enabled: true, transport: 'stdio', command: '' }

/** Split a command line into argv, respecting quoted segments. Good enough for
 *  the `npx -y pkg --flag "two words"` shapes people paste in. */
function splitArgs(raw: string): string[] {
  return (raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^["']|["']$/g, ''))
}

function ServerForm({
  initial,
  previousName,
  onDone,
  onCancel
}: {
  initial: McpServerEntry
  previousName?: string
  onDone: (entry: McpServerEntry, previousName?: string) => Promise<string | null>
  onCancel: () => void
}): React.JSX.Element {
  const [entry, setEntry] = useState(initial)
  const [argsText, setArgsText] = useState((initial.args ?? []).join(' '))
  const [envText, setEnvText] = useState(
    Object.entries(initial.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (): Promise<void> => {
    setSaving(true)
    const env: Record<string, string> = {}
    for (const line of envText.split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    const built: McpServerEntry = {
      ...entry,
      name: entry.name.trim(),
      ...(entry.transport === 'stdio'
        ? { args: splitArgs(argsText), env }
        : { args: undefined, env: undefined })
    }
    const err = await onDone(built, previousName)
    setSaving(false)
    if (err) setError(err)
  }

  const field = 'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent-dim'

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-surface-2 p-3">
      <div className="flex gap-2">
        <input
          autoFocus
          value={entry.name}
          onChange={(e) => setEntry({ ...entry, name: e.target.value })}
          placeholder="Name (e.g. filesystem)"
          className={field}
        />
        <select
          value={entry.transport}
          onChange={(e) =>
            setEntry({ ...entry, transport: e.target.value as McpServerEntry['transport'] })
          }
          className="rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none"
        >
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
      </div>

      {entry.transport === 'stdio' ? (
        <>
          <input
            value={entry.command ?? ''}
            onChange={(e) => setEntry({ ...entry, command: e.target.value })}
            placeholder="Command (e.g. npx)"
            className={field}
          />
          <input
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder='Arguments (e.g. -y @modelcontextprotocol/server-filesystem "C:\My Docs")'
            className={field}
          />
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={'Environment, one KEY=value per line\nAPI_TOKEN=…'}
            rows={2}
            className={clsx(field, 'resize-y font-mono text-xs')}
          />
        </>
      ) : (
        <input
          value={entry.url ?? ''}
          onChange={(e) => setEntry({ ...entry, url: e.target.value })}
          placeholder="https://example.com/mcp"
          className={field}
        />
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-text-dim hover:text-text">
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          Save
        </button>
      </div>
    </div>
  )
}

/** Add, edit, enable and health-check the project's MCP servers.
 *
 *  Everything here reads and writes the project's own `.mcp.json`, so a server
 *  configured in Seashell works in a terminal `claude` session too — the same
 *  bargain the slash-command manager makes with `.claude/commands`.
 */
export function McpManager({ tabId, onClose }: { tabId: string; onClose: () => void }): React.JSX.Element {
  const [servers, setServers] = useState<McpServerEntry[]>([])
  const [path, setPath] = useState('')
  const [editing, setEditing] = useState<{ entry: McpServerEntry; previousName?: string } | null>(
    null
  )
  const [checks, setChecks] = useState<Record<string, McpCheckResult | 'running'>>({})
  const [browsing, setBrowsing] = useState(false)
  // Hide anything already configured — offering to add a server listed
  // directly above is just noise.
  const available = useMemo(() => availableCatalog(servers), [servers])
  const toast = useUi((s) => s.toast)

  // Servers the live session actually connected to, which is a different
  // question from what's configured — a server can be listed and still failing.
  const liveStatus = useSessions((s) => s.tabs.find((t) => t.tabId === tabId)?.mcpServers)

  const refresh = useCallback(async () => {
    const result = await window.api.invoke('mcp:list', { tabId })
    if ('error' in result) return
    setServers(result.servers)
    setPath(result.path)
  }, [tabId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async (entry: McpServerEntry, previousName?: string): Promise<string | null> => {
    const result = await window.api.invoke('mcp:save', { tabId, entry, previousName })
    if ('error' in result) return result.error
    setEditing(null)
    await refresh()
    toast(`Saved ${entry.name} — restart the session to load it`)
    return null
  }

  const toggle = async (entry: McpServerEntry): Promise<void> => {
    const result = await window.api.invoke('mcp:setEnabled', {
      tabId,
      name: entry.name,
      enabled: !entry.enabled
    })
    if ('error' in result) return toast(result.error, 'error')
    await refresh()
  }

  const remove = async (name: string): Promise<void> => {
    const result = await window.api.invoke('mcp:remove', { tabId, name })
    if ('error' in result) return toast(result.error, 'error')
    await refresh()
  }

  const check = async (name: string): Promise<void> => {
    setChecks((c) => ({ ...c, [name]: 'running' }))
    const result = await window.api.invoke('mcp:check', { tabId, name })
    setChecks((c) => ({
      ...c,
      [name]: 'error' in result ? { ok: false, detail: result.error } : result
    }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8">
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <Plug size={20} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="font-semibold">MCP servers</div>
            <div className="truncate text-xs text-text-dim" title={path}>
              {path}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-text-dim hover:bg-border hover:text-text"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {servers.length === 0 && !editing && (
            <p className="py-6 text-center text-sm text-text-dim">
              No MCP servers configured for this project yet.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {servers.map((s) => {
              const live = liveStatus?.find((l) => l.name.toLowerCase() === s.name.toLowerCase())
              const result = checks[s.name]
              return (
                <div key={s.name} className="rounded-xl border border-border bg-bg p-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void toggle(s)}
                      title={s.enabled ? 'Disable — moves it out of .mcp.json' : 'Enable'}
                      className={clsx(
                        'h-4 w-7 shrink-0 rounded-full transition-colors',
                        s.enabled ? 'bg-accent' : 'bg-border'
                      )}
                    >
                      <span
                        className={clsx(
                          'block h-3 w-3 rounded-full bg-white transition-transform',
                          s.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                        )}
                      />
                    </button>
                    <span className={clsx('font-medium', !s.enabled && 'text-text-dim')}>
                      {s.name}
                    </span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-dim">
                      {s.transport}
                    </span>
                    {live && (
                      <span className="text-[11px] text-text-dim">connected: {live.status}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      {s.transport === 'stdio' && (
                        <button
                          onClick={() => void check(s.name)}
                          className="rounded-lg border border-border px-2 py-1 text-xs text-text-dim hover:text-text"
                        >
                          {result === 'running' ? 'Checking…' : 'Test'}
                        </button>
                      )}
                      <button
                        onClick={() => setEditing({ entry: s, previousName: s.name })}
                        className="rounded-lg border border-border px-2 py-1 text-xs text-text-dim hover:text-text"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void remove(s.name)}
                        title="Remove"
                        className="rounded-lg p-1.5 text-text-dim hover:text-red-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="truncate pl-9 pt-1 font-mono text-xs text-text-dim">
                    {s.transport === 'stdio'
                      ? [s.command, ...(s.args ?? [])].join(' ')
                      : (s.url ?? '')}
                  </div>

                  {result && result !== 'running' && (
                    <div
                      className={clsx(
                        'flex items-start gap-1.5 pl-9 pt-1.5 text-xs',
                        result.ok ? 'text-green-400' : 'text-red-400'
                      )}
                    >
                      {result.ok ? (
                        <CheckCircle2 size={13} className="mt-px shrink-0" />
                      ) : (
                        <XCircle size={13} className="mt-px shrink-0" />
                      )}
                      <span className="min-w-0 break-words">{result.detail}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {editing && (
            <div className="pt-2">
              <ServerForm
                key={editing.previousName ?? 'new'}
                initial={editing.entry}
                previousName={editing.previousName}
                onDone={save}
                onCancel={() => setEditing(null)}
              />
            </div>
          )}
        </div>

        {browsing && (
          <div className="border-t border-border pt-3">
            <p className="pb-2 text-xs text-text-dim">
              A starting set of well-known servers. Adding one opens it in the editor first, so
              you can read the command — and fill in any path it needs — before it&apos;s saved.
            </p>
            {available.length === 0 ? (
              <p className="py-3 text-center text-sm text-text-dim">
                Everything in the catalog is already configured here.
              </p>
            ) : (
              <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                {available.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 rounded-xl border border-border bg-bg p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{item.title}</span>
                        {item.needsEditing && (
                          <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                            needs a path
                          </span>
                        )}
                      </div>
                      <p className="pt-0.5 text-xs text-text-dim">{item.blurb}</p>
                      <p className="truncate pt-1 font-mono text-[11px] text-text-dim/70">
                        {[item.command, ...item.args].join(' ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        onClick={() => {
                          setBrowsing(false)
                          setEditing({ entry: catalogToEntry(item) })
                        }}
                        className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-dim"
                      >
                        Add
                      </button>
                      {/* A plain anchor on purpose: api.ts intercepts every
                          http(s) link click and routes it through the
                          open_external command, so this opens in the real
                          browser rather than navigating the app's webview. */}
                      <a
                        href={item.docs}
                        className="text-[11px] text-text-dim hover:text-text"
                      >
                        Docs
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <p className="text-xs text-text-dim">
            Saved to the project&apos;s <code>.mcp.json</code>, so the CLI picks them up too.
            Disabling moves a server out of that file rather than flagging it, so nothing loads it.
          </p>
          {!editing && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                onClick={() => setBrowsing((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-dim hover:text-text"
              >
                <Library size={14} /> {browsing ? 'Hide catalog' : 'Browse'}
              </button>
              <button
                onClick={() => {
                  setBrowsing(false)
                  setEditing({ entry: BLANK })
                }}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dim"
              >
                <Plus size={14} /> Add server
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
