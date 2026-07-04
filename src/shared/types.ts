// UI-facing types. The renderer never imports SDK types directly — the main
// process maps SDK messages into these shapes (see session-manager sanitize()).

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

/** Which backend a session talks to. Anthropic = your Claude subscription;
 *  OpenRouter = pay-per-token credits billed by OpenRouter; custom = any
 *  Anthropic-compatible endpoint (local proxies, other gateways). */
export type Provider = 'anthropic' | 'openrouter' | 'custom'

export type SessionStatus = 'starting' | 'idle' | 'streaming' | 'awaitingApproval' | 'error'

/** Automatic follow-up turns that shouldn't read as part of the conversation. */
export type CyclePhase = 'retro' | 'compact'

/** Extended-thinking budget, Claude Desktop style. Mapped to thinking-token
 *  budgets in the sidecar (see THINKING_BUDGETS). */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'ultra'

/** Palette presets — ocean-themed, naturally. */
export type ThemeId = 'abyss' | 'midnight' | 'lagoon' | 'reef' | 'sandbar'

/** How answers read, Claude Desktop-style. */
export type ResponseStyle = 'normal' | 'concise' | 'explanatory' | 'formal'

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
      /** Set when this was an automatic follow-up turn (retro/compact receipt). */
      phase?: CyclePhase
    }
  | { kind: 'status_text'; text: string }
  /** Working-tree delta after an edit turn ("+120 −18 across 4 files"). */
  | { kind: 'diffstat'; files: number; insertions: number; deletions: number }
  /** Live output-token count while streaming (recalibrated per API message). */
  | { kind: 'stream_tokens'; outputTokens: number }
  /** Authoritative context-window fill from the CLI (per-model window sizes). */
  | { kind: 'context_usage'; totalTokens: number; maxTokens: number; percentage: number }
  /** Smart routing switched the model for the upcoming message. */
  | { kind: 'model'; model: string }

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
  /** Anthropic-compatible base URL for the custom provider (e.g. a LiteLLM proxy). */
  customBaseUrl: string | null
  /** Model id for new custom-provider sessions. */
  customModel: string | null
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
  /** Accent color (hex) — drives highlights within any theme. */
  accent: string
  /** Palette preset (backgrounds, surfaces, text). */
  theme: ThemeId
  /** Shell for the integrated terminal. */
  terminalShell: 'cmd' | 'powershell' | 'pwsh'
  terminalFontSize: number
  editorFontSize: number
  /** Word-by-word fade streaming; off = text appears instantly. */
  smoothStreaming: boolean
  /** Reopen the last project automatically on launch. */
  reopenLastProject: boolean
  /** How wide the chat transcript and composer render. */
  chatWidth: 'comfortable' | 'wide' | 'full'
  /** Default extended-thinking level for new sessions. */
  defaultThinkingLevel: ThinkingLevel
  /** Auto-scale the thinking budget per message (never above the chosen level). */
  smartThinking: boolean
  /** Auto-pick the model per message: haiku ↔ sonnet ↔ your chosen model. */
  smartModel: boolean
  /** Skip user-level plugins/MCP/skills for a minimal context baseline. */
  leanSessions: boolean
  /** One-click session presets shown on the Welcome screen. */
  templates: SessionTemplate[]
  /** How answers read (appended to the system prompt of new sessions). */
  responseStyle: ResponseStyle
  /** Read answers aloud when a turn finishes. */
  speakReplies: boolean
  /** Auto-delete never-used session transcripts (no first prompt, >1 day old). */
  autoTidySessions: boolean
  /** Where /new-project creates folders (null = ~/Projects). */
  projectsRoot: string | null
}

/** A saved way to start a session: folder + optional first prompt. */
export interface SessionTemplate {
  name: string
  cwd: string
  prompt?: string
}

/** Tokens spent per day, for the usage graph. */
export interface DayUsage {
  outputTokens: number
  inputTokens: number
  costUsd: number
  turns: number
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
  /** Short capability blurb from the SDK's model catalog, if available. */
  description?: string
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

/** State of a dev server Seashell launched for the live preview. */
export interface DevServerStatus {
  running: boolean
  /** True once launched but before its URL has been detected. */
  starting: boolean
  /** The command we ran, e.g. "npm run dev". */
  command?: string
  /** The URL sniffed from the server's output, once it prints one. */
  url?: string
  pid?: number
  /** Recent output lines (tail), for surfacing startup errors. */
  log: string[]
  error?: string
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

/** Claude-written explanation of how a project actually works — the narrative
 *  layer on top of the static ProjectMap. Generated once, cached per project. */
export interface ProjectExplanation {
  /** Plain-language paragraph: what this project is and does. */
  summary: string
  /** What happens step by step when the project is used (rendered as a flow diagram). */
  flow: { title: string; detail: string }[]
  /** The main moving parts and each one's job. */
  parts: { name: string; role: string }[]
  /** What makes this project different from typical alternatives. */
  different: string[]
  generatedAt: number
  /** Hash of the project map it was generated from — regeneration is skipped
   *  while the project's shape is unchanged. */
  fingerprint?: string
}

/** A user-authored slash command, stored as a markdown file in
 *  `.claude/commands/` (project) or `~/.claude/commands/` (user). The body is
 *  the prompt Claude receives, with `$ARGUMENTS` / `$1`… substituted. */
export interface UserCommand {
  /** Command name without the leading slash or `.md` (slashes = namespacing). */
  name: string
  /** Where the file lives — decides which folder writes/deletes target. */
  scope: 'project' | 'user'
  /** One-line summary shown in the autocomplete (frontmatter `description`). */
  description?: string
  /** Placeholder hint shown after the name (frontmatter `argument-hint`). */
  argumentHint?: string
  /** The prompt body (frontmatter stripped). */
  body: string
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
