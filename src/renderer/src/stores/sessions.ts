import { create } from 'zustand'
import type {
  ImageAttachment,
  PermissionMode,
  Provider,
  SessionStatus,
  TodoItem,
  UiEvent,
  UsageTotals
} from '@shared/types'

export type ChatItem =
  | { kind: 'user'; id: string; text: string; uuid?: string; imageCount?: number }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'plan'; id: string; todos: TodoItem[] }
  | { kind: 'status'; id: string; text: string }
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
  /** Side-chat sessions render in a side panel and stay out of the OPEN list. */
  side?: boolean
  /** Path of the last previewable file (HTML/SVG/Markdown) Claude wrote. */
  lastArtifact?: string
  /** Exact context fill from the CLI (knows the real per-model window). */
  contextUsage?: { totalTokens: number; maxTokens: number; percentage: number }
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
      if (last?.kind === 'assistant' && last.streaming) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
      }
      return [...items, { kind: 'assistant', id: nextId(), text: event.text, streaming: true }]
    }
    case 'assistant_message': {
      const next = [...items]
      const last = next[next.length - 1]
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
    case 'turn_result': {
      // Close out any dangling streaming bubble.
      return items.map((item) =>
        item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item
      )
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

if (!window.__sessionsWired) {
  window.__sessionsWired = true
  window.api.on('session:event', ({ tabId, event }) => {
    useSessions.getState().applyEvent(tabId, event)
  })
  window.api.on('session:status', ({ tabId, status, error }) => {
    useSessions.getState().update(tabId, { status, error })
  })
}

// ---- actions ----

export async function createTab(cwd: string, resume?: string, side?: boolean): Promise<string> {
  const tabId = crypto.randomUUID()
  const { useSettings } = await import('./settings')
  const settings = useSettings.getState().settings
  const permissionMode: PermissionMode = settings.defaultPermissionMode
  const provider: Provider = settings.defaultProvider ?? 'anthropic'
  const result = await window.api.invoke('session:create', {
    tabId,
    cwd,
    resume,
    permissionMode,
    provider,
    chatOnly: side // side chats are read-and-answer only
  })
  if (!result.ok) {
    throw new Error(result.error)
  }
  useSessions.getState().addTab({
    tabId,
    cwd,
    status: 'starting',
    permissionMode,
    provider,
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

export function sendMessage(tabId: string, text: string, images?: ImageAttachment[]): void {
  const store = useSessions.getState()
  const tab = store.tabs.find((t) => t.tabId === tabId)
  if (!tab) return
  store.update(tabId, {
    items: [
      ...tab.items,
      { kind: 'user', id: nextId(), text, imageCount: images?.length || undefined }
    ],
    status: 'streaming'
  })
  void window.api.invoke('session:send', { tabId, text, images })
}

export async function rewindTo(tabId: string, uuid: string): Promise<{ ok: boolean; detail: string }> {
  return window.api.invoke('session:rewind', { tabId, userMessageId: uuid })
}

export function interrupt(tabId: string): void {
  void window.api.invoke('session:interrupt', { tabId })
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
