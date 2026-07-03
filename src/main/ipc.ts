import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
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
import { ports } from './ports'
import { secrets } from './secrets'
import { sessionManager } from './session-manager'
import { settingsStore } from './settings-store'
import { terminal } from './terminal'
import { transcriptSearch } from './transcript-search'
import { usageStore } from './usage-store'

type Handler<C extends keyof Invokes> = (
  arg: Parameters<Invokes[C]>[0]
) => ReturnType<Invokes[C]> | Promise<ReturnType<Invokes[C]>>

function handle<C extends keyof Invokes>(channel: C, fn: Handler<C>): void {
  ipcMain.handle(channel, (_ev, arg) => fn(arg))
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  handle('session:create', (a) => sessionManager.create(a))
  handle('session:send', (a) => {
    sessionManager.get(a.tabId)?.sendUserMessage(a.text, a.images)
  })
  handle('session:rewind', async (a) => {
    const handle = sessionManager.get(a.tabId)
    if (!handle) return { ok: false, detail: 'Session not found' }
    return handle.rewind(a.userMessageId)
  })
  handle('session:interrupt', async (a) => {
    await sessionManager.get(a.tabId)?.interrupt()
  })
  handle('session:setPermissionMode', async (a) => {
    await sessionManager.get(a.tabId)?.setPermissionMode(a.mode)
  })
  handle('session:setModel', async (a) => {
    await sessionManager.get(a.tabId)?.setModel(a.model)
  })
  handle('session:supportedModels', async (a) => {
    return (await sessionManager.get(a.tabId)?.supportedModels()) ?? []
  })
  handle('session:close', (a) => {
    sessionManager.close(a.tabId)
  })

  handle('approval:respond', (a) => {
    const { requestId, ...result } = a
    approvals.respond(requestId, result)
  })

  handle('dialog:pickFolder', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  handle('fs:readFile', async (a) => {
    try {
      const content = await readFile(a.path, 'utf8')
      return { content }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  handle('history:listProjects', () => history.listProjects())
  handle('history:listSessions', (a) => history.listSessions(a?.dir))

  handle('history:rename', async (a) => {
    const { renameSession } = await import('@anthropic-ai/claude-agent-sdk')
    await renameSession(a.sessionId, a.title, a.dir ? { dir: a.dir } : undefined)
  })
  handle('history:delete', async (a) => {
    const { deleteSession } = await import('@anthropic-ai/claude-agent-sdk')
    await deleteSession(a.sessionId, a.dir ? { dir: a.dir } : undefined)
  })
  handle('history:search', (a) => transcriptSearch.search(a.query))
  handle('history:export', async (a) => {
    const markdown = await transcriptSearch.exportMarkdown(a.sessionId)
    if (markdown === null) return { error: 'Transcript not found' }
    const win = getWindow()
    if (!win) return { error: 'No window' }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `claude-session-${a.sessionId.slice(0, 8)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      await writeFile(result.filePath, markdown, 'utf8')
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  handle('usage:getAll', () => usageStore.getAll())

  handle('settings:get', () => settingsStore.get())
  handle('settings:set', (a) => settingsStore.set(a))

  handle('changes:list', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.list(h.cwd) : { error: 'Session not found' }
  })
  handle('changes:diff', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.diff(h.cwd, a.path) : { error: 'Session not found' }
  })
  handle('changes:revert', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.revert(h.cwd, a.path) : { error: 'Session not found' }
  })
  handle('changes:branches', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.branches(h.cwd) : { error: 'Session not found' }
  })
  handle('changes:checkout', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.checkout(h.cwd, a.branch) : { error: 'Session not found' }
  })
  handle('changes:commit', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? changes.commit(h.cwd, a.message, a.files) : { error: 'Session not found' }
  })

  handle('providers:getState', () => ({ openrouterKeySet: secrets.getOpenRouterKey() !== null }))
  handle('providers:saveOpenRouterKey', (a) => {
    const key = a.key.trim()
    if (!key.startsWith('sk-or-')) {
      return { ok: false, error: 'That does not look like an OpenRouter key (expected sk-or-…).' }
    }
    secrets.saveOpenRouterKey(key)
    return { ok: true }
  })
  handle('providers:clearOpenRouterKey', () => secrets.clearOpenRouterKey())
  handle('providers:listOpenRouterModels', () => listOpenRouterModels())
  handle('providers:desktopMcp', () => listDesktopMcp())

  handle('fs:listDir', async (a) => {
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
  })

  handle('fs:writeFile', async (a) => {
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
  })

  handle('instructions:get', (a) => {
    const cwd = a.tabId ? sessionManager.get(a.tabId)?.cwd : undefined
    return instructions.get(a.scope, cwd)
  })
  handle('instructions:set', (a) => {
    const cwd = a.tabId ? sessionManager.get(a.tabId)?.cwd : undefined
    return instructions.set(a.scope, a.content, cwd)
  })

  handle('memory:list', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? memoryFiles.list(h.cwd) : { error: 'Session not found' }
  })
  handle('memory:read', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? memoryFiles.read(h.cwd, a.name) : { error: 'Session not found' }
  })
  handle('memory:write', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? memoryFiles.write(h.cwd, a.name, a.content) : { error: 'Session not found' }
  })
  handle('memory:delete', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? memoryFiles.remove(h.cwd, a.name) : { error: 'Session not found' }
  })

  handle('dictation:start', () => startDictation())

  handle('ports:list', () => ports.list())
  handle('ports:kill', (a) => ports.kill(a.pid))
  handle('ports:open', (a) => ports.open(a.port))

  handle('fs:listFiles', async (a) => {
    const h = sessionManager.get(a.tabId)
    if (!h) return { error: 'Session not found' }
    return { files: await listProjectFiles(h.cwd) }
  })

  handle('term:create', (a) => {
    const h = sessionManager.get(a.tabId)
    return h ? terminal.create(h.cwd) : { error: 'Session not found' }
  })
  handle('term:input', (a) => terminal.input(a.termId, a.data))
  handle('term:resize', (a) => terminal.resize(a.termId, a.cols, a.rows))
  handle('term:kill', (a) => terminal.kill(a.termId))
  handle('term:openExternal', (a) => {
    const h = sessionManager.get(a.tabId)
    if (h) terminal.openExternal(h.cwd)
  })

  handle('auth:getState', () => auth.getState())
  handle('auth:saveManualToken', (a) => auth.saveManualToken(a.token))
  handle('auth:openTerminalLogin', () => auth.openTerminalLogin())
  handle('auth:logout', () => auth.logout())
}
