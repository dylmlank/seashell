import type {
  ApprovalRequest,
  AppSettings,
  AuthState,
  BranchInfo,
  ChangedFile,
  ContextBreakdown,
  DayUsage,
  DesktopConnector,
  DevServerStatus,
  DirEntry,
  ImageAttachment,
  MemoryFile,
  ModelInfo,
  PermissionMode,
  PlanLimits,
  PortInfo,
  ProjectExplanation,
  ProjectMap,
  ProjectPreview,
  ProjectSummary,
  Provider,
  SearchHit,
  SessionStatus,
  SessionSummary,
  ThinkingLevel,
  UiEvent,
  UsageTotals,
  UserCommand
} from './types'

// ---- renderer -> main (ipcRenderer.invoke / ipcMain.handle) ----

export interface Invokes {
  'session:create': (a: {
    tabId: string
    cwd: string
    resume?: string
    permissionMode: PermissionMode
    model?: string
    provider?: Provider
    /** Read-and-answer only: no file edits, commands, or MCP tools. */
    chatOnly?: boolean
    /** Initial extended-thinking level. */
    thinkingLevel?: ThinkingLevel
  }) => { ok: true } | { ok: false; error: string }
  'session:send': (a: { tabId: string; text: string; images?: ImageAttachment[] }) => void
  'session:interrupt': (a: { tabId: string }) => void
  'session:rewind': (a: {
    tabId: string
    userMessageId: string
  }) => { ok: boolean; detail: string }
  'session:setPermissionMode': (a: { tabId: string; mode: PermissionMode }) => void
  'session:setModel': (a: { tabId: string; model: string }) => void
  'session:setThinking': (a: { tabId: string; level: ThinkingLevel }) => void
  'session:supportedModels': (a: { tabId: string }) => ModelInfo[]
  'session:contextUsage': (a: { tabId: string }) => ContextBreakdown | { error: string }
  'session:close': (a: { tabId: string }) => void

  'approval:respond': (
    a: { requestId: string } & (
      | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
      | { behavior: 'deny'; message: string }
    )
  ) => void

  'dialog:pickFolder': () => string | null
  'fs:readFile': (a: { path: string }) => { content: string } | { error: string }

  'app:openDataFolder': () => void
  'previews:clearCache': () => { ok: true } | { error: string }

  'auth:getState': () => AuthState
  'auth:saveManualToken': (a: { token: string }) => { ok: boolean; error?: string }
  'auth:openTerminalLogin': () => void
  'auth:logout': () => void

  'history:listProjects': () => ProjectSummary[]
  'history:listSessions': (a: { dir?: string }) => SessionSummary[]
  'history:rename': (a: { sessionId: string; title: string }) => void
  'history:delete': (a: { sessionId: string }) => void
  'history:search': (a: { query: string }) => SearchHit[]
  'history:pins': () => string[]
  'history:togglePin': (a: { sessionId: string }) => string[]
  'history:export': (a: {
    sessionId: string
  }) => { markdown: string; suggestedName: string } | { error: string }

  'usage:getAll': () => Record<string, UsageTotals>
  /** Plan rate-limit windows (5h / weekly), fetched through any live session. */
  'usage:limits': () => PlanLimits
  /** Tokens per day (YYYY-MM-DD keys) for the usage graph. */
  'usage:history': () => Record<string, DayUsage>

  /** Create a git worktree next to the project and return its path. */
  'worktree:create': (a: { cwd: string }) => { path: string; branch: string } | { error: string }
  /** Merge a worktree session's branch into the main repo and remove the worktree. */
  'worktree:merge': (a: { tabId: string }) => { ok: true } | { error: string }

  'settings:get': () => AppSettings
  'settings:set': (a: Partial<AppSettings>) => AppSettings

  'changes:list': (a: { tabId: string }) => { files: ChangedFile[] } | { error: string }
  'changes:diff': (a: { tabId: string; path: string }) => { oldText: string; newText: string } | { error: string }
  'changes:revert': (a: { tabId: string; path: string }) => { ok: true } | { error: string }
  'changes:branches': (a: { tabId: string }) => BranchInfo | { error: string }
  'changes:checkout': (a: { tabId: string; branch: string }) => { ok: true } | { error: string }
  'changes:commit': (a: {
    tabId: string
    message: string
    files: string[]
  }) => { ok: true } | { error: string }
  /** Push the current branch and open a GitHub PR via gh. */
  'changes:createPr': (a: { tabId: string }) => { url: string } | { error: string }
  /** Open the project folder in Explorer or VS Code. */
  'project:open': (a: { tabId: string; app: 'explorer' | 'vscode' }) => void

  'providers:getState': () => { openrouterKeySet: boolean; customKeySet: boolean }
  'providers:saveOpenRouterKey': (a: { key: string }) => { ok: boolean; error?: string }
  'providers:clearOpenRouterKey': () => void
  'providers:saveCustomKey': (a: { key: string }) => { ok: boolean; error?: string }
  'providers:clearCustomKey': () => void
  'providers:listOpenRouterModels': () => ModelInfo[] | { error: string }
  'providers:desktopMcp': () => DesktopConnector[]

  'fs:listDir': (a: { tabId: string; rel: string }) => { entries: DirEntry[] } | { error: string }
  'fs:listFiles': (a: { tabId: string }) => { files: string[] } | { error: string }
  'fs:readFileBase64': (a: {
    path: string
  }) => { data: string; mediaType: string } | { error: string }
  'fs:writeFile': (a: {
    tabId: string
    rel: string
    content: string
  }) => { ok: true } | { error: string }

  'instructions:get': (a: {
    scope: 'project' | 'global'
    tabId?: string
  }) => { content: string; path: string } | { error: string }
  'instructions:set': (a: {
    scope: 'project' | 'global'
    tabId?: string
    content: string
  }) => { ok: true } | { error: string }

  'memory:list': (a: { tabId: string }) => { dir: string; files: MemoryFile[] } | { error: string }
  'memory:read': (a: { tabId: string; name: string }) => { content: string } | { error: string }
  'memory:write': (a: {
    tabId: string
    name: string
    content: string
  }) => { ok: true } | { error: string }
  'memory:delete': (a: { tabId: string; name: string }) => { ok: true } | { error: string }

  'dictation:start': () => { ok: true } | { error: string }

  'project:map': (a: { tabId: string }) => ProjectMap | { error: string }
  /** How the project works, written by Claude. Without refresh this only reads
   *  the per-project cache (null = never generated); refresh spends one call. */
  'project:explain': (a: {
    tabId: string
    refresh?: boolean
  }) => { explanation: ProjectExplanation | null } | { error: string }

  'previews:cards': () => ProjectPreview[]
  'previews:capture': (a: { cwd: string; url: string }) => { ok: true } | { error: string }
  /** Headless capture of a local file (HTML/SVG) → base64 PNG. */
  'shots:captureFile': (a: {
    path: string
    width?: number
    height?: number
  }) => { data: string } | { error: string }

  'ports:list': () => PortInfo[] | { error: string }
  'ports:kill': (a: { pid: number }) => { ok: true } | { error: string }
  'ports:open': (a: { port: number }) => void

  /** Auto-launch (or inspect) the project's dev server for the live preview. */
  'dev:start': (a: { cwd: string }) => DevServerStatus
  'dev:status': (a: { cwd: string }) => DevServerStatus
  'dev:stop': (a: { cwd: string }) => { ok: true }

  /** User-authored slash commands (.claude/commands/*.md), project + user scope. */
  'commands:list': (a: { tabId: string }) => { commands: UserCommand[] } | { error: string }
  'commands:save': (a: {
    tabId: string
    scope: 'project' | 'user'
    name: string
    description: string
    argumentHint: string
    body: string
  }) => { ok: true } | { error: string }
  'commands:delete': (a: {
    tabId: string
    scope: 'project' | 'user'
    name: string
  }) => { ok: true } | { error: string }
}

// ---- main -> renderer (webContents.send / window.api.on) ----

export interface Events {
  'session:event': { tabId: string; event: UiEvent }
  'session:status': { tabId: string; status: SessionStatus; error?: string }
  'approval:request': ApprovalRequest
  'approval:cancelled': { requestId: string }
  'auth:state': AuthState
  'usage:update': { tabId: string; sessionId: string; totals: UsageTotals }
  /** Sidecar asks the frontend to show an OS notification (focus-checked there). */
  'notify': { title: string; body: string }
  /** Fresh plan rate-limit snapshot (from rate_limit_events or usage fetches). */
  'limits:update': PlanLimits
}

export type InvokeChannel = keyof Invokes
export type EventChannel = keyof Events

export const EVENT_CHANNELS: EventChannel[] = [
  'session:event',
  'session:status',
  'approval:request',
  'approval:cancelled',
  'auth:state',
  'usage:update',
  'notify',
  'limits:update'
]
