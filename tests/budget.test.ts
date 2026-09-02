/// <reference types="bun-types" />
import { beforeEach, expect, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Point the stores at a scratch profile before anything imports paths.
process.env.CLAUDE_SHELL_USER_DATA = mkdtempSync(join(tmpdir(), 'seashell-budget-'))

const { budget } = await import('../src/sidecar/budget')
const { settingsStore } = await import('../src/sidecar/settings-store')
const { usageStore } = await import('../src/sidecar/usage-store')

beforeEach(() => {
  budget.reset()
})

test('says nothing when no limit is set', () => {
  settingsStore.set({ dailyBudgetUsd: null, sessionBudgetUsd: null })
  expect(budget.evaluate('s1', 999)).toEqual([])
})

test('warns at 80% of a session limit', () => {
  settingsStore.set({ dailyBudgetUsd: null, sessionBudgetUsd: 10 })
  const alerts = budget.evaluate('s1', 8)
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toMatchObject({ scope: 'session', level: 'warning', limitUsd: 10 })
})

test('stays quiet below the warning threshold', () => {
  settingsStore.set({ dailyBudgetUsd: null, sessionBudgetUsd: 10 })
  expect(budget.evaluate('s1', 7.99)).toEqual([])
})

test('each threshold fires only once per session', () => {
  settingsStore.set({ dailyBudgetUsd: null, sessionBudgetUsd: 10 })
  expect(budget.evaluate('s1', 8)).toHaveLength(1)
  expect(budget.evaluate('s1', 8.5)).toHaveLength(0)
  expect(budget.evaluate('s1', 9)).toHaveLength(0)
})

test('escalates to exceeded, then goes quiet', () => {
  settingsStore.set({ dailyBudgetUsd: null, sessionBudgetUsd: 10 })
  expect(budget.evaluate('s1', 8)[0].level).toBe('warning')
  expect(budget.evaluate('s1', 11)[0].level).toBe('exceeded')
  expect(budget.evaluate('s1', 12)).toHaveLength(0)
})

test('jumping straight past the limit never emits a late warning', () => {
  settingsStore.set({ dailyBudgetUsd: null, sessionBudgetUsd: 10 })
  expect(budget.evaluate('s1', 20)[0].level).toBe('exceeded')
  expect(budget.evaluate('s1', 21)).toHaveLength(0)
})

test('tracks sessions independently', () => {
  settingsStore.set({ dailyBudgetUsd: null, sessionBudgetUsd: 10 })
  expect(budget.evaluate('s1', 9)).toHaveLength(1)
  expect(budget.evaluate('s2', 9)).toHaveLength(1)
})

test('daily limit reads the folded day bucket, not the session total', () => {
  settingsStore.set({ dailyBudgetUsd: 5, sessionBudgetUsd: null })
  usageStore.addDay({ outputTokens: 0, inputTokens: 0, costUsd: 4.5, turns: 1 })
  const alerts = budget.evaluate('s-any', 0.01)
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toMatchObject({ scope: 'daily', level: 'warning' })
})

test('reset lets a changed limit alert again', () => {
  settingsStore.set({ dailyBudgetUsd: null, sessionBudgetUsd: 10 })
  expect(budget.evaluate('s1', 9)).toHaveLength(1)
  budget.reset()
  expect(budget.evaluate('s1', 9)).toHaveLength(1)
})
