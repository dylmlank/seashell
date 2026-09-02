/// <reference types="bun-types" />
import { expect, test } from 'bun:test'
import {
  collectPairs,
  crateVersions,
  mismatches,
  npmCounterpart,
  type Pair
} from '../scripts/check-tauri-versions'
import { join } from 'path'

const pair = (crateVersion: string, npmVersion: string): Pair => ({
  crate: 'tauri-plugin-notification',
  crateVersion,
  npm: '@tauri-apps/plugin-notification',
  npmVersion
})

test('catches the drift that broke the first v0.2.0 release build', () => {
  expect(mismatches([pair('2.4.0', '2.3.3')])).toHaveLength(1)
})

test('a patch-level difference is fine — Tauri only requires major.minor', () => {
  expect(mismatches([pair('2.7.3', '2.7.1')])).toHaveLength(0)
})

test('identical versions pass', () => {
  expect(mismatches([pair('2.11.0', '2.11.0')])).toHaveLength(0)
})

test('a major difference is caught', () => {
  expect(mismatches([pair('3.0.0', '2.0.0')])).toHaveLength(1)
})

test('reads resolved versions out of a Cargo.lock, ignoring unrelated crates', () => {
  const lock = `
[[package]]
name = "serde"
version = "1.0.0"

[[package]]
name = "tauri"
version = "2.9.1"

[[package]]
name = "tauri-plugin-notification"
version = "2.4.0"
`
  const found = crateVersions(lock)
  expect(found.get('tauri')).toBe('2.9.1')
  expect(found.get('tauri-plugin-notification')).toBe('2.4.0')
  expect(found.has('serde')).toBe(false)
})

test('maps crates to the npm package they must agree with', () => {
  expect(npmCounterpart('tauri')).toBe('@tauri-apps/api')
  expect(npmCounterpart('tauri-plugin-dialog')).toBe('@tauri-apps/plugin-dialog')
  expect(npmCounterpart('serde')).toBeNull()
})

test('this repo currently agrees on every pair', () => {
  const pairs = collectPairs(join(import.meta.dir, '..'))
  // Rust-only plugins (opener, single-instance) have no npm half to compare.
  expect(pairs.length).toBeGreaterThan(0)
  expect(mismatches(pairs)).toEqual([])
})
