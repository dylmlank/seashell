/// <reference types="bun-types" />
import { expect, test } from 'bun:test'
import { DEFAULT_SETTINGS } from '../src/shared/default-settings'

// The app exists to run a retrospective and keep the context tidy after every
// answer. Both shipped off, so out of the box it did neither — these pin the
// behaviour to the intent.

test('the retrospective is on by default', () => {
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

test('compact and retro share one trigger, above the floor the code enforces', () => {
  // Below COMPACT_MIN_CONTEXT (30k) the trigger would never fire at all.
  expect(DEFAULT_SETTINGS.compactThreshold).toBeGreaterThan(30_000)
  expect(DEFAULT_SETTINGS.compactThreshold).toBe(100_000)
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
