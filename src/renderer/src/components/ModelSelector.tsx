import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu, Search } from 'lucide-react'
import type { ModelInfo } from '@shared/types'
import { useSessions } from '../stores/sessions'

export function ModelSelector({ tabId }: { tabId: string }): React.JSX.Element | null {
  const model = useSessions((s) => s.tabs.find((t) => t.tabId === tabId)?.model)
  const provider = useSessions(
    (s) => s.tabs.find((t) => t.tabId === tabId)?.provider ?? 'anthropic'
  )
  const [models, setModels] = useState<ModelInfo[]>([])
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      if (provider === 'openrouter') {
        const result = await window.api.invoke('providers:listOpenRouterModels')
        if (alive && Array.isArray(result)) setModels(result)
      } else {
        const list = await window.api.invoke('session:supportedModels', { tabId })
        if (alive) setModels(list)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [tabId, provider])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const searchable = provider === 'openrouter'
  const shown = useMemo(() => {
    if (!searchable) return models
    const needle = filter.trim().toLowerCase()
    const list = needle
      ? models.filter(
          (m) => m.id.toLowerCase().includes(needle) || m.displayName.toLowerCase().includes(needle)
        )
      : models
    return list.slice(0, 40)
  }, [models, filter, searchable])

  if (models.length === 0) return null

  // The session reports a concrete model id; the list may use aliases.
  const current = models.find((m) => m.id === model)
  const label = current?.displayName ?? model ?? 'default'

  const pick = (id: string): void => {
    setOpen(false)
    setFilter('')
    if (id === current?.id) return
    useSessions.getState().update(tabId, { model: id })
    void window.api.invoke('session:setModel', { tabId, model: id })
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Model"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-dim hover:bg-surface-2 hover:text-text"
      >
        <Cpu size={12} className="opacity-70" />
        <span className="max-w-36 truncate">{label}</span>
        <ChevronDown size={12} className={'transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {open && (
        <div className="pop-in absolute bottom-full left-0 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-surface-2 py-1 shadow-2xl shadow-black/50">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
              <Search size={12} className="shrink-0 text-text-dim" />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Search ${models.length} models…`}
                className="w-full bg-transparent text-sm outline-none placeholder:text-text-dim"
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {shown.map((m) => (
              <button
                key={m.id}
                onClick={() => pick(m.id)}
                title={m.id}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-border/50"
              >
                <span className="flex-1 truncate">{m.displayName}</span>
                {m.id === current?.id && <Check size={13} className="shrink-0 text-accent" />}
              </button>
            ))}
            {shown.length === 0 && (
              <p className="px-3 py-2 text-xs text-text-dim">No models match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
