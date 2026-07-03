import { rmSync } from 'fs'
import { readdir, readFile, writeFile } from 'fs/promises'
import { extname, join, resolve } from 'path'
import type { Invokes } from '../shared/ipc-contract'
import { approvals } from './approvals'
import { auth } from './auth'
import { changes } from './changes'
import { startDictation } from './dictation'
import { listProjectFiles } from './file-index'
import { history } from './history'
import { instructions } from './instructions'
import { listDesktopMcp } from './desktop-mcp'
import { listOpenRouterModels } from './openrouter'
import { memoryFiles } from './memory-files'
import { userDataDir } from './paths'
import { ports } from './ports'
import { captureShot, previews } from './previews'
import { secrets } from './secrets'
import { sessionManager } from './session-manager'
import { settingsStore } from './settings-store'
import { transcriptSearch } from './transcript-search'
import { usageStore } from './usage-store'

type Handler<C extends keyof Invokes> = (
  arg: Parameters<Invokes[C]>[0]
) => ReturnType<Invokes[C]> | Promise<ReturnType<Invokes[C]>>

// Channels the frontend resolves locally (Tauri dialogs) never reach the sidecar.
type SidecarChannel = Exclude<keyof Invokes, 'dialog:pickFolder'>

const IMAGE_MEDIA: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

/** Every invoke channel the sidecar serves, keyed exactly like the old ipcMain
 *  registrations — the WebSocket server dispatches into this table. */
export const handlers: { [C in SidecarChannel]: Handler<C> } = {
  'session:create': (a) => sessionManager.create(a),
  'session:send': (a) => {
    sessionManager.get(a.tabId)?.sendUserMessage(a.text, a.images)
  },
  'session:rewind': async (a) => {
    const handle = sessionManager.get(a.tabId)
    if (!handle) return { ok: false, detail: 'Session not found' }
    return handle.rewind(a.userMessageId)
  },
  'session:interrupt': async (a) => {
    await sessionManager.get(a.tabId)?.interrupt()
  },
  'session:setPermissionMode': async (a) => {
    await sessionManager.get(a.tabId)?.setPermissionMode(a.mode)
  },
  'session:setModel': async (a) => {
    await sessionManager.get(a.tabId)?.setModel(a.model)
  },
  'session:supportedModels': async (a) => {
    return (await sessionManager.get(a.tabId)?.supportedModels()) ?? []
  },
  'session:contextUsage': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? h.contextBreakdown() : { error: 'Session not found' }
  },
  'session:close': (a) => {
    sessionManager.close(a.tabId)
  },

  'approval:respond': (a) => {
    const { requestId, ...result } = a
    approvals.respond(requestId, result)
  },

  'fs:readFile': async (a) => {
    try {
      const content = await readFile(a.path, 'utf8')
      return { content }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },
  'fs:readFileBase64': async (a) => {
    try {
      const mediaType = IMAGE_MEDIA[extname(a.path).toLowerCase()]
      if (!mediaType) return { error: 'Not a supported image type' }
      const buf = await readFile(a.path)
      return { data: buf.toString('base64'), mediaType }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  'history:listProjects': () => history.listProjects(),
  'history:listSessions': (a) => history.listSessions(a?.dir),
  'history:rename': async (a) => {
    const { renameSession } = await import('@anthropic-ai/claude-agent-sdk')
    await renameSession(a.sessionId, a.title, a.dir ? { dir: a.dir } : undefined)
  },
  'history:delete': async (a) => {
    const { deleteSession } = await import('@anthropic-ai/claude-agent-sdk')
    await deleteSession(a.sessionId, a.dir ? { dir: a.dir } : undefined)
  },
  'history:search': (a) => transcriptSearch.search(a.query),
  'history:export': async (a) => {
    const markdown = await transcriptSearch.exportMarkdown(a.sessionId)
    if (markdown === null) return { error: 'Transcript not found' }
    return { markdown, suggestedName: `claude-session-${a.sessionId.slice(0, 8)}.md` }
  },

  'usage:getAll': () => usageStore.getAll(),
  'usage:limits': () => sessionManager.limits(),

  'settings:get': () => settingsStore.get(),
  'settings:set': (a) => settingsStore.set(a),

  'changes:list': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.list(h.cwd) : { error: 'Session not found' }
  },
  'changes:diff': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.diff(h.cwd, a.path) : { error: 'Session not found' }
  },
  'changes:revert': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.revert(h.cwd, a.path) : { error: 'Session not found' }
  },
  'changes:branches': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.branches(h.cwd) : { error: 'Session not found' }
  },
  'changes:checkout': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.checkout(h.cwd, a.branch) : { error: 'Session not found' }
  },
  'changes:commit': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.commit(h.cwd, a.message, a.files) : { error: 'Session not found' }
  },

  'providers:getState': () => ({ openrouterKeySet: secrets.getOpenRouterKey() !== null }),
  'providers:saveOpenRouterKey': (a) => {
    const key = a.key.trim()
    if (!key.startsWith('sk-or-')) {
      return { ok: false, error: 'That does not look like an OpenRouter key (expected sk-or-…).' }
    }
    secrets.saveOpenRouterKey(key)
    return { ok: true }
  },
  'providers:clearOpenRouterKey': () => secrets.clearOpenRouterKey(),
  'providers:listOpenRouterModels': () => listOpenRouterModels(),
  'providers:desktopMcp': () => listDesktopMcp(),

  'instructions:get': (a) => {
    const cwd = a.tabId ? sessionManager.get(a.tabId)?.cwd : undefined
    return instructions.get(a.scope, cwd)
  },
  'instructions:set': (a) => {
    const cwd = a.tabId ? sessionManager.get(a.tabId)?.cwd : undefined
    return instructions.set(a.scope, a.content, cwd)
  },

  'memory:list': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? memoryFiles.list(h.cwd) : { error: 'Session not found' }
  },
  'memory:read': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? memoryFiles.read(h.cwd, a.name) : { error: 'Session not found' }
  },
  'memory:write': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? memoryFiles.write(h.cwd, a.name, a.content) : { error: 'Session not found' }
  },
  'memory:delete': (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? memoryFiles.remove(h.cwd, a.name) : { error: 'Session not found' }
  },

  'dictation:start': () => startDictation(),

  'previews:cards': () => previews.cards(),
  'previews:capture': (a) => previews.capture(a.cwd, a.url),
  'shots:captureFile': async (a) => {
    const tmp = join(userDataDir(), 'previews', `file-shot-${process.pid}-${Math.random().toString(36).slice(2)}.png`)
    const ok = await captureShot(
      `file:///${a.path.replace(/\\/g, '/')}`,
      tmp,
      a.width ?? 1280,
      a.height ?? 800
    )
    if (!ok) return { error: 'File capture failed' }
    const data = (await readFile(tmp)).toString('base64')
    rmSync(tmp, { force: true })
    return { data }
  },

  'ports:list': () => ports.list(),
  'ports:kill': (a) => ports.kill(a.pid),
  'ports:open': (a) => ports.open(a.port),

  'fs:listDir': async (a) => {
    const h = sessionManager.get(a.tabId)
    if (!h) return { error: 'Session not found' }
    const target = resolve(join(h.cwd, a.rel))
    if (!target.startsWith(resolve(h.cwd))) return { error: 'Path outside project' }
    try {
      const dirents = await readdir(target, { withFileTypes: true })
      const entries = dirents
        .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
        .sort((x, y) => Number(y.isDir) - Number(x.isDir) || x.name.localeCompare(y.name))
      return { entries }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },
  'fs:listFiles': async (a) => {
    const h = sessionManager.get(a.tabId)
    if (!h) return { error: 'Session not found' }
    return { files: await listProjectFiles(h.cwd) }
  },
  'fs:writeFile': async (a) => {
    const h = sessionManager.get(a.tabId)
    if (!h) return { error: 'Session not found' }
    const target = resolve(join(h.cwd, a.rel))
    if (!target.startsWith(resolve(h.cwd))) return { error: 'Path outside project' }
    try {
      await writeFile(target, a.content, 'utf8')
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  },

  'auth:getState': () => auth.getState(),
  'auth:saveManualToken': (a) => auth.saveManualToken(a.token),
  'auth:openTerminalLogin': () => auth.openTerminalLogin(),
  'auth:logout': () => auth.logout()
}
