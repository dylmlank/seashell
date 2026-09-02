/// <reference types="bun-types" />
import { expect, test } from 'bun:test'
import { hasRedactableSecrets, redactSecrets } from '../src/shared/redact'

test('masks every value in an env file, secret-looking or not', () => {
  const env = 'DATABASE_URL=postgres://u:p@host/db\nPORT=3000\n'
  const out = redactSecrets(env, 'C:/proj/.env')
  expect(out).toContain('DATABASE_URL=')
  expect(out).not.toContain('postgres://')
  expect(out).not.toContain('3000')
})

test('recognises .env.local and service.env as env-like', () => {
  expect(redactSecrets('A=b', '/p/.env.local')).not.toContain('=b')
  expect(redactSecrets('A=b', '/p/service.env')).not.toContain('=b')
})

test('outside env files, masks only keys that smell secret', () => {
  const src = 'const apiKey = "hunter2"\nconst port = 3000\n'
  const out = redactSecrets(src, '/p/config.ts')
  expect(out).toContain('port = 3000')
})

test('masks known token shapes anywhere they appear', () => {
  const prose = 'use sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 for that'
  expect(redactSecrets(prose)).not.toContain('sk-ant-api03')
  expect(redactSecrets('token ghp_abcdefghijklmnopqrstuvwxyz0123')).not.toContain('ghp_abcdef')
  expect(redactSecrets('id AKIAIOSFODNN7EXAMPLE here')).not.toContain('AKIAIOSFODNN7EXAMPLE')
})

test('masks a PEM private key block but keeps its shape', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK\n-----END RSA PRIVATE KEY-----'
  const out = redactSecrets(pem)
  expect(out).toContain('BEGIN PRIVATE KEY')
  expect(out).not.toContain('MIIEowIBAAK')
})

test('masks a JSON secret value and leaves its neighbours alone', () => {
  const json = '{\n  "api_key": "abcd1234",\n  "timeout": 30\n}'
  const out = redactSecrets(json, '/p/config.json')
  expect(out).not.toContain('abcd1234')
  expect(out).toContain('"timeout": 30')
})

test('keeps the key names visible so the user still sees what changed', () => {
  const out = redactSecrets('STRIPE_SECRET=sk_live_xyz', '/p/.env')
  expect(out).toContain('STRIPE_SECRET')
})

test('leaves ordinary source untouched', () => {
  const src = 'export function add(a: number, b: number) {\n  return a + b\n}\n'
  expect(redactSecrets(src, '/p/math.ts')).toBe(src)
  expect(hasRedactableSecrets(src, '/p/math.ts')).toBe(false)
})

test('hasRedactableSecrets flags a file that needs the reveal toggle', () => {
  expect(hasRedactableSecrets('API_TOKEN=abc', '/p/.env')).toBe(true)
})

test('detects env files given a Windows path', () => {
  // The path split has to handle backslashes; with a forward-slash-only
  // character class this silently stopped redacting on the primary platform.
  expect(redactSecrets('SECRET_TOKEN=abc123', String.raw`C:\proj\.env`)).not.toContain('abc123')
  expect(hasRedactableSecrets('PORT=3000', String.raw`C:\proj\.env`)).toBe(true)
})
