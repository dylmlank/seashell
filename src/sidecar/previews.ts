import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { ProjectPreview } from '../shared/types'
import { changes } from './changes'
import { listProjectFiles } from './file-index'
import { history } from './history'
import { userDataDir } from './paths'

// Visual identity per language — used for the stacked bar on project cards.
const LANG_COLORS: Record<string, [string, string]> = {
  ts: ['#3178c6', 'TypeScript'],
  tsx: ['#3178c6', 'TypeScript'],
  js: ['#f1e05a', 'JavaScript'],
  jsx: ['#f1e05a', 'JavaScript'],
  rs: ['#dea584', 'Rust'],
  py: ['#3572a5', 'Python'],
  html: ['#e34c26', 'HTML'],
  css: ['#663399', 'CSS'],
  json: ['#8b8b8b', 'JSON'],
  md: ['#4b9e6c', 'Markdown'],
  lua: ['#000080', 'Lua'],
  cs: ['#178600', 'C#'],
  cpp: ['#f34b7d', 'C++'],
  c: ['#555555', 'C'],
  java: ['#b07219', 'Java'],
  go: ['#00add8', 'Go'],
  ps1: ['#012456', 'PowerShell'],
  toml: ['#9c4221', 'TOML'],
  yml: ['#cb171e', 'YAML'],
  yaml: ['#cb171e', 'YAML'],
  svg: ['#ffb13b', 'SVG'],
  wav: ['#c084fc', 'Audio'],
  mp3: ['#c084fc', 'Audio'],
  blend: ['#ea7600', 'Blender']
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function shotPath(cwd: string): string {
  const dir = join(userDataDir(), 'previews')
  mkdirSync(dir, { recursive: true })
  const hash = createHash('sha1').update(cwd.toLowerCase()).digest('hex').slice(0, 12)
  return join(dir, `${hash}.png`)
}

async function readmeLine(cwd: string): Promise<string> {
  try {
    const raw = await readFile(join(cwd, 'README.md'), 'utf8')
    const line = raw
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('!') && !l.startsWith('<'))
    return line?.replace(/[*_`[\]]/g, '').slice(0, 90) ?? ''
  } catch {
    return ''
  }
}

/** A deterministic "cover art" SVG for a project: name, description, language mix. */
async function projectCard(cwd: string, name: string): Promise<string> {
  const files = await listProjectFiles(cwd)
  const byLang = new Map<string, number>()
  for (const f of files) {
    const ext = f.split('.').pop()?.toLowerCase() ?? ''
    if (LANG_COLORS[ext]) byLang.set(ext, (byLang.get(ext) ?? 0) + 1)
  }
  const top = [...byLang.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  const langTotal = top.reduce((s, [, n]) => s + n, 0) || 1

  let branch = ''
  try {
    const b = await changes.branches(cwd)
    if (!('error' in b)) branch = b.current
  } catch {
    // not a git repo
  }
  const desc = await readmeLine(cwd)

  // Stacked language bar
  const barY = 236
  let x = 32
  const segments = top
    .map(([ext, n]) => {
      const w = Math.max(8, (n / langTotal) * 576)
      const rect = `<rect x="${x}" y="${barY}" width="${w}" height="8" rx="4" fill="${LANG_COLORS[ext][0]}"/>`
      x += w + 4
      return rect
    })
    .join('')
  const legend = top
    .map(([ext, n], i) => {
      const lx = 32 + i * 150
      return `<circle cx="${lx}" cy="266" r="4" fill="${LANG_COLORS[ext][0]}"/><text x="${lx + 10}" y="270" font-size="12" fill="#9ca3af">${esc(LANG_COLORS[ext][1])} · ${n}</text>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101616"/>
      <stop offset="1" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>
  <rect width="640" height="320" fill="url(#bg)"/>
  <circle cx="590" cy="40" r="140" fill="#14b8a6" opacity="0.05"/>
  <text x="32" y="52" font-size="15" fill="#14b8a6" font-family="Consolas,monospace">✳</text>
  <text x="56" y="52" font-size="13" fill="#6b7280" font-family="Consolas,monospace">${esc(cwd).slice(0, 60)}</text>
  <text x="32" y="112" font-size="34" font-weight="600" fill="#ededed" font-family="Segoe UI,sans-serif">${esc(name).slice(0, 28)}</text>
  ${desc ? `<text x="32" y="146" font-size="15" fill="#9ca3af" font-family="Segoe UI,sans-serif">${esc(desc)}</text>` : ''}
  <text x="32" y="196" font-size="13" fill="#6b7280" font-family="Segoe UI,sans-serif">${files.length} files${branch ? `   ·   ⎇ ${esc(branch)}` : ''}</text>
  ${segments}
  ${legend}
</svg>`
}

export function findEdge(): string | null {
  for (const p of [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ]) {
    if (existsSync(p)) return p
  }
  return null
}

/** One headless-Edge screenshot of a URL (http(s) or file://) to a PNG path.
 *  Needs its own profile dir — with the user's default profile (usually locked
 *  by a running Edge) headless exits silently without writing anything. */
export function captureShot(
  url: string,
  outPath: string,
  width = 1280,
  height = 800
): Promise<boolean> {
  const edge = findEdge()
  if (!edge) return Promise.resolve(false)
  const profile = join(userDataDir(), 'previews', 'edge-profile')
  mkdirSync(profile, { recursive: true })
  return new Promise((resolve) => {
    execFile(
      edge,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        `--user-data-dir=${profile}`,
        '--hide-scrollbars',
        `--window-size=${width},${height}`,
        `--screenshot=${outPath}`,
        url
      ],
      { timeout: 25000, windowsHide: true },
      (err) => resolve(!err && existsSync(outPath))
    )
  })
}

export const previews = {
  /** Cards for the most recent projects: generated SVG + captured screenshot when present. */
  async cards(): Promise<ProjectPreview[]> {
    const projects = (await history.listProjects()).slice(0, 8)
    return Promise.all(
      projects.map(async (p) => {
        const name = p.realPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p.realPath
        const svg = await projectCard(p.realPath, name).catch(
          () => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#0a0a0a"/><text x="32" y="112" font-size="34" fill="#ededed">${esc(name)}</text></svg>`
        )
        const shot = shotPath(p.realPath)
        let screenshot: string | undefined
        if (existsSync(shot)) {
          screenshot = (await readFile(shot)).toString('base64')
        }
        return {
          cwd: p.realPath,
          name,
          lastActive: p.lastActive,
          sessionCount: p.sessionCount,
          svg,
          screenshot
        }
      })
    )
  },

  /** Screenshot a URL with headless Edge (already on every Win11 box) and file
   *  it as the project's preview image. */
  async capture(cwd: string, url: string): Promise<{ ok: true } | { error: string }> {
    if (!/^https?:\/\//.test(url)) return { error: 'URL must start with http(s)://' }
    if (!findEdge()) return { error: 'Microsoft Edge not found for headless capture' }
    const ok = await captureShot(url, shotPath(cwd))
    return ok ? { ok: true } : { error: 'Capture produced no image' }
  }
}
