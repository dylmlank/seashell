// UI-facing types. The renderer never imports SDK types directly — the main
// process maps SDK messages into these shapes (see session-manager sanitize()).

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

/** Which backend a session talks to. Anthropic = your Claude subscription;
 *  OpenRouter = pay-per-token credits billed by OpenRouter. */
export type Provider = 'anthropic' | 'openrouter'

export type SessionStatus = 'starting' | 'idle' | 'streaming' | 'awaitingApproval' | 'error'

/** Automatic follow-up turns that shouldn't read as part of the conversation. */
export type CyclePhase = 'retro' | 'compact'

/** Events the renderer reduces into chat items. */
export type UiEvent =
  | {
      kind: 'init'
      sessionId: string
      model: string
      cwd: string
      tools: string[]
      slashCommands: string[]
      mcpServers: { name: string; status: string }[]
      skills: string[]
      plugins: string[]
      agents: string[]
    }
  | { kind: 'user_message'; text: string }
  | { kind: 'user_uuid'; uuid: string }
  | { kind: 'assistant_delta'; text: string; phase?: CyclePhase }
  | { kind: 'assistant_message'; id: string; text: string; toolUses: UiToolUse[]; phase?: CyclePhase }
  /** Automatic follow-up turn in progress (retro/compact) or back to idle. */
  | { kind: 'cycle'; phase: CyclePhase | null }
  | { kind: 'tool_result'; toolUseId: string; text: string; isError: boolean }
  | { kind: 'todos'; todos: TodoItem[] }
  | { kind: 'subagent'; parentToolUseId: string; text: string }
  | {
      kind: 'turn_result'
      usage: UsageTotals
      costUsd: number
      isError: boolean
      errorText?: string
      /** What this specific turn cost: output tokens + context size it ran at. */
      turnTokens: { output: number; context: number }
    }
  | { kind: 'status_text'; text: string }
  /** Live output-token count while streaming (recalibrated per API message). */
  | { kind: 'stream_tokens'; outputTokens: number }
  /** Authoritative context-window fill from the CLI (per-model window sizes). */
  | { kind: 'context_usage'; totalTokens: number; maxTokens: number; percentage: number }

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export interface ImageAttachment {
  /** e.g. image/png */
  mediaType: string
  /** base64 data */
  data: string
}

export interface ChangedFile {
  path: string
  /** git porcelain status, e.g. "M", "A", "??" */
  status: string
}

export interface AppSettings {
  defaultModel: string | null
  defaultPermissionMode: PermissionMode
  /** Backend for new sessions. OpenRouter requires an API key (Settings → Providers). */
  defaultProvider: Provider
  /** Model id for new OpenRouter sessions (e.g. "anthropic/claude-sonnet-4.5"). */
  openrouterModel: string | null
  notifications: boolean
  /** Append a system prompt letting Claude create project skills/commands for itself. */
  allowSelfSkills: boolean
  /** Run /compact automatically after each answer (when context is large enough to matter). */
  autoCompact: boolean
  /** Only auto-compact once the context exceeds this many tokens — compacting
   *  itself costs a call over the whole context, so higher = cheaper. */
  compactThreshold: number
  /** Run the shell-retrospective skill after each answer to capture lessons into memory. */
  autoRetrospective: boolean
  /** Skip the retrospective on read-only turns (nothing changed → nothing to remember). */
  retroOnlyAfterEdits: boolean
  /** Load MCP connectors from Claude Desktop's config into every session. */
  importDesktopMcp: boolean
  /** After turns that change visual files, auto-capture screenshots into the chat. */
  autoScreenshots: boolean
  fontSize: 'sm' | 'md' | 'lg'
  reducedMotion: boolean
  /** Accent color (hex) — drives the whole theme. */
  accent: string
  /** Shell for the integrated terminal. */
  terminalShell: 'cmd' | 'powershell' | 'pwsh'
  terminalFontSize: number
  editorFontSize: number
  /** Word-by-word fade streaming; off = text appears instantly. */
  smoothStreaming: boolean
  /** Reopen the last project automatically on launch. */
  reopenLastProject: boolean
}

export interface UiToolUse {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  turns: number
  /** Tokens actually in the context window on the latest call (for the fill gauge). */
  lastContextTokens: number
  model?: string
}

export interface ModelInfo {
  id: string
  displayName: string
}

export interface DirEntry {
  name: string
  isDir: boolean
}

/** A connector found in Claude Desktop's config/extensions, and whether it syncs. */
export interface DesktopConnector {
  name: string
  source: 'config' | 'extension'
  imported: boolean
  note?: string
}

export interface BranchInfo {
  current: string
  branches: string[]
}

export interface AuthState {
  state: 'unknown' | 'loggedOut' | 'token' | 'apiKey'
  detail?: string
}

export interface ApprovalRequest {
  requestId: string
  tabId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  /** Full prompt sentence from the SDK when present ("Claude wants to ..."). */
  promptText?: string
  decisionReason?: string
}

export interface SessionSummary {
  sessionId: string
  title: string
  firstPrompt?: string
  cwd?: string
  lastModified: number
  createdAt?: number
  gitBranch?: string
}

export interface ProjectSummary {
  realPath: string
  sessionCount: number
  lastActive: number
}

/** A full-text match inside a past session's transcript. */
export interface SearchHit {
  sessionId: string
  cwd?: string
  role: 'user' | 'assistant'
  snippet: string
  lastModified: number
}

/** A file in Claude's persistent memory directory for a project. */
export interface MemoryFile {
  name: string
  size: number
  modified: number
}

/** A TCP port listening on localhost and the process that owns it. */
export interface PortInfo {
  port: number
  pid: number
  process: string
}

/** One plan rate-limit window (like Claude Desktop's usage bars). */
export interface LimitWindow {
  /** Percentage of the window used, 0–100. */
  utilization: number
  /** Epoch ms when the window resets, if known. */
  resetsAt?: number
}

/** Claude plan rate-limit state for the usage bars. */
export interface PlanLimits {
  available: boolean
  subscriptionType?: string
  fiveHour?: LimitWindow
  sevenDay?: LimitWindow
  /** Epoch ms when this snapshot was fetched. */
  fetchedAt: number
}

/** What's occupying the context window, straight from the CLI. */
export interface ContextBreakdown {
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
  categories: { name: string; tokens: number; color: string }[]
  /** The /context-style square grid, one cell per slice of the window. */
  grid: { color: string; filled: boolean }[][]
  /** Token cost per MCP server (summed over its tools). */
  mcpServers: { name: string; tokens: number }[]
}

/** Static-analysis map of a project for the Workflow tab. */
export interface ProjectMap {
  /** Detected tech (frameworks, runtimes, tooling). */
  stack: string[]
  /** Language composition by lines of code. */
  languages: { name: string; color: string; lines: number; files: number }[]
  /** Top-level modules (directories) with size. */
  modules: { name: string; files: number; lines: number }[]
  /** Import edges between modules (who depends on whom). */
  edges: { from: string; to: string; count: number }[]
  /** External services the code calls (http/ws hosts). */
  externals: { host: string; kind: 'http' | 'ws'; count: number; files: string[] }[]
  /** Total files scanned. */
  totalFiles: number
  totalLines: number
}

/** A project folder with a generated visual preview. */
export interface ProjectPreview {
  cwd: string
  name: string
  lastActive: number
  sessionCount: number
  /** Generated SVG card (languages, README, git). */
  svg: string
  /** base64 PNG screenshot, when one has been captured for this project. */
  screenshot?: string
}
