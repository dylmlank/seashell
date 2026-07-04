import { useEffect, useState } from 'react'
import { Globe, Loader2, RefreshCw, Sparkles, Waypoints } from 'lucide-react'
import type { ProjectExplanation, ProjectMap } from '@shared/types'

const fmt = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** Module dependency diagram: nodes on a circle, edges weighted by imports. */
function ModuleGraph({ map }: { map: ProjectMap }): React.JSX.Element {
  const W = 560
  const H = 380
  const cx = W / 2
  const cy = H / 2
  const r = Math.min(W, H) / 2 - 58

  const nodes = map.modules.map((m, i) => {
    const angle = (i / map.modules.length) * Math.PI * 2 - Math.PI / 2
    return {
      ...m,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle)
    }
  })
  const byName = new Map(nodes.map((n) => [n.name, n]))
  const maxEdge = Math.max(1, ...map.edges.map((e) => e.count))
  const maxLines = Math.max(1, ...nodes.map((n) => n.lines))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--color-accent)" opacity="0.6" />
        </marker>
      </defs>
      {map.edges.map((edge) => {
        const a = byName.get(edge.from)
        const b = byName.get(edge.to)
        if (!a || !b) return null
        // Shorten toward the target so the arrowhead lands outside the node box.
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.hypot(dx, dy) || 1
        const tx = b.x - (dx / len) * 40
        const ty = b.y - (dy / len) * 18
        return (
          <line
            key={`${edge.from}-${edge.to}`}
            x1={a.x}
            y1={a.y}
            x2={tx}
            y2={ty}
            stroke="var(--color-accent)"
            strokeWidth={0.6 + (edge.count / maxEdge) * 2.4}
            opacity={0.25 + (edge.count / maxEdge) * 0.5}
            markerEnd="url(#arrow)"
          />
        )
      })}
      {nodes.map((n) => (
        <g key={n.name}>
          <rect
            x={n.x - 46}
            y={n.y - 15}
            width={92}
            height={30}
            rx={9}
            fill="var(--color-surface-2)"
            stroke="var(--color-accent)"
            strokeOpacity={0.25 + (n.lines / maxLines) * 0.6}
          />
          <text x={n.x} y={n.y - 2} textAnchor="middle" fontSize="10" fill="var(--color-text)" fontFamily="Consolas,monospace">
            {n.name.length > 15 ? `${n.name.slice(0, 14)}…` : n.name}
          </text>
          <text x={n.x} y={n.y + 10} textAnchor="middle" fontSize="8" fill="var(--color-text-dim)">
            {fmt(n.lines)} loc · {n.files}f
          </text>
        </g>
      ))}
    </svg>
  )
}

/** Where the code talks to the outside world: app → services with call counts. */
function ExternalsGraph({ map }: { map: ProjectMap }): React.JSX.Element {
  const rows = map.externals
  const H = Math.max(120, rows.length * 44 + 20)
  const W = 560
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <rect x={10} y={H / 2 - 22} width={120} height={44} rx={12} fill="var(--color-accent)" opacity={0.15} stroke="var(--color-accent)" />
      <text x={70} y={H / 2 - 2} textAnchor="middle" fontSize="12" fill="var(--color-text)" fontWeight="600">
        your app
      </text>
      <text x={70} y={H / 2 + 12} textAnchor="middle" fontSize="8" fill="var(--color-text-dim)">
        {fmt(map.totalLines)} lines
      </text>
      {rows.map((ext, i) => {
        const y = 30 + i * 44
        return (
          <g key={ext.host}>
            <path
              d={`M 130 ${H / 2} C 230 ${H / 2}, 230 ${y}, 320 ${y}`}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={1 + Math.min(3, ext.count / 3)}
              opacity="0.45"
            />
            <rect x={320} y={y - 15} width={228} height={32} rx={9} fill="var(--color-surface-2)" stroke="var(--color-border)" />
            <text x={332} y={y - 1} fontSize="10" fill="var(--color-text)" fontFamily="Consolas,monospace">
              {ext.host.length > 32 ? `${ext.host.slice(0, 31)}…` : ext.host}
            </text>
            <text x={332} y={y + 11} fontSize="8" fill="var(--color-text-dim)">
              {ext.kind === 'ws' ? 'websocket' : 'http'} · {ext.count} reference{ext.count > 1 ? 's' : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Vertical flow diagram: what happens step by step when the project runs. */
function FlowDiagram({ flow }: { flow: ProjectExplanation['flow'] }): React.JSX.Element {
  return (
    <div className="relative space-y-2 pl-1">
      {/* spine connecting the step markers */}
      <span className="absolute bottom-5 left-[15px] top-5 w-px bg-accent/30" />
      {flow.map((step, i) => (
        <div key={step.title} className="relative flex items-start gap-3">
          <span className="z-10 mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-bg text-xs font-semibold text-accent">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 rounded-xl border border-border/60 bg-bg px-3 py-2">
            <p className="text-xs font-medium">{step.title}</p>
            <p className="pt-0.5 text-[11px] leading-snug text-text-dim">{step.detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Claude-written "how it actually works" — summary, flow diagram, parts,
 *  and what sets the project apart. Cached; generating spends one call. */
function HowItWorks({ tabId }: { tabId: string }): React.JSX.Element {
  const [explanation, setExplanation] = useState<ProjectExplanation | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.invoke('project:explain', { tabId }).then((result) => {
      if (!('error' in result)) setExplanation(result.explanation)
    })
  }, [tabId])

  const generate = async (): Promise<void> => {
    setGenerating(true)
    setError(null)
    const result = await window.api.invoke('project:explain', { tabId, refresh: true })
    setGenerating(false)
    if ('error' in result) setError(result.error)
    else setExplanation(result.explanation)
  }

  if (explanation === null) {
    return (
      <div className="rounded-xl border border-border/60 bg-bg p-4">
        <p className="text-xs text-text-dim">
          Get a plain-language walkthrough of how this project actually works — what happens step
          by step, the main parts, and what makes it different.
        </p>
        {error && <p className="pt-2 text-xs text-red-400">{error}</p>}
        <button
          onClick={() => void generate()}
          disabled={generating}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-60"
        >
          {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {generating ? 'Asking Claude…' : 'Explain how it works'}
        </button>
        {!generating && (
          <p className="pt-1.5 text-[10px] text-text-dim/60">
            One Claude call. After that it stays current on its own — regenerating when the
            project changes — and is saved to this project&apos;s memory, so new sessions start
            already knowing how it works.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-accent/25 bg-accent/5 px-3 py-2.5 text-xs leading-relaxed">
        {explanation.summary}
      </p>

      <div>
        <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
          What happens, step by step
        </p>
        <FlowDiagram flow={explanation.flow} />
      </div>

      <div>
        <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
          The moving parts
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {explanation.parts.map((part) => (
            <div key={part.name} className="rounded-xl border border-border/60 bg-bg px-3 py-2">
              <p className="text-xs font-medium text-accent">{part.name}</p>
              <p className="pt-0.5 text-[11px] leading-snug text-text-dim">{part.role}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
          What makes it different
        </p>
        <ul className="space-y-1">
          {explanation.different.map((point) => (
            <li key={point} className="flex items-start gap-1.5 text-[11px] leading-snug text-text-dim">
              <Sparkles size={11} className="mt-0.5 shrink-0 text-accent" />
              {point}
            </li>
          ))}
        </ul>
      </div>

      <p className="flex items-center gap-2 text-[10px] text-text-dim/50">
        {error && <span className="text-red-400">{error}</span>}
        Written by Claude · {new Date(explanation.generatedAt).toLocaleDateString()} ·
        auto-updates as the project changes · saved to project memory
        <button
          onClick={() => void generate()}
          disabled={generating}
          className="flex items-center gap-1 text-accent/80 hover:text-accent disabled:opacity-60"
        >
          {generating && <Loader2 size={10} className="animate-spin" />}
          {generating ? 'regenerating…' : 'Regenerate'}
        </button>
      </p>
    </div>
  )
}

/** The Workflow tab: how the project fits together, generated by static
 *  analysis of the code — stack, composition, module graph, external calls. */
export function WorkflowPanel({ tabId }: { tabId: string }): React.JSX.Element {
  const [map, setMap] = useState<ProjectMap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    const result = await window.api.invoke('project:map', { tabId })
    setLoading(false)
    if ('error' in result) setError(result.error)
    else setMap(result)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  const totalLangLines = Math.max(1, map?.languages.reduce((s, l) => s + l.lines, 0) ?? 1)

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
        <Waypoints size={15} className="text-accent" />
        Workflow
        <button
          onClick={() => void load()}
          title="Re-analyze the project"
          className="ml-auto rounded p-1 text-text-dim hover:bg-surface-2 hover:text-text"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : map === null ? (
          <div className="flex items-center gap-2 text-sm text-text-dim">
            <Loader2 size={14} className="animate-spin" /> Analyzing the project…
          </div>
        ) : (
          <>
            {/* Stack */}
            {map.stack.length > 0 && (
              <div>
                <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
                  Stack
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {map.stack.map((s) => (
                    <span key={s} className="rounded-lg border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* How it works — Claude-written narrative + flow diagram */}
            <div>
              <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
                How it works
              </p>
              <HowItWorks tabId={tabId} />
            </div>

            {/* Composition */}
            <div>
              <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
                Composition · {fmt(map.totalLines)} lines across {map.totalFiles} files
              </p>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                {map.languages.map((lang) => (
                  <span
                    key={lang.name}
                    title={`${lang.name}: ${fmt(lang.lines)} lines`}
                    style={{ width: `${(lang.lines / totalLangLines) * 100}%`, backgroundColor: lang.color }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1.5">
                {map.languages.slice(0, 6).map((lang) => (
                  <span key={lang.name} className="flex items-center gap-1.5 text-xs text-text-dim">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: lang.color }} />
                    {lang.name} <span className="text-text-dim/50">{fmt(lang.lines)}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Module graph */}
            {map.modules.length > 1 && (
              <div>
                <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
                  Module map · arrows = imports, thicker = more
                </p>
                <div className="rounded-xl border border-border/60 bg-bg p-2">
                  <ModuleGraph map={map} />
                </div>
              </div>
            )}

            {/* External calls */}
            <div>
              <p className="flex items-center gap-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
                <Globe size={11} />
                External calls · where requests go
              </p>
              {map.externals.length === 0 ? (
                <p className="text-xs text-text-dim">
                  No http/ws endpoints found in the code — this project keeps to itself.
                </p>
              ) : (
                <>
                  <div className="rounded-xl border border-border/60 bg-bg p-2">
                    <ExternalsGraph map={map} />
                  </div>
                  <div className="space-y-1 pt-2">
                    {map.externals.slice(0, 6).map((ext) => (
                      <p key={ext.host} className="truncate text-[11px] text-text-dim/70">
                        <span className="font-mono text-text-dim">{ext.host}</span> ← called from{' '}
                        {ext.files.join(', ')}
                      </p>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
