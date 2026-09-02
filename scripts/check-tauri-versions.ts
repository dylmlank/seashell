/// <reference types="bun-types" />
/**
 * Every Tauri plugin ships a Rust crate and an npm package, and Tauri requires
 * the pair to be on the same major.minor. Only `tauri build` enforces it, so a
 * drift surfaces for the first time during a release — after the tag is
 * pushed, with nothing published and a failed workflow to clean up. That is
 * exactly how v0.2.0's first attempt died: regenerating Cargo.lock moved
 * tauri-plugin-notification to 2.4.0 while the npm side stayed at 2.3.3.
 *
 * `tauri info` is not a substitute: it prints the semver requirement rather
 * than the resolved version, reports npm packages under bun's node_modules
 * layout as "not installed", and never emits the word "mismatch".
 */
import { readFileSync } from 'fs'
import { join } from 'path'

export interface Pair {
  crate: string
  crateVersion: string
  npm: string
  npmVersion: string
}

const minor = (v: string): string => v.split('.').slice(0, 2).join('.')

/** Pairs whose major.minor disagree. */
export function mismatches(pairs: Pair[]): Pair[] {
  return pairs.filter((p) => minor(p.crateVersion) !== minor(p.npmVersion))
}

/** Resolved versions of every `tauri*` package in a Cargo.lock. */
export function crateVersions(lock: string): Map<string, string> {
  const found = new Map<string, string>()
  // Entries are `[[package]]` blocks with name then version on the next line.
  const re = /\[\[package\]\]\s*\nname = "([^"]+)"\s*\nversion = "([^"]+)"/g
  for (const [, name, version] of lock.matchAll(re)) {
    if (name === 'tauri' || name.startsWith('tauri-plugin-')) found.set(name, version)
  }
  return found
}

/** The npm package a crate must agree with, or null when it has no JS half. */
export function npmCounterpart(crate: string): string | null {
  if (crate === 'tauri') return '@tauri-apps/api'
  if (!crate.startsWith('tauri-plugin-')) return null
  return `@tauri-apps/plugin-${crate.slice('tauri-plugin-'.length)}`
}

function installedVersion(root: string, pkg: string): string | null {
  try {
    const raw = readFileSync(join(root, 'node_modules', ...pkg.split('/'), 'package.json'), 'utf8')
    return (JSON.parse(raw) as { version: string }).version
  } catch {
    return null // Rust-only plugin (opener, single-instance) — nothing to match.
  }
}

export function collectPairs(root: string): Pair[] {
  const lock = readFileSync(join(root, 'src-tauri', 'Cargo.lock'), 'utf8')
  const pairs: Pair[] = []
  for (const [crate, crateVersion] of crateVersions(lock)) {
    const npm = npmCounterpart(crate)
    if (!npm) continue
    const npmVersion = installedVersion(root, npm)
    if (npmVersion) pairs.push({ crate, crateVersion, npm, npmVersion })
  }
  return pairs
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..')
  const pairs = collectPairs(root)
  const bad = mismatches(pairs)
  for (const p of pairs) {
    const mark = bad.includes(p) ? 'x' : 'ok'
    console.log(`${mark.padEnd(3)} ${p.crate} ${p.crateVersion}  |  ${p.npm} ${p.npmVersion}`)
  }
  if (bad.length > 0) {
    console.error(
      `\n${bad.length} Tauri package pair(s) disagree on major.minor. ` +
        'Bump the npm side to match the crate, or pin the crate down.'
    )
    process.exit(1)
  }
  console.log(`\n${pairs.length} Tauri package pairs agree.`)
}
