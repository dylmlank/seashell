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
import { projectExplain } from './project-explain'
import { RETRO_PROMPT } from './retrospective'
import { secrets } from './secrets'
import { settingsStore } from './settings-store'
import { usageStore } from './usage-store'
import type { Events } from '../shared/ipc-contract'
import type {
  ContextBreakdown,
  ImageAttachment,
  ModelInfo,
  PermissionMode,
  PlanLimits,
  Provider,
  ThinkingLevel,
  TodoItem,
  UiEvent,
  UiToolUse,
  UsageTotals
} from '../shared/types'

/** Thinking-token budget per level (0 disables extended thinking). Mirrors the
 *  Claude Code CLI's low → ultra reasoning-effort ladder. */
export const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  off: 0,
  low: 4_000,
  medium: 10_000,
  high: 18_000,
  ultra: 31_999
}

const SELF_EXTEND_PROMPT = `
You are encouraged to extend your own capabilities as you work, proactively and without waiting to be asked:
- Skills: when you repeat a multi-step workflow, or solve a hard problem you may face again, capture it as a project skill (.claude/skills/<name>/SKILL.md) with a clear description of when to use it.
- Slash commands: when a task is something the user may want to trigger on demand, add a custom command (.claude/commands/<name>.md).
- Subagents: when a recurring job benefits from an isolated, focused context (a code reviewer, a test runner, a doc writer), define one in .claude/agents/<name>.md with its own prompt and tool list.
- Tools: when no existing tool fits a task, build one — a script in the project (wire it up as a slash command or npm script), or a small MCP server registered in .mcp.json for capabilities every future session should have.
- Plugins & MCP servers: when a well-known plugin or MCP server solves the task better than building from scratch, install or register it (claude plugin install, or add it to .mcp.json) and say what you added and why.
Always tell the user what you created or installed and how to invoke it. Prefer small, composable pieces with clear descriptions over monoliths.`.trim()

/** Claude Desktop-style response styles, appended to the system prompt. */
const STYLE_PROMPTS: Record<string, string> = {
  concise:
    'Response style: be concise. Answer directly with minimal preamble, no filler, no restating the question. Short sentences, tight lists.',
  explanatory:
    'Response style: be explanatory. Walk through your reasoning, define terms, and include examples so the user learns the why, not just the what.',
  formal:
    'Response style: professional and formal. Complete sentences, precise terminology, no slang or emoji.'
}

const THINKING_RANK: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'ultra']

/** Smart thinking: pick a budget for THIS message, never above the user's
 *  chosen ceiling. Short chatter gets none; hard/code-heavy questions get more. */
export function smartThinkingLevel(text: string, ceiling: ThinkingLevel): ThinkingLevel {
  const capIdx = THINKING_RANK.indexOf(ceiling)
  if (capIdx <= 0) return 'off'
  const t = text.trim()
  const hard =
    /\b(why|debug|design|architect|refactor|optimi[sz]e|prove|plan|complex|race|deadlock|security|audit|investigate|root cause)\b/i.test(t)
  const code = /```|\berror\b|exception|stack trace|\.(ts|tsx|js|jsx|py|rs|cs|cpp|java|go)\b/i.test(t)
  let want: number
  if (t.length < 60 && !hard && !code) want = 0
  else if (hard && code) want = THINKING_RANK.indexOf('high')
  else if (hard || code || t.length > 400) want = THINKING_RANK.indexOf('medium')
  else want = THINKING_RANK.indexOf('low')
  return THINKING_RANK[Math.min(want, capIdx)]
}

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
  /** Initial extended-thinking level. */
  thinkingLevel?: ThinkingLevel
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
  /** Live output-token tracking for the streaming counter: confirmed tokens
   *  from finished API messages + a chars/4 estimate of the one in flight. */
  private turnConfirmedOut = 0
  private turnStreamChars = 0
  private lastStreamPush = 0
  /** Real window size from the last getContextUsage — lets mid-turn per-call
   *  usage update the gauge live instead of waiting for the turn result. */
  private lastMaxTokens = 0
  /** The user's chosen thinking ceiling, and what's currently applied (smart
   *  thinking scales per message but never above the ceiling). */
  private thinkingLevel: ThinkingLevel = 'off'
  private appliedThinking: ThinkingLevel = 'off'
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
        : this.provider === 'custom'
          ? (settings.customModel ?? undefined)
          : (settings.defaultModel ?? undefined)
    // Side chats are the "quick mode": read-only AND cheap — no thinking budget.
    const thinkingLevel = this.chatOnly
      ? 'off'
      : (opts.thinkingLevel ?? settings.defaultThinkingLevel ?? 'off')
    this.thinkingLevel = thinkingLevel
    this.appliedThinking = thinkingLevel
    const options: Options = {
      cwd: opts.cwd,
      resume: opts.resume,
      permissionMode: opts.permissionMode,
      model: opts.model ?? defaultModel,
      ...(THINKING_BUDGETS[thinkingLevel] > 0
        ? { thinking: { type: 'enabled', budgetTokens: THINKING_BUDGETS[thinkingLevel] } }
        : {}),
      includePartialMessages: true,
      enableFileCheckpointing: true,
      // Lets the user switch into Bypass mode mid-session; the UI confirms first.
      allowDangerouslySkipPermissions: true,
      // Full config (plugins, skills, MCP, user CLAUDE.md) for normal sessions.
      // Lean sessions and side chats drop the user level — a much smaller
      // context baseline; the project's own CLAUDE.md still loads.
      settingSources:
        settings.leanSessions || this.chatOnly
          ? ['project', 'local']
          : ['user', 'project', 'local'],
      ...((): { appendSystemPrompt?: string } => {
        const parts: string[] = []
        if (settings.allowSelfSkills && !this.chatOnly) parts.push(SELF_EXTEND_PROMPT)
        const style = STYLE_PROMPTS[settings.responseStyle]
        if (style) parts.push(style)
        return parts.length ? { appendSystemPrompt: parts.join('\n\n') } : {}
      })(),
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
            return Promise.resolve({ behavior: 'allow', updatedInput: input })
          }
        }
        return approvals.request(this.tabId, toolName, input, ctx)
      },
      stderr: (line: string) => {
        console.error(`[session ${this.tabId}] ${line}`)
      }
    }
    if (this.provider !== 'anthropic') {
      // Route the CLI's native Anthropic protocol at a compatible endpoint
      // (OpenRouter, or any user-configured gateway/proxy). Anthropic
      // credentials must be blanked (not just unset) or the CLI falls back to
      // its own login. Options.env REPLACES the subprocess env.
      const env: Record<string, string | undefined> = { ...process.env }
      env.ANTHROPIC_BASE_URL =
        this.provider === 'openrouter' ? OPENROUTER_BASE_URL : (settings.customBaseUrl ?? '')
      env.ANTHROPIC_AUTH_TOKEN =
        (this.provider === 'openrouter' ? secrets.getOpenRouterKey() : secrets.getCustomKey()) ??
        ''
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
      // Global lookup first: the {dir} variant silently finds nothing for
      // drive-root projects like E:\ (SDK path munging edge case).
      let messages = await getSessionMessages(sessionId).catch(() => [])
      if (messages.length === 0) messages = await getSessionMessages(sessionId, { dir: cwd })
      // Very long sessions: replay only the recent tail — enough to recognize
      // the conversation without hammering the UI with thousands of items.
      if (messages.length > 400) messages = messages.slice(-400)
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
          this.send({ kind: 'status_text', text: 'compacted' })
          break
        }
        if (msg.subtype === 'init') {
          this.sdkSessionId = msg.session_id
          this.usage.model = msg.model
          // Show the true context baseline (system prompt, tools, connectors)
          // as soon as the session is live — before any tokens are spent.
          void this.pushContextUsage()
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
          this.send({
            kind: 'assistant_delta',
            text: ev.delta.text,
            ...(this.turnPhase !== 'user' ? { phase: this.turnPhase } : {})
          })
          this.turnStreamChars += ev.delta.text.length
          // Throttled live counter: ~4 chars/token estimate for the in-flight
          // message, recalibrated to real usage when each API message lands.
          const now = Date.now()
          if (now - this.lastStreamPush > 250) {
            this.lastStreamPush = now
            this.send({
              kind: 'stream_tokens',
              outputTokens: this.turnConfirmedOut + Math.round(this.turnStreamChars / 4)
            })
          }
        }
        break
      }
      case 'assistant': {
        if (msg.error === 'authentication_failed' || msg.error === 'billing_error') {
          auth.notifyLoggedOut(msg.error)
        }
        if (!msg.parent_tool_use_id) {
          // An API message finished — fold its real output tokens into the
          // live counter and drop the char-based estimate for it.
          const u = (
            msg.message as {
              usage?: {
                output_tokens?: number
                input_tokens?: number
                cache_read_input_tokens?: number
                cache_creation_input_tokens?: number
              }
            }
          ).usage
          if (typeof u?.output_tokens === 'number') {
            this.turnConfirmedOut += u.output_tokens
            this.turnStreamChars = 0
            this.send({ kind: 'stream_tokens', outputTokens: this.turnConfirmedOut })
          }
          // Context of THIS call = its prompt side (never summed across calls —
          // cache reads repeat every call). Updates the gauge live mid-turn.
          const ctx =
            (u?.input_tokens ?? 0) +
            (u?.cache_read_input_tokens ?? 0) +
            (u?.cache_creation_input_tokens ?? 0)
          if (ctx > 0 && this.lastMaxTokens > 0) {
            this.send({
              kind: 'context_usage',
              totalTokens: ctx,
              maxTokens: this.lastMaxTokens,
              percentage: (ctx / this.lastMaxTokens) * 100
            })
          }
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
        this.send({
          kind: 'assistant_message',
          id: msg.uuid,
          text,
          toolUses,
          ...(this.turnPhase !== 'user' ? { phase: this.turnPhase } : {})
        })
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
        const costDelta = Math.max(0, msg.total_cost_usd - this.usage.costUsd)
        this.usage.inputTokens += u.input_tokens
        this.usage.outputTokens += u.output_tokens
        this.usage.cacheReadTokens += u.cache_read_input_tokens ?? 0
        this.usage.cacheCreationTokens += u.cache_creation_input_tokens ?? 0
        this.usage.costUsd = msg.total_cost_usd
        this.usage.turns = msg.num_turns
        this.usage.lastContextTokens =
          u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        usageStore.addDay({
          outputTokens: u.output_tokens,
          inputTokens: u.input_tokens,
          costUsd: costDelta,
          turns: 1
        })
        this.send({
          kind: 'turn_result',
          usage: { ...this.usage },
          costUsd: msg.total_cost_usd,
          isError: msg.subtype !== 'success',
          errorText: msg.subtype !== 'success' ? msg.subtype : undefined,
          turnTokens: { output: u.output_tokens, context: this.usage.lastContextTokens },
          ...(this.turnPhase !== 'user' ? { phase: this.turnPhase } : {})
        })
        this.turnConfirmedOut = 0
        this.turnStreamChars = 0
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
          if (this.turnHadMutations && !this.chatOnly) {
            // Project changed — keep the Workflow overview (and the copy in
            // project memory) current. Fingerprint + throttle gated inside.
            void projectExplain.maybeRefresh(this.cwd)
          }
        }
        // Token-free control requests: exact context fill for the gauge, and a
        // throttled plan-limits refresh for the usage bars.
        void this.pushContextUsage()
        void refreshPlanLimits(this)
        break
      }
    }
  }

  /** Ask the CLI what's actually in the context window (it knows the model's
   *  real window size — static tables get 1M-context models wrong). */
  async pushContextUsage(): Promise<void> {
    try {
      const cu = await this.q.getContextUsage()
      this.lastMaxTokens = cu.maxTokens
      this.send({
        kind: 'context_usage',
        totalTokens: cu.totalTokens,
        maxTokens: cu.maxTokens,
        percentage: cu.percentage
      })
    } catch {
      // older CLI without the control request — the static-table gauge stands
    }
  }

  async contextBreakdown(): Promise<ContextBreakdown | { error: string }> {
    try {
      const cu = await this.q.getContextUsage()
      const byServer = new Map<string, number>()
      for (const tool of cu.mcpTools ?? []) {
        byServer.set(tool.serverName, (byServer.get(tool.serverName) ?? 0) + tool.tokens)
      }
      return {
        totalTokens: cu.totalTokens,
        maxTokens: cu.maxTokens,
        percentage: cu.percentage,
        model: cu.model,
        categories: (cu.categories ?? []).map((c) => ({
          name: c.name,
          tokens: c.tokens,
          color: c.color
        })),
        mcpServers: [...byServer.entries()]
          .map(([name, tokens]) => ({ name, tokens }))
          .sort((a, b) => b.tokens - a.tokens)
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  async planLimits(): Promise<PlanLimits> {
    const report = await this.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
    const window = (
      w: { utilization: number | null; resets_at: string | null } | null | undefined
    ): { utilization: number; resetsAt?: number } | undefined => {
      if (!w || w.utilization === null) return undefined
      return {
        utilization: w.utilization,
        ...(w.resets_at ? { resetsAt: Date.parse(w.resets_at) } : {})
      }
    }
    return {
      available: report.rate_limits_available,
      subscriptionType: report.subscription_type ?? undefined,
      fiveHour: window(report.rate_limits?.five_hour),
      sevenDay: window(report.rate_limits?.seven_day),
      fetchedAt: Date.now()
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
      if (this.turnPhase !== 'user') this.send({ kind: 'cycle', phase: null })
      this.turnPhase = 'user'
      return false
    }
    if (this.turnPhase === 'user') {
      if (settings.autoRetrospective && (!settings.retroOnlyAfterEdits || this.turnHadMutations)) {
        this.turnPhase = 'retro'
        this.send({ kind: 'cycle', phase: 'retro' })
        this.pushText(RETRO_PROMPT)
        return true
      }
      if (this.shouldAutoCompact(settings.autoCompact)) {
        this.turnPhase = 'compact'
        this.send({ kind: 'cycle', phase: 'compact' })
        this.pushText('/compact')
        return true
      }
      return false
    }
    if (this.turnPhase === 'retro') {
      this.send({ kind: 'status_text', text: 'retrospective complete' })
      if (this.shouldAutoCompact(settings.autoCompact)) {
        this.turnPhase = 'compact'
        this.send({ kind: 'cycle', phase: 'compact' })
        this.pushText('/compact')
        return true
      }
      this.turnPhase = 'user'
      this.send({ kind: 'cycle', phase: null })
      return false
    }
    // compact finished
    this.turnPhase = 'user'
    this.send({ kind: 'cycle', phase: null })
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
    if (this.turnPhase !== 'user') this.send({ kind: 'cycle', phase: null })
    this.turnPhase = 'user' // a real user message restarts the auto follow-up cycle
    this.turnHadMutations = false
    this.turnConfirmedOut = 0
    this.turnStreamChars = 0
    // Smart thinking: budget this message by its complexity, capped at the
    // chosen level — "whats up" shouldn't spend an 18k thinking budget.
    if (!this.chatOnly && settingsStore.get().smartThinking) {
      const effective = smartThinkingLevel(text, this.thinkingLevel)
      if (effective !== this.appliedThinking) {
        this.appliedThinking = effective
        void this.q.setMaxThinkingTokens(THINKING_BUDGETS[effective]).catch(() => {})
      }
    }
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

  /** Change extended-thinking budget live (0 disables it for the rest of the session). */
  setThinking(level: ThinkingLevel): Promise<void> {
    this.thinkingLevel = level
    this.appliedThinking = level
    const budget = THINKING_BUDGETS[level] ?? 0
    return this.q.setMaxThinkingTokens(budget > 0 ? budget : 0)
  }

  async supportedModels(): Promise<ModelInfo[]> {
    const models = await this.q.supportedModels()
    return models.map((m) => ({
      id: m.value,
      displayName: m.displayName,
      description: m.description
    }))
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
  },
  /** Plan rate-limit windows, fetched through any live session (60s cache). */
  async limits(): Promise<PlanLimits> {
    const first = handles.values().next().value as SessionHandle | undefined
    return first ? refreshPlanLimits(first) : lastLimits
  }
}

// ---- plan rate-limit state (shared across sessions — limits are per account) ----

let lastLimits: PlanLimits = { available: false, fetchedAt: 0 }
let limitsInFlight = false
const LIMITS_TTL = 60_000

async function refreshPlanLimits(handle: SessionHandle): Promise<PlanLimits> {
  if (limitsInFlight || Date.now() - lastLimits.fetchedAt < LIMITS_TTL) return lastLimits
  limitsInFlight = true
  try {
    lastLimits = await handle.planLimits()
    broadcast('limits:update', lastLimits)
  } catch {
    // experimental endpoint unavailable — bars just stay hidden
  } finally {
    limitsInFlight = false
  }
  return lastLimits
}
