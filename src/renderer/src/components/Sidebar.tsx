import { useState } from 'react'
import {
  Plus,
  X,
  Loader2,
  GitBranch,
  BarChart3,
  Settings2,
  BellRing,
  CheckCircle2,
  Columns2,
  PictureInPicture2,
  AlertCircle
} from 'lucide-react'
import clsx from 'clsx'
import type { SessionStatus } from '@shared/types'
import { closeTab, createTab, popOutTab, useSessions } from '../stores/sessions'
import { useUi } from '../stores/ui'
import { LimitBars } from './LimitBars'
import { SessionList } from './SessionSidebar'
import { alertDialog } from '../lib/dialogs'

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

function agoShort(ms?: number): string {
  if (!ms) return ''
  const mins = Math.floor((Date.now() - ms) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

type OpenEntry = { tab: import('../stores/sessions').TabState; label: string }

/** Group open tabs by project, needs-input first, with UNIQUE labels —
 *  untitled chats become "New chat", "New chat 2", … within their project. */
function groupOpenTabs(tabs: import('../stores/sessions').TabState[]): [string, OpenEntry[]][] {
  const byCwd = new Map<string, OpenEntry[]>()
  for (const tab of tabs) {
    const list = byCwd.get(tab.cwd) ?? []
    list.push({ tab, label: tab.title ?? '' })
    byCwd.set(tab.cwd, list)
  }
  for (const list of byCwd.values()) {
    let untitled = 0
    const seen = new Map<string, number>()
    for (const entry of list) {
      if (!entry.label) {
        untitled++
        entry.label = untitled === 1 ? 'New chat' : `New chat ${untitled}`
      } else {
        // Two chats that started with the same prompt get numbered too.
        const n = (seen.get(entry.label) ?? 0) + 1
        seen.set(entry.label, n)
        if (n > 1) entry.label = `${entry.label} (${n})`
      }
    }
    list.sort((a, b) => {
      const aNeeds = a.tab.status === 'awaitingApproval' ? 0 : 1
      const bNeeds = b.tab.status === 'awaitingApproval' ? 0 : 1
      return aNeeds - bNeeds
    })
  }
  return [...byCwd.entries()]
}

/** Icon + accessible label for a session's live state, so the Open list reads
 *  at a glance: working / needs you / ready / error. */
function statusMeta(status: SessionStatus): { icon: React.ReactNode; label: string } {
  switch (status) {
    case 'streaming':
      return {
        icon: <Loader2 size={12} className="shrink-0 animate-spin text-accent" />,
        label: 'Working…'
      }
    case 'awaitingApproval':
      return {
        icon: <BellRing size={12} className="shrink-0 text-amber-400" />,
        label: 'Needs your approval'
      }
    case 'error':
      return {
        icon: <AlertCircle size={12} className="shrink-0 text-red-400" />,
        label: 'Error'
      }
    case 'starting':
      return {
        icon: <Loader2 size={12} className="shrink-0 animate-spin text-text-dim" />,
        label: 'Starting…'
      }
    case 'idle':
    default:
      return {
        icon: <CheckCircle2 size={12} className="shrink-0 text-green-500/80" />,
        label: 'Ready'
      }
  }
}

export function Sidebar({
  changesOpen,
  onToggleChanges,
  onShowUsage,
  onShowSettings
}: {
  changesOpen: boolean
  onToggleChanges: () => void
  onShowUsage: () => void
  onShowSettings: () => void
}): React.JSX.Element {
  const allTabs = useSessions((s) => s.tabs)
  const tabs = allTabs.filter((t) => !t.side)
  const activeTabId = useSessions((s) => s.activeTabId)
  const setActive = useSessions((s) => s.setActive)
  const [opening, setOpening] = useState(false)
  const split = useUi((s) => s.split)
  const setSplit = useUi((s) => s.setSplit)
  const openGroups = groupOpenTabs(tabs)

  const newSession = async (): Promise<void> => {
    const cwd = await window.api.invoke('dialog:pickFolder')
    if (!cwd) return
    setOpening(true)
    try {
      await createTab(cwd)
    } catch (err) {
      void alertDialog(err instanceof Error ? err.message : String(err))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-border/60 bg-bg">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="brand-float flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-sm">
          🐚
        </span>
        <span className="text-sm font-semibold tracking-tight">Seashell</span>
      </div>

      {/* Open a project (a folder on disk) — starts its first session */}
      <div className="px-3 pb-2">
        <button
          onClick={() => void newSession()}
          disabled={opening}
          title="Pick a project folder — opens a session in it"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white shadow-lg shadow-accent/10 hover:bg-accent-dim disabled:opacity-50"
        >
          {opening ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Plus size={15} />
          )}
          Open project
        </button>
      </div>

      {/* Open sessions, grouped under their project. Sessions needing input
          always surface first within their group. */}
      {tabs.length > 0 && (
        <div className="px-3 pt-2">
          <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-dim/70">
            Open
          </div>
          {openGroups.map(([cwd, list]) => (
            <div key={cwd} className="pb-1.5">
              <div className="flex items-center gap-1.5 px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50">
                <span className="truncate">{basename(cwd)}</span>
              </div>
              <div className="space-y-0.5">
                {list.map(({ tab, label }) => {
                  const active = tab.tabId === activeTabId
                  const needsInput = tab.status === 'awaitingApproval'
                  const meta = statusMeta(tab.status)
                  return (
                    <div
                      key={tab.tabId}
                      data-testid="tab"
                      onClick={() => setActive(tab.tabId)}
                      title={`${label} — ${meta.label}\n${tab.cwd}`}
                      className={clsx(
                        'group ml-1.5 flex cursor-pointer items-center gap-2 rounded-lg border-l-2 py-1 pl-2 pr-1.5 text-sm transition-colors',
                        needsInput
                          ? 'border-amber-400/60'
                          : active
                            ? 'border-accent'
                            : 'border-border/50',
                        active
                          ? 'bg-surface-2 text-text'
                          : 'text-text-dim hover:bg-surface hover:text-text'
                      )}
                    >
                      {meta.icon}
                      <span className="min-w-0 flex-1 truncate text-[13px] leading-tight">
                        {label}
                      </span>
                      {needsInput ? (
                        <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 group-hover:hidden">
                          Needs you
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] tabular-nums text-text-dim/50 group-hover:hidden">
                          {tab.status === 'streaming' ? 'now' : agoShort(tab.lastActiveAt)}
                        </span>
                      )}
                      <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setSplit(tab.tabId)
                          }}
                          title={split === tab.tabId ? 'Close split view' : 'Open side-by-side with the active session'}
                          className={clsx('rounded p-0.5 hover:bg-border', split === tab.tabId && 'text-accent')}
                        >
                          <Columns2 size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void popOutTab(tab)
                          }}
                          title="Pop out into its own window"
                          className="rounded p-0.5 hover:bg-border"
                        >
                          <PictureInPicture2 size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            closeTab(tab.tabId)
                          }}
                          title="Close session"
                          className="rounded p-0.5 hover:bg-border"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent history */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col px-1.5">
        <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-dim/70">
          Projects
        </div>
        <SessionList compact />
      </div>

      {/* Plan usage bars (5h / weekly), like Claude Desktop */}
      <div className="border-t border-border/60 px-3 py-2">
        <LimitBars />
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
        <button
          onClick={onToggleChanges}
          title="File changes (git)"
          className={clsx(
            'flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] hover:bg-surface',
            changesOpen ? 'text-accent' : 'text-text-dim hover:text-text'
          )}
        >
          <GitBranch size={15} />
          Changes
        </button>
        <button
          onClick={onShowUsage}
          title="Usage & cost"
          className="flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] text-text-dim hover:bg-surface hover:text-text"
        >
          <BarChart3 size={15} />
          Usage
        </button>
        <button
          onClick={onShowSettings}
          title="Settings"
          className="flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] text-text-dim hover:bg-surface hover:text-text"
        >
          <Settings2 size={15} />
          Settings
        </button>
      </div>
    </div>
  )
}
