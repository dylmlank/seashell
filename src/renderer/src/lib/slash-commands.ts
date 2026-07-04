import type { PermissionMode } from '@shared/types'
import { useEditor } from '../stores/editor'
import { useUi } from '../stores/ui'
import { runInTerminal } from './terminals'

/** One entry in the composer autocomplete, from any of three sources. */
export interface SlashSuggestion {
  name: string
  description?: string
  argHint?: string
  source: 'native' | 'user' | 'builtin'
}

interface NativeContext {
  tabId: string
  cwd: string
}

/** A slash command handled entirely in the app — it drives existing UI instead
 *  of going to the model. Returns nothing; feedback is a toast or a visible panel. */
export interface NativeCommand {
  name: string
  description: string
  argHint?: string
  run: (args: string, ctx: NativeContext) => void | Promise<void>
}

const toast = (text: string, kind: 'info' | 'error' = 'info'): void =>
  useUi.getState().toast(text, kind)

const PANELS = ['files', 'editor', 'terminal', 'sidechat', 'preview', 'memory', 'workflow'] as const

const MODE_ALIASES: Record<string, PermissionMode> = {
  ask: 'default',
  default: 'default',
  auto: 'acceptEdits',
  acceptedits: 'acceptEdits',
  edits: 'acceptEdits',
  plan: 'plan',
  bypass: 'bypassPermissions',
  yolo: 'bypassPermissions'
}

/** The built-in shell commands. Names are chosen not to collide with Claude
 *  Code's own slash commands so a native action never shadows a model command. */
export const NATIVE_COMMANDS: NativeCommand[] = [
  ...PANELS.map(
    (p): NativeCommand => ({
      name: p,
      description: `Toggle the ${p} panel`,
      run: (_a, { tabId }) => useUi.getState().togglePanel(tabId, p)
    })
  ),
  {
    name: 'model',
    description: 'Switch the model for this session',
    argHint: '<model-id>',
    run: async (args, { tabId }) => {
      const model = args.trim()
      if (!model) return toast('Usage: /model <model-id>', 'error')
      await window.api.invoke('session:setModel', { tabId, model })
      toast(`Model → ${model}`)
    }
  },
  {
    name: 'mode',
    description: 'Set permission mode: ask · auto · plan · bypass',
    argHint: '<ask|auto|plan|bypass>',
    run: async (args, { tabId }) => {
      const mode = MODE_ALIASES[args.trim().toLowerCase()]
      if (!mode) return toast('Usage: /mode <ask|auto|plan|bypass>', 'error')
      await window.api.invoke('session:setPermissionMode', { tabId, mode })
      toast(`Permission mode → ${mode}`)
    }
  },
  {
    name: 'run',
    description: 'Run a command in the terminal panel',
    argHint: '<command>',
    run: async (args, { tabId, cwd }) => {
      const cmd = args.trim()
      if (!cmd) return toast('Usage: /run <command>', 'error')
      useUi.getState().setPanel(tabId, 'terminal')
      await runInTerminal(tabId, cwd, cmd)
    }
  },
  {
    name: 'open',
    description: 'Open a file in the editor',
    argHint: '<path>',
    run: (args, { tabId }) => {
      const rel = args.trim()
      if (!rel) return toast('Usage: /open <path>', 'error')
      void useEditor.getState().openFile(tabId, rel)
    }
  },
  {
    name: 'commit',
    description: 'Commit all changed files with a message',
    argHint: '<message>',
    run: async (args, { tabId }) => {
      const message = args.trim()
      if (!message) return toast('Usage: /commit <message>', 'error')
      const list = await window.api.invoke('changes:list', { tabId })
      if ('error' in list) return toast(list.error, 'error')
      if (!list.files.length) return toast('Nothing to commit — working tree is clean', 'error')
      const res = await window.api.invoke('changes:commit', {
        tabId,
        message,
        files: list.files.map((f) => f.path)
      })
      toast('error' in res ? res.error : `Committed ${list.files.length} file(s)`, 'error' in res ? 'error' : 'info')
    }
  },
  {
    name: 'kill',
    description: 'Kill the process on a local port',
    argHint: '<port>',
    run: async (args) => {
      const port = Number(args.trim())
      if (!port) return toast('Usage: /kill <port>', 'error')
      const ports = await window.api.invoke('ports:list')
      if ('error' in ports) return toast(ports.error, 'error')
      const hit = ports.find((p) => p.port === port)
      if (!hit) return toast(`Nothing is listening on :${port}`, 'error')
      const res = await window.api.invoke('ports:kill', { pid: hit.pid })
      toast('error' in res ? res.error : `Killed process on :${port}`, 'error' in res ? 'error' : 'info')
    }
  },
  {
    name: 'screenshot',
    description: 'Capture a running URL into the previews',
    argHint: '[url]',
    run: async (args, { cwd }) => {
      const url = args.trim() || 'http://localhost:3000'
      const res = await window.api.invoke('previews:capture', { cwd, url })
      toast('error' in res ? res.error : `Captured ${url}`, 'error' in res ? 'error' : 'info')
    }
  },
  {
    name: 'new-project',
    description: 'Create a project folder and move this conversation into it',
    argHint: '<name>',
    run: async (args, { tabId }) => {
      const name = args.trim()
      if (!name) return toast('Usage: /new-project <name>', 'error')
      const res = await window.api.invoke('project:create', { name })
      if ('error' in res) return toast(res.error, 'error')
      const { moveTabToProject } = await import('../stores/sessions')
      await moveTabToProject(tabId, res.path)
      toast(`Project created — this chat now lives in ${res.path}`)
    }
  },
  {
    name: 'commands',
    description: 'Manage your custom slash commands',
    run: () => useUi.getState().setCommandsManager(true)
  }
]

const NATIVE_BY_NAME = new Map(NATIVE_COMMANDS.map((c) => [c.name, c]))

export function findNative(name: string): NativeCommand | undefined {
  return NATIVE_BY_NAME.get(name.toLowerCase())
}

export const NATIVE_SUGGESTIONS: SlashSuggestion[] = NATIVE_COMMANDS.map((c) => ({
  name: c.name,
  description: c.description,
  argHint: c.argHint,
  source: 'native'
}))
