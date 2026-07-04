import type { CyclePhase, TodoItem, UiEvent } from '@shared/types'

// The chat reducer: pure, window-free, and unit-tested — every sidecar event
// folds into the transcript through this one function.

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

let itemCounter = 0
export const nextId = (): string => `item-${++itemCounter}`

export function reduceEvent(items: ChatItem[], event: UiEvent): ChatItem[] {
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

