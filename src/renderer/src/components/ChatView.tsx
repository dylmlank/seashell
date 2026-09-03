import { useEffect, useMemo, useState } from 'react'
import {
  Blocks,
  BookOpen,
  Brain,
  Code2,
  Eye,
  Folder,
  FolderTree,
  Gauge,
  History,
  MessagesSquare,
  Plug,
  Radar,
  SquareTerminal,
  Waypoints,
  X
} from 'lucide-react'
import clsx from 'clsx'
import { contextWindow } from '../lib/models'
import { dispatchMessage, mergeSuggestions, useCommands } from '../stores/commands'
import { closeTab, interrupt, useSessions, type TabState } from '../stores/sessions'
import { useUi, type SidePanel } from '../stores/ui'
import { alertDialog, confirmDialog } from '../lib/dialogs'

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}
import { Checkpoints } from './Checkpoints'
import { Composer } from './Composer'
import { ContextPopover } from './ContextPopover'
import { EditorPane } from './EditorPane'
import { FileExplorer } from './FileExplorer'
import { InstructionsModal } from './InstructionsModal'
import { MemoryPanel } from './MemoryPanel'
import { MissionControlPanel } from './MissionControlPanel'
import { MessageList } from './MessageList'
import { PreviewPanel } from './PreviewPanel'
import { SidePanelShell } from './Resizable'
import { SessionInfoPanel } from './SessionInfoPanel'
import { SideChatPanel } from './SideChatPanel'
import { TerminalPanel } from './TerminalPanel'
import { WorkflowPanel } from './WorkflowPanel'

type PanelId = Exclude<SidePanel, null>

interface PanelDef {
  id: PanelId
  label: string
  Icon: typeof FolderTree
  title: string
}

/** The workspace panels, grouped by what you'd open them for.
 *
 *  Nine peers in a flat strip is the whole reason this row read as clutter —
 *  there was no signal that Files/Editor/Terminal are one activity and
 *  Workflow/Memory/Checkpoints are another. Declared as data rather than nine
 *  near-identical JSX blocks so adding a tenth is one line, not a copy-paste.
 */
const PANEL_GROUPS: PanelDef[][] = [
  [
    { id: 'files', label: 'Files', Icon: FolderTree, title: 'Project files (Ctrl+B)' },
    {
      id: 'editor',
      label: 'Editor',
      Icon: Code2,
      title: 'Code editor — open files from the Files panel or Ctrl+P'
    },
    {
      id: 'terminal',
      label: 'Terminal',
      Icon: SquareTerminal,
      title: 'Terminal in this folder (Ctrl+`)'
    }
  ],
  [
    {
      id: 'workflow',
      label: 'Workflow',
      Icon: Waypoints,
      title: 'How this project fits together — modules, API calls, composition'
    },
    {
      id: 'memory',
      label: 'Memory',
      Icon: Brain,
      title: "What Claude remembers about this project — written by the retrospective after each turn, so it's empty until one has run"
    },
    {
      id: 'checkpoints',
      label: 'Checkpoints',
      Icon: History,
      title: 'Checkpoints — restore your files to any earlier turn'
    }
  ],
  [
    {
      id: 'preview',
      label: 'Preview',
      Icon: Eye,
      title: 'Live preview — your dev server or the last file Claude wrote'
    },
    {
      id: 'sidechat',
      label: 'Side chat',
      Icon: MessagesSquare,
      title: 'Side chat — a separate conversation for quick questions'
    },
    {
      id: 'mission',
      label: 'Mission',
      Icon: Radar,
      title: 'Mission control — every project on your drive, its git state and its agent'
    }
  ]
]

export function ChatView({ tab }: { tab: TabState }): React.JSX.Element {
  const streaming = tab.status === 'streaming'
  const busy = streaming || tab.status === 'awaitingApproval'
  const panel = useUi((s) => s.panels[tab.tabId] ?? null)
  const togglePanel = useUi((s) => s.togglePanel)
  const setPanel = (p: Exclude<Parameters<typeof togglePanel>[1], null>): void =>
    togglePanel(tab.tabId, p)
  const [infoOpen, setInfoOpen] = useState(false)
  const [merging, setMerging] = useState(false)

  const dropQueued = (index: number): void => {
    useSessions.getState().update(tab.tabId, {
      queue: (tab.queue ?? []).filter((_, i) => i !== index)
    })
  }

  const mergeWorktree = async (): Promise<void> => {
    if (!(await confirmDialog(`Merge branch ${tab.worktree?.branch} into the main checkout and remove this worktree? This session closes afterwards.`))) return
    setMerging(true)
    const result = await window.api.invoke('worktree:merge', { tabId: tab.tabId })
    setMerging(false)
    if ('error' in result) {
      void alertDialog(`Merge failed: ${result.error}`)
      return
    }
    closeTab(tab.tabId)
  }
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [seenArtifact, setSeenArtifact] = useState<string | undefined>()

  // Load this project's custom slash commands and merge them with the app's
  // native commands and the SDK's builtins for the composer autocomplete.
  const loadCommands = useCommands((s) => s.load)
  const userCommands = useCommands((s) => s.byTab[tab.tabId])
  useEffect(() => {
    void loadCommands(tab.tabId)
  }, [tab.tabId, loadCommands])
  const suggestions = useMemo(
    () => mergeSuggestions(userCommands, tab.slashCommands),
    [userCommands, tab.slashCommands]
  )

  const statusDot =
    tab.status === 'error' ? 'bg-red-500' : busy ? 'bg-accent pulse-dot' : 'bg-green-600/80'

  const headerBtn = (active: boolean): string =>
    clsx(
      'flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-surface-2',
      active ? 'text-accent' : 'text-text-dim hover:text-text'
    )

  // The workspace panel buttons — bordered, in their own row below the header.
  const tabBtn = (active: boolean): string =>
    clsx(
      'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all',
      active
        ? 'border-accent bg-accent/15 text-accent shadow-md shadow-accent/20'
        : 'border-border bg-surface/70 text-text-dim hover:-translate-y-px hover:border-accent-dim/70 hover:text-text'
    )

  return (
    <div className="chat-wash flex h-full flex-col">
      <div className="relative flex items-center gap-3 border-b border-border/40 px-4 py-2.5 text-xs text-text-dim">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${statusDot}`} />
          <button
            onClick={() => void window.api.invoke('project:open', { tabId: tab.tabId, app: 'explorer' })}
            onAuxClick={() => void window.api.invoke('project:open', { tabId: tab.tabId, app: 'vscode' })}
            title={`${tab.cwd}\nClick: open in Explorer · Middle-click: open in VS Code`}
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-surface-2 hover:text-text"
          >
            <Folder size={13} />
            <span className="max-w-48 truncate font-mono">{basename(tab.cwd)}</span>
          </button>
        </span>
        {busy && tab.liveTokens !== undefined && (
          <span className="tabular-nums text-accent" title="Output tokens generated so far this turn">
            {tab.liveTokens >= 1000 ? `${(tab.liveTokens / 1000).toFixed(1)}k` : tab.liveTokens}{' '}
            tokens
          </span>
        )}
        {tab.provider === 'openrouter' && (
          <span
            title="This session runs through OpenRouter and bills your OpenRouter credits, not your Claude subscription."
            className="rounded-md bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
          >
            OpenRouter
          </span>
        )}
        {tab.provider === 'custom' && (
          <span
            title="This session runs against your custom endpoint, not your Claude subscription."
            className="rounded-md bg-violet-900/40 px-1.5 py-0.5 text-[10px] font-medium text-violet-300"
          >
            Custom API
          </span>
        )}
        {tab.worktree && (
          <span className="flex items-center gap-1">
            <span
              title={`Isolated git worktree on branch ${tab.worktree.branch} — the main checkout is untouched until you merge.`}
              className="rounded-md bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
            >
              Worktree
            </span>
            <button
              onClick={() => void mergeWorktree()}
              disabled={merging}
              title="Merge this worktree's changes into the main checkout and remove it"
              className="rounded-md border border-emerald-700/50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
            >
              {merging ? 'Merging…' : 'Merge back'}
            </button>
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {(tab.contextUsage ?? tab.usage) && (
            <button
              onClick={() => setContextOpen(true)}
              title={
                tab.contextUsage
                  ? `Context: ${(tab.contextUsage.totalTokens / 1000).toFixed(0)}k of ${(tab.contextUsage.maxTokens / 1000).toFixed(0)}k (${tab.contextUsage.percentage.toFixed(0)}%) — click for the breakdown`
                  : 'Context window fill — click for the breakdown'
              }
              className="mr-1.5 flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 hover:bg-surface-2 hover:text-text"
            >
              {/* Labelled: as a bare bar with a number beside it, nobody read
                  this as the context tracker — it looked like a progress
                  indicator for whatever was streaming. */}
              <Gauge size={13} className="shrink-0" />
              <span className="hidden sm:inline">Context</span>
              <span className="h-1 w-16 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-accent transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      tab.contextUsage
                        ? tab.contextUsage.percentage
                        : ((tab.usage?.lastContextTokens ?? 0) / contextWindow(tab.model)) * 100
                    )}%`
                  }}
                />
              </span>
              <span className="tabular-nums">
                {((tab.contextUsage?.totalTokens ?? tab.usage?.lastContextTokens ?? 0) / 1000).toFixed(0)}k
                {tab.contextUsage && (
                  <span className="text-text-dim/60">
                    /{(tab.contextUsage.maxTokens / 1000).toFixed(0)}k
                  </span>
                )}
              </span>
            </button>
          )}
          <button
            onClick={() => setInstructionsOpen(true)}
            title="Edit instructions for Claude (CLAUDE.md)"
            className={headerBtn(false)}
          >
            <BookOpen size={14} />
          </button>
          <button
            onClick={() => useUi.getState().setMcpManager(true)}
            title="MCP servers — add, configure and test this project's connectors"
            className={headerBtn(false)}
          >
            <Plug size={14} />
          </button>
          <button
            onClick={() => setInfoOpen(true)}
            title="MCP servers, skills, and tools loaded in this session"
            className={headerBtn(false)}
          >
            <Blocks size={14} />
          </button>
        </span>
      </div>

      {/* Workspace panels get their own row.
          They used to be absolutely centred in the header, which overlapped
          the status text and the icon cluster the moment a worktree badge or a
          long model name showed up — and two of the nine (Mission, Memory)
          were unlabelled icons stranded on the right, which is why they read
          as broken rather than merely unvisited. One strip, one treatment,
          grouped by what they're for, scrolling instead of colliding. */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-1.5">
        {PANEL_GROUPS.map((group, gi) => (
          <div key={gi} className="flex items-center gap-1">
            {gi > 0 && <span className="mx-1.5 h-4 w-px shrink-0 bg-border" />}
            {group.map(({ id, label, Icon, title }) => (
              <button
                key={id}
                onClick={() => {
                  if (id === 'preview') setSeenArtifact(tab.lastArtifact)
                  setPanel(id)
                }}
                title={title}
                className={clsx(tabBtn(panel === id), 'relative shrink-0')}
              >
                <Icon size={14} />
                {label}
                {id === 'preview' &&
                  panel !== 'preview' &&
                  tab.lastArtifact &&
                  tab.lastArtifact !== seenArtifact && (
                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
                  )}
              </button>
            ))}
          </div>
        ))}
      </div>

      {tab.error && (
        <div className="border-b border-red-900 bg-red-950/50 px-4 py-2 text-sm text-red-300">
          {tab.error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList items={tab.items} tabId={tab.tabId} />

          {(tab.queue?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-6 pb-1 text-[11px] text-text-dim">
              <span className="font-medium">Queued:</span>
              {tab.queue!.map((q, i) => (
                <span
                  key={i}
                  title={q.text}
                  className="flex max-w-56 items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5"
                >
                  <span className="truncate">{q.text}</span>
                  <button
                    onClick={() => dropQueued(i)}
                    title="Remove from queue"
                    className="shrink-0 rounded-full p-0.5 hover:bg-border hover:text-red-400"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <Composer
            tabId={tab.tabId}
            disabled={tab.status === 'error'}
            streaming={streaming || tab.status === 'awaitingApproval'}
            slashCommands={suggestions}
            onSend={(text, images) =>
              void dispatchMessage(tab.tabId, text, images.length ? images : undefined)
            }
            onStop={() => interrupt(tab.tabId)}
          />
        </div>
        {panel === 'files' && (
          <SidePanelShell storageKey="files" defaultWidth={300}>
            <FileExplorer tabId={tab.tabId} />
          </SidePanelShell>
        )}
        {panel === 'editor' && (
          <SidePanelShell storageKey="editor" defaultWidth={680}>
            <EditorPane tabId={tab.tabId} />
          </SidePanelShell>
        )}
        {panel === 'terminal' && (
          <SidePanelShell storageKey="terminal" defaultWidth={520}>
            <TerminalPanel tabId={tab.tabId} cwd={tab.cwd} />
          </SidePanelShell>
        )}
        {panel === 'sidechat' && (
          <SidePanelShell storageKey="sidechat" defaultWidth={440}>
            <SideChatPanel cwd={tab.cwd} />
          </SidePanelShell>
        )}
        {panel === 'preview' && (
          <SidePanelShell storageKey="preview" defaultWidth={520}>
            <PreviewPanel path={tab.lastArtifact} cwd={tab.cwd} tabId={tab.tabId} />
          </SidePanelShell>
        )}
        {panel === 'memory' && (
          <SidePanelShell storageKey="memory" defaultWidth={340}>
            <MemoryPanel tabId={tab.tabId} />
          </SidePanelShell>
        )}
        {panel === 'workflow' && (
          <SidePanelShell storageKey="workflow" defaultWidth={620}>
            <WorkflowPanel tabId={tab.tabId} />
          </SidePanelShell>
        )}
        {panel === 'mission' && (
          <SidePanelShell storageKey="mission" defaultWidth={380}>
            <MissionControlPanel />
          </SidePanelShell>
        )}
        {panel === 'checkpoints' && (
          <SidePanelShell storageKey="checkpoints" defaultWidth={380}>
            <Checkpoints tabId={tab.tabId} />
          </SidePanelShell>
        )}
      </div>

      {infoOpen && <SessionInfoPanel tab={tab} onClose={() => setInfoOpen(false)} />}
      {instructionsOpen && (
        <InstructionsModal tabId={tab.tabId} onClose={() => setInstructionsOpen(false)} />
      )}
      {contextOpen && <ContextPopover tabId={tab.tabId} onClose={() => setContextOpen(false)} />}
    </div>
  )
}
