import { memo, useEffect, useRef, useState } from 'react'
import {
  Undo2,
  ImageIcon,
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Brain,
  Minimize2
} from 'lucide-react'
import { rewindTo, sendMessage, useSessions, type ChatItem } from '../stores/sessions'
import { useSettings } from '../stores/settings'
import { chatWidthClass } from '../lib/chat-width'
import { Markdown } from './Markdown'
import { SmoothText } from './SmoothText'
import { PlanCard } from './PlanCard'
import { ToolCallCard, summarizeInput } from './ToolCallCard'
import { confirmDialog } from '../lib/dialogs'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>
type AsideItem = Extract<ChatItem, { kind: 'aside' }>
type ShotsItem = Extract<ChatItem, { kind: 'shots' }>

/** Auto-captured screenshots of what a turn changed: a small filmstrip that
 *  cycles through its frames (before/after/mobile) like a gif; click to zoom. */
function ShotsCard({ item }: { item: ShotsItem }): React.JSX.Element {
  const [index, setIndex] = useState(item.frames.length - 1)
  const [paused, setPaused] = useState(false)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    if (item.frames.length < 2 || paused || zoom) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % item.frames.length), 1500)
    return () => clearInterval(timer)
  }, [item.frames.length, paused, zoom])

  const frame = item.frames[index]

  return (
    <div
      className="ml-8 max-w-lg overflow-hidden rounded-xl border border-border bg-surface anim-in"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-dim">
        <ImageIcon size={12} className="text-accent" />
        <span className="truncate font-mono">{item.title}</span>
        <span className="ml-auto flex gap-1">
          {item.frames.map((f, i) => (
            <button
              key={f.label}
              onClick={() => setIndex(i)}
              className={
                'rounded-md px-1.5 py-0.5 text-[10px] capitalize ' +
                (i === index ? 'bg-accent/20 text-accent' : 'hover:bg-surface-2')
              }
            >
              {f.label}
            </button>
          ))}
        </span>
      </div>
      <button onClick={() => setZoom(true)} className="block w-full" title="Click to enlarge">
        <img
          src={`data:image/png;base64,${frame.data}`}
          alt={`${item.title} — ${frame.label}`}
          className="max-h-72 w-full border-t border-border/60 object-cover object-top"
        />
      </button>
      <p className="px-3 py-1 text-[10px] text-text-dim/50">captured automatically after this turn</p>
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setZoom(false)}
        >
          <img
            src={`data:image/png;base64,${frame.data}`}
            alt={item.title}
            className="max-h-full max-w-full rounded-xl border border-border shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}

/** Retrospective/compaction output — housekeeping, not conversation. Rendered
 *  as a dimmed collapsible card so it never blends into the answers. */
function AsideCard({ item }: { item: AsideItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const label = item.phase === 'retro' ? 'Retrospective' : 'Compaction'
  return (
    <div className="mx-4 rounded-xl border border-border/50 bg-surface/50 anim-in">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-dim hover:text-text"
      >
        {item.phase === 'retro' ? (
          <Brain size={13} className={item.streaming ? 'pulse-dot text-accent' : 'text-accent/60'} />
        ) : (
          <Minimize2 size={13} className={item.streaming ? 'pulse-dot text-accent' : 'text-accent/60'} />
        )}
        {item.streaming ? (
          <span className="shimmer-text">
            {item.phase === 'retro' ? 'Writing retrospective…' : 'Compacting…'}
          </span>
        ) : (
          <span>{label}</span>
        )}
        {item.toolCount > 0 && !item.streaming && (
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px]">
            {item.toolCount} memory update{item.toolCount > 1 ? 's' : ''}
          </span>
        )}
        <span className="ml-auto">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {open && item.text.trim() && (
        <div className="border-t border-border/50 px-3 py-2 text-sm opacity-70">
          <Markdown text={item.text} />
        </div>
      )}
    </div>
  )
}

function RewindButton({ tabId, uuid }: { tabId: string; uuid: string }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [detail, setDetail] = useState('')

  const run = async (): Promise<void> => {
    if (!(await confirmDialog('Restore all files to their state at this message? The conversation itself is kept.')))
      return
    setState('busy')
    const result = await rewindTo(tabId, uuid)
    setDetail(result.detail)
    setState(result.ok ? 'done' : 'error')
  }

  if (state === 'busy') return <Loader2 size={12} className="animate-spin text-accent" />
  if (state !== 'idle')
    return (
      <span className={'text-xs ' + (state === 'done' ? 'text-green-500' : 'text-red-400')}>
        {detail}
      </span>
    )
  return (
    <button
      onClick={() => void run()}
      title="Rewind files to this point"
      className="rounded p-1 text-text-dim opacity-0 transition-opacity hover:bg-surface-2 hover:text-accent group-hover:opacity-100"
    >
      <Undo2 size={13} />
    </button>
  )
}

/** A run of consecutive tool calls, collapsed into one expandable "working" strip. */
function ActivityGroup({ items }: { items: ToolItem[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const running = items.some((i) => i.status === 'running')
  const failed = items.some((i) => i.status === 'error')
  const latest = items[items.length - 1]
  const names = [...new Set(items.map((i) => i.toolName))]
  const nameSummary = names.slice(0, 4).join(' · ') + (names.length > 4 ? ' · …' : '')

  return (
    <div className="anim-in overflow-hidden rounded-xl border border-border/60 bg-surface/40 text-sm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-text-dim" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-text-dim" />
        )}
        {running ? (
          <>
            <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
            <span className="shimmer-text min-w-0 truncate">
              Working… {latest.toolName} {summarizeInput(latest.input)}
            </span>
          </>
        ) : (
          <>
            {failed ? (
              <XCircle size={14} className="shrink-0 text-red-400" />
            ) : (
              <CheckCircle2 size={14} className="shrink-0 text-green-500" />
            )}
            <span className="text-text-dim">
              {items.length} step{items.length > 1 ? 's' : ''}
            </span>
            <span className="min-w-0 truncate text-xs text-text-dim/70">{nameSummary}</span>
          </>
        )}
        <span className="ml-auto shrink-0 text-[11px] text-text-dim/50">
          {open ? 'hide' : 'details'}
        </span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-border/60 bg-bg/40 px-2 py-2">
          {items.map((item) => (
            <ToolCallCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({
  item,
  tabId
}: {
  item: ChatItem
  tabId: string
}): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return (
        <div className="group flex items-center justify-end gap-1.5 anim-in">
          {item.uuid && <RewindButton tabId={tabId} uuid={item.uuid} />}
          <div className="max-w-[75%] rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 whitespace-pre-wrap">
            {item.imageCount ? (
              <span className="mb-1 flex items-center gap-1 text-xs text-text-dim">
                <ImageIcon size={12} /> {item.imageCount} image{item.imageCount > 1 ? 's' : ''}
              </span>
            ) : null}
            {item.text}
          </div>
        </div>
      )
    case 'assistant':
      if (!item.text.trim()) return null
      return (
        <div className="flex max-w-[95%] gap-3 anim-in">
          <span className="mt-1 h-5 w-5 shrink-0 select-none rounded-md bg-accent/15 text-center text-[11px] leading-5 text-accent">
            ✳
          </span>
          <div className="min-w-0">
            <SmoothText text={item.text} streaming={item.streaming} />
            {!item.streaming && item.tokens !== undefined && (
              <div className="pt-1 text-[10px] tabular-nums text-text-dim/50" title="Output tokens this turn generated">
                {item.tokens >= 1000 ? `${(item.tokens / 1000).toFixed(1)}k` : item.tokens} tokens
              </div>
            )}
          </div>
        </div>
      )
    case 'aside':
      return <AsideCard item={item} />
    case 'shots':
      return <ShotsCard item={item} />
    case 'plan':
      return <PlanCard todos={item.todos} />
    case 'status':
      return (
        <div className="flex items-center gap-3 py-1 anim-in">
          <span className="h-px flex-1 bg-border/60" />
          <span className="text-xs text-text-dim">{item.text}</span>
          <span className="h-px flex-1 bg-border/60" />
        </div>
      )
    case 'tool':
      return <ToolCallCard item={item} />
  }
})

const SUGGESTIONS = [
  'Explain this codebase to me',
  'What changed here recently?',
  'Find and fix a bug',
  'Write a README for this project'
]

const CHAT_ONLY_SUGGESTIONS = [
  'Explain this codebase to me',
  'How does this project work?',
  'Where is the main entry point?'
]

/** Collapse consecutive tool items into activity groups; everything else renders as-is. */
type RenderEntry =
  | { kind: 'single'; item: ChatItem }
  | { kind: 'group'; id: string; tools: ToolItem[] }

function toEntries(items: ChatItem[]): RenderEntry[] {
  const entries: RenderEntry[] = []
  for (const item of items) {
    const last = entries[entries.length - 1]
    if (item.kind === 'tool' && last?.kind === 'group') {
      last.tools.push(item)
    } else if (item.kind === 'tool') {
      entries.push({ kind: 'group', id: item.id, tools: [item] })
    } else {
      entries.push({ kind: 'single', item })
    }
  }
  return entries
}

export function MessageList({
  items,
  tabId,
  chatOnly
}: {
  items: ChatItem[]
  tabId: string
  /** Read-only side chat: different greeting and suggestions. */
  chatOnly?: boolean
}): React.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const chatWidth = useSettings((s) => s.settings.chatWidth)

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
    }
  }, [items])

  return (
    <div
      ref={containerRef}
      onScroll={() => {
        const el = containerRef.current
        if (!el) return
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      }}
      className="flex-1 overflow-y-auto px-6 py-6"
    >
      <div className={`mx-auto w-full space-y-4 ${chatWidthClass(chatWidth)}`}>
        {items.length === 0 && (
          <div className="stagger flex flex-col items-center gap-2 pt-20 text-center">
            <span className="brand-float flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-xl shadow-lg shadow-accent/10">
              🐚
            </span>
            <p className="mt-2 text-lg font-medium">
              {chatOnly ? 'Ask me anything' : 'What are we working on?'}
            </p>
            <p className="text-sm text-text-dim">
              {chatOnly
                ? 'This chat can read the project and search, but never changes anything.'
                : 'Claude can read, edit, and run things in this folder — you approve each action.'}
            </p>
            <div className="mt-4 flex max-w-md flex-wrap justify-center gap-2">
              {(chatOnly ? CHAT_ONLY_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(tabId, s)}
                  className="rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-text-dim transition-all hover:-translate-y-0.5 hover:border-accent-dim/60 hover:text-text"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {toEntries(items).map((entry) => (
          <div key={entry.kind === 'group' ? entry.id : entry.item.id} className="msg-in">
            {entry.kind === 'group' && entry.tools.length > 1 ? (
              <ActivityGroup items={entry.tools} />
            ) : entry.kind === 'group' ? (
              <ToolCallCard item={entry.tools[0]} />
            ) : (
              <MessageBubble item={entry.item} tabId={tabId} />
            )}
          </div>
        ))}
        <TurnIndicator items={items} tabId={tabId} />
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

/** Animated state line under the transcript: thinking / compacting. Tool runs
 *  and retro asides carry their own spinners, so this fills the gaps. */
function TurnIndicator({ items, tabId }: { items: ChatItem[]; tabId: string }): React.JSX.Element | null {
  const status = useSessions((s) => s.tabs.find((t) => t.tabId === tabId)?.status)
  const cyclePhase = useSessions((s) => s.tabs.find((t) => t.tabId === tabId)?.cyclePhase)

  if (cyclePhase === 'compact') {
    return (
      <div className="flex items-center gap-2 px-1 text-xs text-text-dim anim-in">
        <Minimize2 size={13} className="pulse-dot text-accent" />
        <span className="shimmer-text">Compacting context…</span>
      </div>
    )
  }
  if (status !== 'streaming' || cyclePhase) return null
  const last = items[items.length - 1]
  // A streaming text bubble has its own cursor; a running tool has a spinner.
  if (last?.kind === 'assistant' && last.streaming && last.text.trim()) return null
  if (last?.kind === 'tool' && last.status === 'running') return null
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-text-dim anim-in">
      <span className="pulse-dot inline-block h-4 w-4 select-none rounded bg-accent/15 text-center text-[10px] leading-4 text-accent">
        ✳
      </span>
      <span className="shimmer-text">Thinking…</span>
    </div>
  )
}
