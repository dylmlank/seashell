import { create } from 'zustand'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type {
  CyclePhase,
  ImageAttachment,
  PermissionMode,
  Provider,
  SessionStatus,
  ThinkingLevel,
  TodoItem,
  UiEvent,
  UsageTotals
} from '@shared/types'

export type ChatItem =
  | { kind: 'user'; id: string; text: string; uuid?: string; imageCount?: number }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean; tokens?: number }
  /** Automatic follow-up output (retrospective/compaction) — kept out of the
   *  conversation flow, rendered as a separate collapsed card. */
  | {
      kind: 'aside'
      id: string
      phase: CyclePhase
      text: string
      streaming: boolean
      toolCount: number
      /** Output tokens the follow-up turn itself spent (its receipt). */
      tokens?: number
    }
  | { kind: 'plan'; id: string; todos: TodoItem[] }
  | { kind: 'status'; id: string; text: string }
  /** What the turn changed on disk — click opens the Changes panel. */
  | { kind: 'diffstat'; id: string; files: number; insertions: number; deletions: number }
  /** Auto-captured screenshots showing what the turn changed. */
  | {
      kind: 'shots'
      id: string
      title: string
      url: string
      frames: { label: string; data: string }[]
    }
  | {
      kind: 'tool'
      id: string
      toolUseId: string
      toolName: string
      input: Record<string, unknown>
      result?: string
      isError: boolean
      status: 'running' | 'done' | 'error'
      subagent?: string[]
    }

export interface TabState {
  tabId: string
  cwd: string
  sdkSessionId?: string
  model?: string
  status: SessionStatus
  error?: string
  permissionMode: PermissionMode
  provider: Provider
  /** Extended-thinking level for this session (live-adjustable). */
  thinkingLevel: ThinkingLevel
  /** Side-chat sessions render in a side panel and stay out of the OPEN list. */
  side?: boolean
  /** Set when this session runs in an isolated git worktree (merge-back UI). */
  worktree?: { branch: string }
  /** Chat title — the first thing the user asked (Claude Desktop-style). */
  title?: string
  /** Messages typed while a turn was running — sent automatically when idle. */
  queue?: { text: string; images?: ImageAttachment[] }[]
  /** Path of the last previewable file (HTML/SVG/Markdown) Claude wrote. */
  lastArtifact?: string
  /** Exact context fill from the CLI (knows the real per-model window). */
  contextUsage?: { totalTokens: number; maxTokens: number; percentage: number }
  /** Output tokens generated so far in the in-flight turn (live counter). */
  liveTokens?: number
  /** Automatic follow-up turn currently running (retro/compact indicator). */
  cyclePhase?: CyclePhase | null
  items: ChatItem[]
  usage?: UsageTotals
  slashCommands: string[]
  tools: string[]
  mcpServers: { name: string; status: string }[]
  skills: string[]
  plugins: string[]
  agents: string[]
}

interface SessionsStore {
  tabs: TabState[]
  activeTabId: string | null
  addTab: (tab: TabState) => void
  removeTab: (tabId: string) => void
  setActive: (tabId: string) => void
  update: (tabId: string, patch: Partial<TabState>) => void
  applyEvent: (tabId: string, event: UiEvent) => void
}

let itemCounter = 0
const nextId = (): string => `item-${++itemCounter}`

function reduceEvent(items: ChatItem[], event: UiEvent): ChatItem[] {
  switch (event.kind) {
    case 'user_message': {
      return [...items, { kind: 'user', id: nextId(), text: event.text }]
    }
    case 'user_uuid': {
      // Attach the SDK uuid to the most recent user item lacking one (for rewind).
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        if (item.kind === 'user') {
          if (item.uuid) return items
          const next = [...items]
          next[i] = { ...item, uuid: event.uuid }
          return next
        }
      }
      return items
    }
    case 'todos': {
      // Update the latest plan card in place; new card only if none exists yet.
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'plan') {
          const next = [...items]
          next[i] = { ...items[i], todos: event.todos } as ChatItem
          return next
        }
        if (items[i].kind === 'user') break // new turn → new card
      }
      return [...items, { kind: 'plan', id: nextId(), todos: event.todos }]
    }
    case 'status_text': {
      return [...items, { kind: 'status', id: nextId(), text: event.text }]
    }
    case 'subagent': {
      return items.map((item) =>
        item.kind === 'tool' && item.toolUseId === event.parentToolUseId
          ? { ...item, subagent: [...(item.subagent ?? []), event.text] }
          : item
      )
    }
    case 'assistant_delta': {
      const last = items[items.length - 1]
      if (event.phase) {
        // Retro/compact output accumulates in its own aside card.
        if (last?.kind === 'aside' && last.streaming && last.phase === event.phase) {
          return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
        }
        return [
          ...items,
          {
            kind: 'aside',
            id: nextId(),
            phase: event.phase,
            text: event.text,
            streaming: true,
            toolCount: 0
          }
        ]
      }
      if (last?.kind === 'assistant' && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
      }
      return [...items, { kind: 'assistant', id: nextId(), text: event.text, streaming: true }]
    }
    case 'assistant_message': {
      const next = [...items]
      const last = next[next.length - 1]
      if (event.phase) {
        // Fold retro/compact turns into the aside — their tool calls (memory
        // writes) become a counter instead of chat cards.
        if (last?.kind === 'aside' && last.streaming && last.phase === event.phase) {
          next[next.length - 1] = {
            ...last,
            text: event.text || last.text,
            toolCount: last.toolCount + event.toolUses.length
          }
        } else if (event.text.trim() || event.toolUses.length) {
          next.push({
            kind: 'aside',
            id: nextId(),
            phase: event.phase,
            text: event.text,
            streaming: true,
            toolCount: event.toolUses.length
          })
        }
        return next
      }
      if (last?.kind === 'assistant' && last.streaming) {
        // Finalize the streamed item with the authoritative text.
        next[next.length - 1] = {
          ...last,
          text: event.text || last.text,
          streaming: false
        }
      } else if (event.text.trim()) {
        next.push({ kind: 'assistant', id: nextId(), text: event.text, streaming: false })
      }
      for (const tu of event.toolUses) {
        next.push({
          kind: 'tool',
          id: nextId(),
          toolUseId: tu.toolUseId,
          toolName: tu.toolName,
          input: tu.input,
          isError: false,
          status: 'running'
        })
      }
      return next
    }
    case 'tool_result': {
      return items.map((item) =>
        item.kind === 'tool' && item.toolUseId === event.toolUseId
          ? {
              ...item,
              result: event.text,
              isError: event.isError,
              status: event.isError ? 'error' : 'done'
            }
          : item
      )
    }
    case 'diffstat': {
      // Replace a previous unclicked chip from the same turn burst.
      const last = items[items.length - 1]
      const base = last?.kind === 'diffstat' ? items.slice(0, -1) : items
      return [
        ...base,
        {
          kind: 'diffstat',
          id: nextId(),
          files: event.files,
          insertions: event.insertions,
          deletions: event.deletions
        }
      ]
    }
    case 'turn_result': {
      // Close out any dangling streaming bubble and stamp the turn's token cost
      // on the answer it belongs to.
      const next = items.map((item) =>
        (item.kind === 'assistant' || item.kind === 'aside') && item.streaming
          ? { ...item, streaming: false as const }
          : item
      )
      if (event.turnTokens.output > 0) {
        for (let i = next.length - 1; i >= 0; i--) {
          const item = next[i]
          // Retro/compact receipts land on their aside; answers on the bubble.
          if (event.phase && item.kind === 'aside' && item.phase === event.phase) {
            next[i] = { ...item, tokens: (item.tokens ?? 0) + event.turnTokens.output }
            break
          }
          if (!event.phase && item.kind === 'assistant') {
            next[i] = { ...item, tokens: event.turnTokens.output }
            break
          }
          if (item.kind === 'user') break
        }
      }
      return next
    }
    default:
      return items
  }
}

export const useSessions = create<SessionsStore>((set) => ({
  tabs: [],
  activeTabId: null,
  addTab: (tab) =>
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.side ? s.activeTabId : tab.tabId
    })),
  removeTab: (tabId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.tabId !== tabId)
      return {
        tabs,
        activeTabId:
          s.activeTabId === tabId ? (tabs[tabs.length - 1]?.tabId ?? null) : s.activeTabId
      }
    }),
  setActive: (tabId) => set({ activeTabId: tabId }),
  update: (tabId, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.tabId === tabId ? { ...t, ...patch } : t))
    })),
  applyEvent: (tabId, event) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.tabId !== tabId) return t
        const patch: Partial<TabState> = { items: reduceEvent(t.items, event) }
        if (event.kind === 'init') {
          patch.sdkSessionId = event.sessionId
          patch.model = event.model
          patch.slashCommands = event.slashCommands
          patch.tools = event.tools
          patch.mcpServers = event.mcpServers
          patch.skills = event.skills
          patch.plugins = event.plugins
          patch.agents = event.agents
        }
        if (event.kind === 'turn_result') {
          patch.usage = event.usage
          patch.liveTokens = undefined
        }
        if (event.kind === 'stream_tokens') {
          patch.liveTokens = event.outputTokens
        }
        if (event.kind === 'cycle') {
          patch.cyclePhase = event.phase
        }
        if (event.kind === 'context_usage') {
          patch.contextUsage = {
            totalTokens: event.totalTokens,
            maxTokens: event.maxTokens,
            percentage: event.percentage
          }
        }
        if (event.kind === 'tool_result' && !event.isError) {
          const tool = t.items.find(
            (i) => i.kind === 'tool' && i.toolUseId === event.toolUseId
          )
          if (tool?.kind === 'tool' && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool.toolName)) {
            const filePath = tool.input.file_path ?? tool.input.notebook_path
            if (typeof filePath === 'string') {
              // Renderable file → offer it in the preview pane.
              if (/\.(html?|svg|md|markdown)$/i.test(filePath)) {
                patch.lastArtifact = filePath
              }
              // Editor keeps clean open buffers in sync with Claude's edits.
              void import('./editor').then((m) => m.reloadFromDisk(tabId, filePath))
            }
          }
        }
        return { ...t, ...patch }
      })
    }))
}))

// ---- IPC wiring (module-level, once — guarded against HMR re-run) ----

declare global {
  interface Window {
    __sessionsWired?: boolean
    /** E2E hook: lets verify scripts drive the event reducer without live turns. */
    __sessions?: typeof useSessions
  }
}

window.__sessions = useSessions

/** Append a locally-generated chat item (e.g. auto-captured screenshots). */
export function appendItem(tabId: string, item: Omit<ChatItem, 'id'>): void {
  const store = useSessions.getState()
  const tab = store.tabs.find((t) => t.tabId === tabId)
  if (!tab) return
  store.update(tabId, { items: [...tab.items, { ...item, id: nextId() } as ChatItem] })
}

/** True in a detached pop-out window (label pop-<tabId>). */
export const POP_TAB_ID = ((): string | null => {
  const label = getCurrentWebviewWindow().label
  return label.startsWith('pop-') ? label.slice(4) : null
})()

/** Detach a session into its own OS window (state handed off via snapshot). */
export async function popOutTab(tab: TabState): Promise<void> {
  localStorage.setItem(`pop:${tab.tabId}`, JSON.stringify(tab))
  await tauriInvoke('open_popout', { tabId: tab.tabId })
}

if (!window.__sessionsWired) {
  window.__sessionsWired = true
  // Remember what's open so a restart can pick up where you left off.
  // Pop-out windows hold a single borrowed tab — they must not overwrite it.
  if (!POP_TAB_ID) {
    useSessions.subscribe((state) => {
      const open = state.tabs
        .filter((t) => !t.side)
        .map((t) => ({ cwd: t.cwd, sessionId: t.sdkSessionId, title: t.title }))
      localStorage.setItem('open-tabs', JSON.stringify(open))
    })
  }
  window.api.on('session:event', ({ tabId, event }) => {
    useSessions.getState().applyEvent(tabId, event)
    // Spoken replies: read the finished answer aloud (main sessions only).
    if (event.kind === 'turn_result' && !event.isError && !event.phase) {
      void import('./settings').then(({ useSettings }) => {
        if (!useSettings.getState().settings.speakReplies) return
        const tab = useSessions.getState().tabs.find((t) => t.tabId === tabId)
        if (!tab || tab.side) return
        const lastAnswer = [...tab.items].reverse().find((i) => i.kind === 'assistant')
        if (lastAnswer?.kind !== 'assistant' || !lastAnswer.text.trim()) return
        const spoken = lastAnswer.text
          .replace(/```[\s\S]*?```/g, ' code block omitted. ')
          .replace(/[#*_`>|-]/g, ' ')
          .slice(0, 1200)
        speechSynthesis.cancel()
        speechSynthesis.speak(new SpeechSynthesisUtterance(spoken))
      })
    }
    // Successful real turns (not retro/compact) may deserve visual proof.
    if (event.kind === 'turn_result' && !event.isError) {
      const tab = useSessions.getState().tabs.find((t) => t.tabId === tabId)
      if (tab && !tab.side && !tab.cyclePhase) {
        void Promise.all([import('../lib/auto-shots'), import('./settings')]).then(
          ([shots, settings]) => {
            if (settings.useSettings.getState().settings.autoScreenshots) {
              void shots.finishTurn(tab, (item) => appendItem(tabId, item))
            }
          }
        )
      }
    }
  })
  window.api.on('session:status', ({ tabId, status, error }) => {
    useSessions.getState().update(tabId, { status, error })
    // Turn finished with messages waiting — send the next one.
    if (status === 'idle') {
      const tab = useSessions.getState().tabs.find((t) => t.tabId === tabId)
      const next = tab?.queue?.[0]
      if (tab && next) {
        useSessions.getState().update(tabId, { queue: tab.queue!.slice(1) })
        sendMessage(tabId, next.text, next.images)
      }
    }
  })
}

// ---- actions ----

export async function createTab(cwd: string, resume?: string, side?: boolean): Promise<string> {
  const tabId = crypto.randomUUID()
  const { useSettings } = await import('./settings')
  const settings = useSettings.getState().settings
  const permissionMode: PermissionMode = settings.defaultPermissionMode
  const provider: Provider = settings.defaultProvider ?? 'anthropic'
  const thinkingLevel: ThinkingLevel = settings.defaultThinkingLevel ?? 'off'
  const result = await window.api.invoke('session:create', {
    tabId,
    cwd,
    resume,
    permissionMode,
    provider,
    thinkingLevel,
    chatOnly: side // side chats are read-and-answer only
  })
  if (!result.ok) {
    throw new Error(result.error)
  }
  if (!side) localStorage.setItem('last-project', cwd)
  useSessions.getState().addTab({
    tabId,
    cwd,
    status: 'starting',
    permissionMode,
    provider,
    thinkingLevel,
    side,
    items: [],
    slashCommands: [],
    tools: [],
    mcpServers: [],
    skills: [],
    plugins: [],
    agents: []
  })
  return tabId
}

/** Create an isolated git-worktree session for a project: its own branch and
 *  sibling folder — merge back (or abandon) from the session header. */
export async function createWorktreeTab(cwd: string): Promise<void> {
  const result = await window.api.invoke('worktree:create', { cwd })
  if ('error' in result) throw new Error(result.error)
  const tabId = await createTab(result.path)
  useSessions.getState().update(tabId, { worktree: { branch: result.branch } })
}

export function sendMessage(tabId: string, text: string, images?: ImageAttachment[]): void {
  const store = useSessions.getState()
  const tab = store.tabs.find((t) => t.tabId === tabId)
  if (!tab) return
  speechSynthesis.cancel() // a new message interrupts any read-aloud
  // Busy? Queue it — sent automatically the moment this turn (and its
  // follow-ups) finish. Keeps typing flowing without interrupting Claude.
  if (tab.status === 'streaming' || tab.status === 'awaitingApproval') {
    store.update(tabId, { queue: [...(tab.queue ?? []), { text, images }] })
    return
  }
  store.update(tabId, {
    items: [
      ...tab.items,
      { kind: 'user', id: nextId(), text, imageCount: images?.length || undefined }
    ],
    status: 'streaming',
    // First message names the chat, like Claude Desktop.
    ...(tab.title ? {} : { title: text.trim().slice(0, 60) })
  })
  void window.api.invoke('session:send', { tabId, text, images })
  // Snap a "before" frame now so visual turns can show a real diff.
  if (!tab.side) {
    void Promise.all([import('../lib/auto-shots'), import('./settings')]).then(
      ([shots, settings]) => {
        if (settings.useSettings.getState().settings.autoScreenshots) void shots.beginTurn(tab)
      }
    )
  }
}

export async function rewindTo(tabId: string, uuid: string): Promise<{ ok: boolean; detail: string }> {
  return window.api.invoke('session:rewind', { tabId, userMessageId: uuid })
}

export function interrupt(tabId: string): void {
  void window.api.invoke('session:interrupt', { tabId })
}

export function setThinking(tabId: string, level: ThinkingLevel): void {
  useSessions.getState().update(tabId, { thinkingLevel: level })
  void window.api.invoke('session:setThinking', { tabId, level })
}

export function closeTab(tabId: string): void {
  void window.api.invoke('session:close', { tabId })
  useSessions.getState().removeTab(tabId)
  // Tear down the tab's terminals and editor buffers with it.
  void import('../lib/terminals').then((m) => m.disposeAll(tabId))
  void import('./editor').then((m) =>
    m.useEditor.setState((s) => {
      const byTab = { ...s.byTab }
      delete byTab[tabId]
      return { byTab }
    })
  )
}
