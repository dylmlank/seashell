import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readJsonFile } from '../src/sidecar/json-file'

const dir = mkdtempSync(join(tmpdir(), 'seashell-json-'))
const write = (name: string, body: string): string => {
  const p = join(dir, name)
  writeFileSync(p, body, 'utf8')
  return p
}

describe('readJsonFile', () => {
  test('reads plain JSON', () => {
    expect(readJsonFile<{ a: number }>(write('plain.json', '{"a":1}')).a).toBe(1)
  })

  test('reads JSON written with a UTF-8 BOM', () => {
    // Regression: PowerShell/Notepad prepend a BOM, JSON.parse throws on it,
    // and the caller silently fell back to defaults — which reset every
    // setting (permission mode, model, thinking) without telling anyone.
    const bom = String.fromCharCode(0xfeff)
    const path = write('bom.json', `${bom}{"defaultPermissionMode":"bypassPermissions"}`)
    expect(readJsonFile<{ defaultPermissionMode: string }>(path).defaultPermissionMode).toBe(
      'bypassPermissions'
    )
  })

  test('still throws on genuinely broken JSON', () => {
    expect(() => readJsonFile(write('bad.json', '{not json'))).toThrow()
  })
})
