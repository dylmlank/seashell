import { useState } from 'react'
import {
  Blocks,
  BookOpen,
  Brain,
  Code2,
  Eye,
  Folder,
  FolderTree,
  MessagesSquare,
  SquareTerminal
} from 'lucide-react'
import clsx from 'clsx'
import { contextWindow } from '../lib/models'
import { interrupt, sendMessage, type TabState } from '../stores/sessions'
import { useUi } from '../stores/ui'

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}
import { Composer } from './Composer'
import { ContextPopover } from './ContextPopover'
import { EditorPane } from './EditorPane'
import { FileExplorer } from './FileExplorer'
import { InstructionsModal } from './InstructionsModal'
import { MemoryPanel } from './MemoryPanel'
import { MessageList } from './MessageList'
import { PreviewPanel } from './PreviewPanel'
import { SidePanelShell } from './Resizable'
import { SessionInfoPanel } from './SessionInfoPanel'
import { SideChatPanel } from './SideChatPanel'
import { TerminalPanel } from './TerminalPanel'

export function ChatView({ tab }: { tab: TabState }): React.JSX.Element {
  const streaming = tab.status === 'streaming'
  const busy = streaming || tab.status === 'awaitingApproval'
  const panel = useUi((s) => s.panels[tab.tabId] ?? null)
  const togglePanel = useUi((s) => s.togglePanel)
  const setPanel = (p: Exclude<Parameters<typeof togglePanel>[1], null>): void =>
    togglePanel(tab.tabId, p)
  const [infoOpen, setInfoOpen] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [seenArtifact, setSeenArtifact] = useState<string | undefined>()

  const statusDot =
    tab.status === 'error' ? 'bg-red-500' : busy ? 'bg-accent pulse-dot' : 'bg-green-600/80'

  const headerBtn = (active: boolean): string =>
    clsx(
      'flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-surface-2',
      active ? 'text-accent' : 'text-text-dim hover:text-text'
    )

  return (
    <div className="chat-wash flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2 text-xs text-text-dim">
        <span className="flex items-center gap-1.5" title={tab.cwd}>
          <span className={`h-2 w-2 rounded-full ${statusDot}`} />
          <Folder size={13} />
          <span className="max-w-48 truncate font-mono">{basename(tab.cwd)}</span>
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
        <span className="ml-auto flex items-center gap-1.5">
          {(tab.contextUsage ?? tab.usage) && (
            <button
              onClick={() => setContextOpen(true)}
              title={
                tab.contextUsage
                  ? `Context: ${(tab.contextUsage.totalTokens / 1000).toFixed(0)}k of ${(tab.contextUsage.maxTokens / 1000).toFixed(0)}k (${tab.contextUsage.percentage.toFixed(0)}%) — click for the breakdown`
                  : 'Context window fill — click for the breakdown'
              }
              className="mr-1.5 flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-2"
            >
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
            onClick={() => setPanel('files')}
            title="Project files (Ctrl+B)"
            className={headerBtn(panel === 'files')}
          >
            <FolderTree size={14} />
            Files
          </button>
          <button
            onClick={() => setPanel('editor')}
            title="Code editor — open files from the Files panel or Ctrl+P"
            className={headerBtn(panel === 'editor')}
          >
            <Code2 size={14} />
            Editor
          </button>
          <button
            onClick={() => setPanel('terminal')}
            title="Terminal in this folder (Ctrl+`)"
            className={headerBtn(panel === 'terminal')}
          >
            <SquareTerminal size={14} />
            Terminal
          </button>
          <button
            onClick={() => setPanel('sidechat')}
            title="Side chat — a separate conversation for quick questions"
            className={headerBtn(panel === 'sidechat')}
          >
            <MessagesSquare size={14} />
            Side chat
          </button>
          {tab.lastArtifact && (
            <button
              onClick={() => {
                setSeenArtifact(tab.lastArtifact)
                setPanel('preview')
              }}
              title={`Preview ${tab.lastArtifact}`}
              className={clsx(headerBtn(panel === 'preview'), 'relative')}
            >
              <Eye size={14} />
              Preview
              {panel !== 'preview' && tab.lastArtifact !== seenArtifact && (
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </button>
          )}
          <button
            onClick={() => setPanel('memory')}
            title="What Claude remembers about this project"
            className={headerBtn(panel === 'memory')}
          >
            <Brain size={14} />
          </button>
          <button
            onClick={() => setInstructionsOpen(true)}
            title="Edit instructions for Claude (CLAUDE.md)"
            className={headerBtn(false)}
          >
            <BookOpen size={14} />
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

      {tab.error && (
        <div className="border-b border-red-900 bg-red-950/50 px-4 py-2 text-sm text-red-300">
          {tab.error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList items={tab.items} tabId={tab.tabId} />

          <Composer
            tabId={tab.tabId}
            disabled={tab.status === 'error'}
            streaming={streaming || tab.status === 'awaitingApproval'}
            slashCommands={tab.slashCommands}
            onSend={(text, images) =>
              sendMessage(tab.tabId, text, images.length ? images : undefined)
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
        {panel === 'preview' && tab.lastArtifact && (
          <SidePanelShell storageKey="preview" defaultWidth={520}>
            <PreviewPanel path={tab.lastArtifact} cwd={tab.cwd} />
          </SidePanelShell>
        )}
        {panel === 'memory' && (
          <SidePanelShell storageKey="memory" defaultWidth={340}>
            <MemoryPanel tabId={tab.tabId} />
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
