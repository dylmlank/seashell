import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { setApprovalBroadcast } from './approvals'
import { injectStoredToken, setAuthBroadcast } from './auth'
import { setNotifyWindow } from './notify'
import { ensureRetrospectiveSkill } from './retrospective'
import { sessionManager, setBroadcast } from './session-manager'
import { setTerminalBroadcast, terminal } from './terminal'
import { usageStore } from './usage-store'

// Use a stable data dir even in dev, where Electron would default to
// %APPDATA%\Electron. Must run before anything reads userData.
app.setName('claude-shell')
app.setPath('userData', join(app.getPath('appData'), 'claude-shell'))

// Redirect app data (secrets, settings) — used by e2e tests to avoid
// touching the real profile.
if (process.env.CLAUDE_SHELL_USER_DATA) {
  app.setPath('userData', process.env.CLAUDE_SHELL_USER_DATA)
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.claude-shell')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const broadcast = (channel: string, payload: unknown): void => {
    mainWindow?.webContents.send(channel, payload)
  }
  setBroadcast(broadcast)
  setApprovalBroadcast(broadcast)
  setAuthBroadcast(broadcast)
  setTerminalBroadcast(broadcast)
  setNotifyWindow(() => mainWindow)
  injectStoredToken()
  ensureRetrospectiveSkill()
  registerIpc(() => mainWindow)

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  sessionManager.disposeAll()
  terminal.killAll()
  usageStore.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
