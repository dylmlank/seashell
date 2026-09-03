/// <reference types="bun-types" />
import { expect, test } from 'bun:test'
import { DEFAULT_SETTINGS } from '../src/shared/default-settings'

// The app exists to run a retrospective and keep the context tidy after every
// answer. Both shipped off, so out of the box it did neither — these pin the
// behaviour to the intent.

test('a retrospective runs after every answer by default', () => {
  expect(DEFAULT_SETTINGS.autoRetrospective).toBe(true)
})

test('the retrospective is not limited to turns that edited files', () => {
  // A decision or a dead end is worth remembering even when nothing was
  // written, and "after every response" has to mean every response.
  expect(DEFAULT_SETTINGS.retroOnlyAfterEdits).toBe(false)
})

test('auto-compact is on by default', () => {
  expect(DEFAULT_SETTINGS.autoCompact).toBe(true)
})

test('compact stays threshold-based, above the floor the code enforces', () => {
  // Compacting a small context spends a call to save less than it costs, so
  // the threshold has to clear COMPACT_MIN_CONTEXT (30k) to mean anything.
  expect(DEFAULT_SETTINGS.compactThreshold).toBeGreaterThan(30_000)
  // ...but low enough to actually fire in a normal session.
  expect(DEFAULT_SETTINGS.compactThreshold).toBeLessThanOrEqual(60_000)
})

test('every setting has a default — a missing one reads as undefined at runtime', async () => {
  // AppSettings is structural, so a field added to the type without a default
  // typechecks here and only fails when the UI renders an undefined toggle.
  const { settingsStore } = await import('../src/sidecar/settings-store')
  const live = settingsStore.get()
  for (const key of Object.keys(live) as (keyof typeof live)[]) {
    expect(DEFAULT_SETTINGS[key]).toBeDefined()
  }
})
