import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { ChatItem, TabState } from '../stores/sessions'

// Automatic visual proof: after a turn that edits pages/styles/components,
// capture the project's site (via a hidden app webview — same network stack
// as the app, unlike headless browsers which VPN filters can block) or the
// HTML file it wrote, and paste the frames into the chat as a filmstrip.

const COMMON_DEV_PORTS = new Set([
  1420, 3000, 3001, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8081
])

const VISUAL_EXT = /\.(html?|svg|css|scss|tsx|jsx|vue|svelte|astro)$/i
const RENDERABLE_EXT = /\.(html?|svg)$/i

/** "before" frames captured at turn start, keyed by tabId. */
const beforeFrames = new Map<string, string>()

const urlKey = (cwd: string): string => `shot-url:${cwd.toLowerCase()}`

async function resolveUrl(cwd: string): Promise<string | null> {
  const remembered = localStorage.getItem(urlKey(cwd))
  if (remembered) return remembered
  const listening = await window.api.invoke('ports:list')
  if ('error' in listening) return null
  const dev = listening.filter((p) => COMMON_DEV_PORTS.has(p.port))
  // Only guess when it's unambiguous.
  return dev.length === 1 ? `http://localhost:${dev[0].port}` : null
}

async function captureUrl(url: string, width: number, height: number): Promise<string | null> {
  try {
    return await tauriInvoke<string>('capture_url', { url, width, height })
  } catch {
    return null
  }
}

/** What did this turn touch visually? Scan back to the turn's user message. */
function detectVisual(items: ChatItem[]): { touched: boolean; artifact?: string } {
  let touched = false
  let artifact: string | undefined
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'user') break
    if (item.kind === 'tool' && /^(Write|Edit|MultiEdit)$/.test(item.toolName)) {
      const fp = String(item.input.file_path ?? '')
      if (VISUAL_EXT.test(fp)) touched = true
      if (RENDERABLE_EXT.test(fp)) artifact = fp
    }
  }
  return { touched, artifact }
}

/** Turn start: snap a "before" frame if we know where this project renders. */
export async function beginTurn(tab: TabState): Promise<void> {
  const url = await resolveUrl(tab.cwd)
  if (!url) return
  const frame = await captureUrl(url, 1280, 800)
  if (frame) beforeFrames.set(tab.tabId, frame)
}

/** Turn end: if visual files changed, capture and append a shots card. */
export async function finishTurn(
  tab: TabState,
  append: (item: Omit<Extract<ChatItem, { kind: 'shots' }>, 'id'>) => void
): Promise<void> {
  const before = beforeFrames.get(tab.tabId)
  beforeFrames.delete(tab.tabId)
  const { touched, artifact } = detectVisual(tab.items)
  if (!touched) return

  const frames: { label: string; data: string }[] = []

  if (artifact && RENDERABLE_EXT.test(artifact)) {
    // A written HTML/SVG file — capture it directly (headless Edge handles file://).
    const abs = /^[a-zA-Z]:[\\/]/.test(artifact)
      ? artifact
      : `${tab.cwd.replace(/[\\/]+$/, '')}\\${artifact}`
    const result = await window.api.invoke('shots:captureFile', { path: abs })
    if (!('error' in result)) frames.push({ label: 'after', data: result.data })
    if (frames.length) {
      append({
        kind: 'shots',
        title: artifact.split(/[\\/]/).pop() ?? artifact,
        url: abs,
        frames
      })
    }
    return
  }

  const url = await resolveUrl(tab.cwd)
  if (!url) return
  if (before) frames.push({ label: 'before', data: before })
  const after = await captureUrl(url, 1280, 800)
  if (after) frames.push({ label: 'after', data: after })
  const mobile = await captureUrl(url, 480, 850)
  if (mobile) frames.push({ label: 'mobile', data: mobile })
  if (!after) return

  localStorage.setItem(urlKey(tab.cwd), url)
  append({ kind: 'shots', title: url, url, frames })
}
