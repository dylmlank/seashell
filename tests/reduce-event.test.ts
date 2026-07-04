import { describe, expect, test } from 'bun:test'
import { reduceEvent, type ChatItem } from '../src/renderer/src/lib/reduce-event'
import type { UiEvent } from '../src/shared/types'

const apply = (events: UiEvent[], start: ChatItem[] = []): ChatItem[] =>
  events.reduce((items, e) => reduceEvent(items, e), start)

describe('reduceEvent', () => {
  test('replayed user messages append as user items', () => {
    const items = apply([{ kind: 'user_message', text: 'hello' }])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'user', text: 'hello' })
  })

  test('streaming deltas merge into one assistant bubble', () => {
    const items = apply([
      { kind: 'assistant_delta', text: 'Hel' },
      { kind: 'assistant_delta', text: 'lo' }
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'assistant', text: 'Hello', streaming: true })
  })

  test('assistant_message closes the stream and attaches tool cards', () => {
    const items = apply([
      { kind: 'assistant_delta', text: 'Working' },
      {
        kind: 'assistant_message',
        id: 'm1',
        text: 'Working',
        toolUses: [{ toolUseId: 't1', toolName: 'Read', input: {} }]
      },
      { kind: 'tool_result', toolUseId: 't1', text: 'file contents', isError: false }
    ])
    const tool = items.find((i) => i.kind === 'tool')
    expect(tool).toMatchObject({ toolName: 'Read', result: 'file contents', status: 'done' })
  })

  test('turn_result stamps the token receipt on the answer', () => {
    const items = apply([
      { kind: 'assistant_delta', text: 'done' },
      {
        kind: 'turn_result',
        usage: {
          inputTokens: 1,
          outputTokens: 500,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
          turns: 1,
          lastContextTokens: 30000
        },
        costUsd: 0,
        isError: false,
        turnTokens: { output: 500, context: 30000 }
      }
    ])
    expect(items[0]).toMatchObject({ kind: 'assistant', streaming: false, tokens: 500 })
  })

  test('phase-tagged deltas fold into an aside, and its receipt lands there', () => {
    const items = apply([
      { kind: 'assistant_delta', text: 'remembering…', phase: 'retro' },
      {
        kind: 'turn_result',
        usage: {
          inputTokens: 0,
          outputTokens: 120,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
          turns: 2,
          lastContextTokens: 31000
        },
        costUsd: 0,
        isError: false,
        turnTokens: { output: 120, context: 31000 },
        phase: 'retro'
      }
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'aside', phase: 'retro', tokens: 120 })
  })

  test('diffstat replaces a previous unclicked chip from the same burst', () => {
    const items = apply([
      { kind: 'diffstat', files: 2, insertions: 10, deletions: 1 },
      { kind: 'diffstat', files: 3, insertions: 25, deletions: 4 }
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'diffstat', files: 3, insertions: 25 })
  })

  test('unknown-ish events leave the transcript untouched', () => {
    const before = apply([{ kind: 'user_message', text: 'hi' }])
    const after = reduceEvent(before, {
      kind: 'context_usage',
      totalTokens: 1,
      maxTokens: 2,
      percentage: 50
    })
    expect(after).toBe(before)
  })
})
