import { describe, expect, test } from 'bun:test'
import { smartModelChoice, smartThinkingLevel } from '../src/sidecar/session-manager'

const OPUS = 'claude-opus-4-8[1m]'

describe('smartThinkingLevel', () => {
  test('short chatter gets no thinking', () => {
    expect(smartThinkingLevel('whats up', 'high')).toBe('off')
    expect(smartThinkingLevel('thanks!', 'ultra')).toBe('off')
    expect(smartThinkingLevel('ok run the build', 'high')).toBe('off')
  })

  test('ceiling off disables thinking entirely', () => {
    expect(smartThinkingLevel('debug this complex race condition', 'off')).toBe('off')
  })

  test('hard + code grades high', () => {
    expect(
      smartThinkingLevel('why does this error happen? ```ts\nfoo()\n``` debug it', 'high')
    ).toBe('high')
  })

  test('coding intent worded casually never grades as chatter', () => {
    // The exact regression that shipped once: a build ask downgraded to Q&A tier.
    expect(smartThinkingLevel('add a button to the settings page', 'high')).not.toBe('off')
    expect(smartThinkingLevel('make the sidebar collapsible', 'high')).not.toBe('off')
    expect(smartThinkingLevel('fix the bug in the preview tab', 'high')).not.toBe('off')
  })

  test('ceiling caps the grade', () => {
    expect(smartThinkingLevel('debug this error ```code```', 'low')).toBe('low')
  })
})

describe('smartModelChoice', () => {
  test('trivial chatter routes to haiku', () => {
    expect(smartModelChoice('whats up', OPUS)).toBe('haiku')
  })

  test('ordinary questions route to sonnet', () => {
    expect(smartModelChoice('summarize what this repo does for me please and thanks', OPUS)).toBe(
      'sonnet'
    )
  })

  test('coding intent routes to the preferred model even without code blocks', () => {
    expect(smartModelChoice('add a button to the settings page', OPUS)).toBe(OPUS)
    expect(smartModelChoice('implement the login feature', OPUS)).toBe(OPUS)
    expect(smartModelChoice('fix the crash when I click preview', OPUS)).toBe(OPUS)
  })

  test('hard debugging with code routes to the preferred model', () => {
    expect(smartModelChoice('why does this throw? ```ts\nx()\n``` debug it', OPUS)).toBe(OPUS)
  })
})
