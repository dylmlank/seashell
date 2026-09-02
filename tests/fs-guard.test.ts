/// <reference types="bun-types" />
import { expect, test } from 'bun:test'
import { resolve, sep } from 'path'
import { resolveWithin } from '../src/sidecar/fs-guard'

const root = resolve(sep, 'work', 'app')

test('resolves an ordinary relative path inside the root', () => {
  expect(resolveWithin(root, 'src/index.ts')).toBe(resolve(root, 'src/index.ts'))
})

test('allows the root itself', () => {
  expect(resolveWithin(root, '.')).toBe(root)
})

test('rejects a traversal out of the root', () => {
  expect(resolveWithin(root, '../secrets.env')).toBeNull()
  expect(resolveWithin(root, 'src/../../secrets.env')).toBeNull()
})

test('rejects a sibling whose name merely starts with the root', () => {
  // The bug a plain startsWith() check has: /work/app-secrets is not in /work/app.
  expect(resolveWithin(root, '..', 'app-secrets', 'token')).toBeNull()
})

test('rejects an absolute path outside the root', () => {
  expect(resolveWithin(root, resolve(sep, 'etc', 'passwd'))).toBeNull()
})

test('accepts an absolute path that is inside the root', () => {
  const inside = resolve(root, 'src', 'main.ts')
  expect(resolveWithin(root, inside)).toBe(inside)
})
