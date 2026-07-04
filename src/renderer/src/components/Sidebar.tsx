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
  AlertCircle
} from 'lucide-react'
import clsx from 'clsx'
import type { SessionStatus } from '@shared/types'
import { closeTab, createTab, useSessions } from '../stores/sessions'
import { LimitBars } from './LimitBars'
import { SessionList } from './SessionSidebar'
import { alertDialog } from '../lib/dialogs'

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
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
    <div className="flex w-64 shrink-0 flex-col border-r border-border/60 bg-[#0d0d0d]">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-sm text-accent">
          ✳
        </span>
        <span className="text-sm font-semibold tracking-tight">Claude Shell</span>
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

      {/* Open sessions */}
      {tabs.length > 0 && (
        <div className="px-3 pt-2">
          <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-dim/70">
            Open
          </div>
          <div className="space-y-0.5">
            {tabs.map((tab) => {
              const active = tab.tabId === activeTabId
              const needsInput = tab.status === 'awaitingApproval'
              const meta = statusMeta(tab.status)
              return (
                <div
                  key={tab.tabId}
                  data-testid="tab"
                  onClick={() => setActive(tab.tabId)}
                  title={`${basename(tab.cwd)} — ${meta.label}\n${tab.cwd}`}
                  className={clsx(
                    'group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                    needsInput && !active && 'ring-1 ring-inset ring-amber-400/30',
                    active
                      ? 'bg-surface-2 text-text'
                      : 'text-text-dim hover:bg-surface hover:text-text'
                  )}
                >
                  {meta.icon}
                  <span className="min-w-0 flex-1 truncate">{basename(tab.cwd)}</span>
                  {needsInput && (
                    <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 group-hover:hidden">
                      Needs you
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.tabId)
                    }}
                    title="Close session"
                    className="shrink-0 rounded p-0.5 opacity-0 hover:bg-border group-hover:opacity-100"
                  >
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
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
