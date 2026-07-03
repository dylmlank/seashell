import {
  getSessionMessages,
  query,
  type Options,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { approvals } from './approvals'
import { auth } from './auth'
import { AsyncQueue } from './async-queue'
import { loadDesktopMcpServers } from './desktop-mcp'
import { notifyIfUnfocused } from './notify'
import { OPENROUTER_BASE_URL } from './openrouter'
import { RETRO_PROMPT } from './retrospective'
import { secrets } from './secrets'
import { settingsStore } from './settings-store'
import { usageStore } from './usage-store'
import type { Events } from '../shared/ipc-contract'
import type {
  ImageAttachment,
  ModelInfo,
  PermissionMode,
  Provider,
  TodoItem,
  UiEvent,
  UiToolUse,
  UsageTotals
} from '../shared/types'

const SELF_SKILLS_PROMPT = `
When you find yourself repeating a multi-step workflow, or when a reusable capability would make future work in this project faster or more reliable, proactively create a project skill (a .claude/skills/<name>/SKILL.md file) or a custom slash command (.claude/commands/<name>.md) that captures it. Tell the user what you created and how to invoke it. Prefer small, composable skills with clear descriptions.`.trim()

type Broadcast = <C extends keyof Events>(channel: C, payload: Events[C]) => void

let broadcast: Broadcast = () => {}
export function setBroadcast(fn: Broadcast): void {
  broadcast = fn
}

export interface CreateSessionOpts {
  tabId: string
  cwd: string
  resume?: string
  permissionMode: PermissionMode
  model?: string
  provider?: Provider
  /** Read-and-answer only: no file edits, commands, or MCP tools. */
  chatOnly?: boolean
}

/** The only tools a chat-only (side chat) session may use. */
const CHAT_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'NotebookRead'])

class SessionHandle {
  readonly tabId: string
  readonly cwd: string
  readonly provider: Provider
  private readonly chatOnly: boolean
  sdkSessionId?: string
  private input = new AsyncQueue<SDKUserMessage>()
  private q: Query
  // Live plan state, fed by TodoWrite (older CLIs) or TaskCreate/TaskUpdate (newer CLIs).
  private tasks = new Map<string, TodoItem>()
  private pendingTaskCreates = new Map<string, { subject: string; activeForm?: string }>()
  /** Where we are in the answer → retrospective → compact cycle. */
  private turnPhase: 'user' | 'retro' | 'compact' = 'user'
  /** Skip auto-compact below this many context tokens — compacting tiny contexts wastes quota. */
  private static readonly COMPACT_MIN_CONTEXT = 30_000
  /** Whether the current turn changed anything (files/commands). Read-only turns
   *  have nothing worth remembering, so the retrospective call can be skipped. */
  private turnHadMutations = false
  private usage: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    turns: 0,
    lastContextTokens: 0
  }

  constructor(opts: CreateSessionOpts) {
    this.tabId = opts.tabId
    this.cwd = opts.cwd
    this.provider = opts.provider ?? 'anthropic'
    this.chatOnly = opts.chatOnly ?? false
    const settings = settingsStore.get()
    const defaultModel =
      this.provider === 'openrouter'
        ? (settings.openrouterModel ?? undefined)
        : (settings.defaultModel ?? undefined)
    const options: Options = {
      cwd: opts.cwd,
      resume: opts.resume,
      permissionMode: opts.permissionMode,
      model: opts.model ?? defaultModel,
      includePartialMessages: true,
      enableFileCheckpointing: true,
      // Lets the user switch into Bypass mode mid-session; the UI confirms first.
      allowDangerouslySkipPermissions: true,
      // Load the user's full Claude Code config: plugins, skills, MCP servers,
      // CLAUDE.md, hooks — so the shell behaves exactly like the terminal CLI.
      settingSources: ['user', 'project', 'local'],
      ...(settings.allowSelfSkills && !this.chatOnly
        ? { appendSystemPrompt: SELF_SKILLS_PROMPT }
        : {}),
      // Chat-only sessions get read-only built-ins and none of the imported
      // connectors — they can look but never touch.
      ...(this.chatOnly ? { tools: [...CHAT_ONLY_TOOLS] } : {}),
      // Bring Claude Desktop's connectors along (its config is separate from
      // Claude Code's). Skipped under test profiles — spawning the user's real
      // MCP servers in E2E runs would be slow and side-effectful.
      ...(settings.importDesktopMcp && !this.chatOnly && !process.env.CLAUDE_SHELL_USER_DATA
        ? { mcpServers: loadDesktopMcpServers() }
        : {}),
      canUseTool: (toolName, input, ctx): Promise<PermissionResult> => {
        // Chat-only backstop: settingSources still loads the user's own MCP
        // servers and plugin tools, so deny anything outside the read whitelist.
        if (this.chatOnly && !CHAT_ONLY_TOOLS.has(toolName)) {
          return Promise.resolve({
            behavior: 'deny',
            message:
              'This is a read-only side chat — it can read files and search, but never changes anything. Answer from what you can read, or tell the user to use the main chat.'
          })
        }
        // During the auto-retrospective turn, memory/skill writes under
        // ~/.claude are expected — don't interrupt the user for them.
        if (this.turnPhase === 'retro' && (toolName === 'Write' || toolName === 'Edit')) {
          const filePath = String(input.file_path ?? '')
          if (filePath.replace(/\\/g, '/').includes('/.claude/')) {
            return Promise.resolve({ behavior: 'allow' })
          }
        }
        return approvals.request(this.tabId, toolName, input, ctx)
      },
      stderr: (line: string) => {
        console.error(`[session ${this.tabId}] ${line}`)
      }
    }
    if (this.provider === 'openrouter') {
      // Route the CLI's native Anthropic protocol at OpenRouter's compatible
      // endpoint. Anthropic credentials must be blanked (not just unset) or the
      // CLI falls back to its own login. Options.env REPLACES the subprocess env.
      const env: Record<string, string | undefined> = { ...process.env }
      env.ANTHROPIC_BASE_URL = OPENROUTER_BASE_URL
      env.ANTHROPIC_AUTH_TOKEN = secrets.getOpenRouterKey() ?? ''
      env.ANTHROPIC_API_KEY = ''
      delete env.CLAUDE_CODE_OAUTH_TOKEN
      options.env = env
    }
    this.q = query({ prompt: this.input, options })
    void this.start(opts.resume, opts.cwd)
  }

  private async start(resume: string | undefined, cwd: string): Promise<void> {
    if (resume) await this.replayHistory(resume, cwd)
    await this.pump()
  }

  /** Rebuild the UI transcript of a resumed session from its stored messages. */
  private async replayHistory(sessionId: string, cwd: string): Promise<void> {
    try {
      const messages = await getSessionMessages(sessionId, { dir: cwd })
      for (const m of messages) {
        const body = m.message as { role?: string; content?: unknown } | undefined
        const content = body?.content
        if (m.type === 'user') {
          if (typeof content === 'string') {
            if (content.trim()) this.send({ kind: 'user_message', text: content })
          } else if (Array.isArray(content)) {
            const text = content
              .filter((b) => b?.type === 'text')
              .map((b) => (b as { text: string }).text)
              .join('\n')
            if (text.trim()) this.send({ kind: 'user_message', text })
            for (const b of content) {
              if (b?.type === 'tool_result') {
                const block = b as {
                  tool_use_id: string
                  is_error?: boolean
                  content?: string | { type: string; text?: string }[]
                }
                const text2 =
                  typeof block.content === 'string'
                    ? block.content
                    : (block.content ?? [])
                        .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
                        .join('\n')
                this.send({
                  kind: 'tool_result',
                  toolUseId: block.tool_use_id,
                  text: text2,
                  isError: block.is_error ?? false
                })
              }
            }
          }
        } else if (m.type === 'assistant' && Array.isArray(content)) {
          let text = ''
          const toolUses: UiToolUse[] = []
          for (const b of content) {
            if (b?.type === 'text') text += (b as { text: string }).text
            else if (b?.type === 'tool_use') {
              const block = b as { id: string; name: string; input?: Record<string, unknown> }
              toolUses.push({ toolUseId: block.id, toolName: block.name, input: block.input ?? {} })
            }
          }
          if (text || toolUses.length) {
            this.send({ kind: 'assistant_message', id: m.uuid, text, toolUses })
          }
        }
      }
    } catch (err) {
      console.error(`[session ${this.tabId}] history replay failed:`, err)
    }
  }

  private send(event: UiEvent): void {
    broadcast('session:event', { tabId: this.tabId, event })
  }

  private emitTasks(): void {
    this.send({ kind: 'todos', todos: [...this.tasks.values()].map((t) => ({ ...t })) })
  }

  private async pump(): Promise<void> {
    try {
      for await (const msg of this.q) {
        this.handleMessage(msg)
      }
      broadcast('session:status', { tabId: this.tabId, status: 'idle' })
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      if (auth.looksLikeAuthError(text)) auth.notifyLoggedOut(text)
      broadcast('session:status', { tabId: this.tabId, status: 'error', error: text })
    }
  }

  private handleMessage(msg: SDKMessage): void {
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'compact_boundary') {
          this.send({ kind: 'status_text', text: 'context compacted' })
          break
        }
        if (msg.subtype === 'init') {
          this.sdkSessionId = msg.session_id
          this.usage.model = msg.model
          this.send({
            kind: 'init',
            sessionId: msg.session_id,
            model: msg.model,
            cwd: msg.cwd,
            tools: msg.tools,
            slashCommands: msg.slash_commands ?? [],
            mcpServers: msg.mcp_servers ?? [],
            skills: msg.skills ?? [],
            plugins: (msg.plugins ?? []).map((p: { name: string }) => p.name),
            agents: msg.agents ?? []
          })
        }
        break
      }
      case 'stream_event': {
        if (msg.parent_tool_use_id) break // subagent stream — skip for now
        const ev = msg.event
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          this.send({ kind: 'assistant_delta', text: ev.delta.text })
        }
        break
      }
      case 'assistant': {
        if (msg.error === 'authentication_failed' || msg.error === 'billing_error') {
          auth.notifyLoggedOut(msg.error)
        }
        const blocks = msg.message.content
        if (msg.parent_tool_use_id) {
          // Subagent activity — summarize under the spawning tool card.
          const parts: string[] = []
          for (const block of blocks) {
            if (block.type === 'text' && block.text.trim()) parts.push(block.text.trim())
            else if (block.type === 'tool_use') parts.push(`→ ${block.name}`)
          }
          if (parts.length) {
            this.send({
              kind: 'subagent',
              parentToolUseId: msg.parent_tool_use_id,
              text: parts.join('\n')
            })
          }
          break
        }
        let text = ''
        const toolUses: UiToolUse[] = []
        for (const block of blocks) {
          if (block.type === 'text') text += block.text
          else if (block.type === 'tool_use') {
            if (block.name === 'TodoWrite') {
              // Render the agent's plan as a live checklist instead of a tool card.
              const todos = (block.input as { todos?: TodoItem[] } | null)?.todos
              if (Array.isArray(todos)) this.send({ kind: 'todos', todos })
              continue
            }
            if (block.name === 'TaskCreate') {
              const input = block.input as { subject?: string; activeForm?: string } | null
              this.pendingTaskCreates.set(block.id, {
                subject: input?.subject ?? 'Task',
                activeForm: input?.activeForm
              })
              continue
            }
            if (block.name === 'TaskUpdate') {
              const input = block.input as { taskId?: string | number; status?: string } | null
              const id = input?.taskId != null ? String(input.taskId) : undefined
              const task = id ? this.tasks.get(id) : undefined
              if (task && input?.status) {
                if (input.status === 'deleted') this.tasks.delete(id!)
                else if (
                  input.status === 'pending' ||
                  input.status === 'in_progress' ||
                  input.status === 'completed'
                ) {
                  task.status = input.status
                }
                this.emitTasks()
              }
              continue
            }
            if (/^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/.test(block.name)) {
              this.turnHadMutations = true
            }
            toolUses.push({
              toolUseId: block.id,
              toolName: block.name,
              input: (block.input ?? {}) as Record<string, unknown>
            })
          }
        }
        this.send({ kind: 'assistant_message', id: msg.uuid, text, toolUses })
        break
      }
      case 'user': {
        // Live replays are ignored — resumed history comes from replayHistory().
        if ('isReplay' in msg && msg.isReplay) break
        // Echo of a real user message: capture its uuid for rewind checkpoints.
        if (!msg.isSynthetic && !msg.parent_tool_use_id && 'uuid' in msg && msg.uuid) {
          this.send({ kind: 'user_uuid', uuid: msg.uuid })
        }
        // Synthetic user messages carry tool results back to the model.
        const content = msg.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && block?.type === 'tool_result') {
              let text = ''
              if (typeof block.content === 'string') text = block.content
              else if (Array.isArray(block.content)) {
                text = block.content
                  .map((c: { type: string; text?: string }) =>
                    c.type === 'text' ? (c.text ?? '') : `[${c.type}]`
                  )
                  .join('\n')
              }
              // TaskCreate results carry the assigned task id ("Task #N created").
              const pendingCreate = this.pendingTaskCreates.get(block.tool_use_id)
              if (pendingCreate) {
                this.pendingTaskCreates.delete(block.tool_use_id)
                const idMatch = text.match(/#(\d+)/)
                if (idMatch) {
                  this.tasks.set(idMatch[1], {
                    content: pendingCreate.subject,
                    status: 'pending',
                    activeForm: pendingCreate.activeForm
                  })
                  this.emitTasks()
                }
                continue
              }
              this.send({
                kind: 'tool_result',
                toolUseId: block.tool_use_id,
                text,
                isError: block.is_error ?? false
              })
            }
          }
        }
        break
      }
      case 'result': {
        const u = msg.usage
        this.usage.inputTokens += u.input_tokens
        this.usage.outputTokens += u.output_tokens
        this.usage.cacheReadTokens += u.cache_read_input_tokens ?? 0
        this.usage.cacheCreationTokens += u.cache_creation_input_tokens ?? 0
        this.usage.costUsd = msg.total_cost_usd
        this.usage.turns = msg.num_turns
        this.usage.lastContextTokens =
          u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        this.send({
          kind: 'turn_result',
          usage: { ...this.usage },
          costUsd: msg.total_cost_usd,
          isError: msg.subtype !== 'success',
          errorText: msg.subtype !== 'success' ? msg.subtype : undefined
        })
        if (this.sdkSessionId) {
          usageStore.set(this.sdkSessionId, { ...this.usage })
          broadcast('usage:update', {
            tabId: this.tabId,
            sessionId: this.sdkSessionId,
            totals: { ...this.usage }
          })
        }
        const continued = this.advanceTurnCycle(msg.subtype === 'success')
        if (!continued) {
          broadcast('session:status', { tabId: this.tabId, status: 'idle' })
          notifyIfUnfocused(
            'Claude finished',
            msg.subtype === 'success' ? msg.result.slice(0, 140) : `Turn ended: ${msg.subtype}`
          )
        }
        break
      }
    }
  }

  /**
   * After each result, optionally chain the automatic follow-ups the user enabled:
   * answer → retrospective (memory capture) → compact. Returns true when a
   * follow-up turn was queued (session stays busy).
   */
  private advanceTurnCycle(success: boolean): boolean {
    const settings = settingsStore.get()
    if (!success || this.chatOnly) {
      // Side chats skip auto-retro/compact — retro writes memory (a file write),
      // and burning extra turns on a quick-question chat wastes quota.
      this.turnPhase = 'user'
      return false
    }
    if (this.turnPhase === 'user') {
      if (settings.autoRetrospective && (!settings.retroOnlyAfterEdits || this.turnHadMutations)) {
        this.turnPhase = 'retro'
        this.send({ kind: 'status_text', text: 'auto-retrospective' })
        this.pushText(RETRO_PROMPT)
        return true
      }
      if (this.shouldAutoCompact(settings.autoCompact)) {
        this.turnPhase = 'compact'
        this.send({ kind: 'status_text', text: 'auto-compact' })
        this.pushText('/compact')
        return true
      }
      return false
    }
    if (this.turnPhase === 'retro') {
      if (this.shouldAutoCompact(settings.autoCompact)) {
        this.turnPhase = 'compact'
        this.send({ kind: 'status_text', text: 'auto-compact' })
        this.pushText('/compact')
        return true
      }
      this.turnPhase = 'user'
      return false
    }
    // compact finished
    this.turnPhase = 'user'
    return false
  }

  private shouldAutoCompact(enabled: boolean): boolean {
    const threshold = Math.max(
      settingsStore.get().compactThreshold,
      SessionHandle.COMPACT_MIN_CONTEXT
    )
    return enabled && this.usage.lastContextTokens >= threshold
  }

  private pushText(text: string): void {
    this.input.push({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      session_id: this.sdkSessionId ?? ''
    } as SDKUserMessage)
  }

  sendUserMessage(text: string, images?: ImageAttachment[]): void {
    this.turnPhase = 'user' // a real user message restarts the auto follow-up cycle
    this.turnHadMutations = false
    broadcast('session:status', { tabId: this.tabId, status: 'streaming' })
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    > = []
    for (const img of images ?? []) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data }
      })
    }
    content.push({ type: 'text', text })
    this.input.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.sdkSessionId ?? ''
    } as SDKUserMessage)
  }

  async rewind(userMessageId: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const result = await this.q.rewindFiles(userMessageId)
      if (!result.canRewind) {
        return { ok: false, detail: result.error ?? 'Cannot rewind to this message' }
      }
      const n = result.filesChanged?.length ?? 0
      return { ok: true, detail: `Restored ${n} file${n === 1 ? '' : 's'}` }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  }

  interrupt(): Promise<void> {
    return this.q.interrupt()
  }

  setPermissionMode(mode: PermissionMode): Promise<void> {
    return this.q.setPermissionMode(mode)
  }

  setModel(model: string): Promise<void> {
    return this.q.setModel(model)
  }

  async supportedModels(): Promise<ModelInfo[]> {
    const models = await this.q.supportedModels()
    return models.map((m) => ({ id: m.value, displayName: m.displayName }))
  }

  dispose(): void {
    approvals.cancelAll(this.tabId)
    this.input.end()
    try {
      this.q.close()
    } catch {
      // already closed
    }
  }
}

const handles = new Map<string, SessionHandle>()
const MAX_TABS = 8

export const sessionManager = {
  create(opts: CreateSessionOpts): { ok: true } | { ok: false; error: string } {
    if (handles.has(opts.tabId)) return { ok: false, error: `tab ${opts.tabId} already exists` }
    if (handles.size >= MAX_TABS) return { ok: false, error: `max ${MAX_TABS} concurrent sessions` }
    if (opts.provider === 'openrouter' && !secrets.getOpenRouterKey()) {
      return { ok: false, error: 'Add your OpenRouter API key in Settings → Providers first.' }
    }
    broadcast('session:status', { tabId: opts.tabId, status: 'starting' })
    handles.set(opts.tabId, new SessionHandle(opts))
    return { ok: true }
  },
  get(tabId: string): SessionHandle | undefined {
    return handles.get(tabId)
  },
  close(tabId: string): void {
    handles.get(tabId)?.dispose()
    handles.delete(tabId)
  },
  disposeAll(): void {
    for (const h of handles.values()) h.dispose()
    handles.clear()
  }
}
