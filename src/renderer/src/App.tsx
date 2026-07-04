import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Loader2, Plus, X, Zap } from 'lucide-react'
import type { SessionTemplate } from '@shared/types'
import { useAuth } from './stores/auth'
import { updateSettings, useSettings } from './stores/settings'
import { createTab, sendMessage, useSessions } from './stores/sessions'
import { ApprovalModal } from './components/ApprovalModal'
import { ChangesPanel } from './components/ChangesPanel'
import { ChatView } from './components/ChatView'
import { CommandPalette } from './components/CommandPalette'
import { CommandsManager } from './components/CommandsManager'
import { OnboardingView } from './components/OnboardingView'
import { ProjectGallery } from './components/ProjectGallery'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { Toaster } from './components/Toaster'
import { UsagePanel } from './components/UsagePanel'
import { useUi } from './stores/ui'

function Welcome(): React.JSX.Element {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openProject = async (): Promise<void> => {
    setError(null)
    const cwd = await window.api.invoke('dialog:pickFolder')
    if (!cwd) return
    setOpening(true)
    try {
      await createTab(cwd)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="chat-wash relative flex h-full flex-col items-center overflow-y-auto">
      <div className="aurora" />
      <div className="stagger relative flex flex-col items-center gap-7 pb-10 pt-[12vh]">
        <div className="text-center">
          <div className="brand-float mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/15 text-3xl shadow-2xl shadow-accent/10">
            🐚
          </div>
          <h1 className="mb-1.5 text-3xl font-semibold tracking-tight">Seashell</h1>
          <p className="text-text-dim">
            Pick a project folder and Claude gets to work — with your approval.
          </p>
        </div>
        <button
          onClick={() => void openProject()}
          disabled={opening}
          className="flex items-center gap-2 rounded-2xl bg-accent px-6 py-3.5 font-medium text-white shadow-xl shadow-accent/15 transition-transform hover:scale-[1.02] hover:bg-accent-dim disabled:opacity-50"
        >
          {opening ? <Loader2 size={18} className="animate-spin" /> : <FolderOpen size={18} />}
          Open a project folder
        </button>
        {error && <p className="max-w-md text-center text-sm text-red-400">{error}</p>}
        <TemplatesRow />
      </div>
      <ProjectGallery />
    </div>
  )
}

/** One-click session presets: folder + optional first prompt. */
function TemplatesRow(): React.JSX.Element | null {
  const templates = useSettings((s) => s.settings.templates)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')

  const launch = async (t: SessionTemplate): Promise<void> => {
    const tabId = await createTab(t.cwd)
    if (t.prompt) sendMessage(tabId, t.prompt)
  }

  const save = async (): Promise<void> => {
    if (!name.trim() || !cwd) return
    await updateSettings({
      templates: [...templates, { name: name.trim(), cwd, prompt: prompt.trim() || undefined }]
    })
    setAdding(false)
    setName('')
    setCwd('')
    setPrompt('')
  }

  const remove = async (index: number): Promise<void> => {
    await updateSettings({ templates: templates.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex max-w-2xl flex-wrap items-center justify-center gap-2">
      {templates.map((t, i) => (
        <span key={`${t.name}-${i}`} className="group flex items-center">
          <button
            onClick={() => void launch(t)}
            title={`${t.cwd}${t.prompt ? `\n→ ${t.prompt}` : ''}`}
            className="flex items-center gap-1.5 rounded-xl border border-accent/30 bg-accent/10 px-3 py-1.5 text-sm text-accent transition-all hover:-translate-y-0.5 hover:bg-accent/20"
          >
            <Zap size={13} />
            {t.name}
          </button>
          <button
            onClick={() => void remove(i)}
            title="Delete template"
            className="ml-0.5 rounded p-0.5 text-text-dim opacity-0 hover:text-red-400 group-hover:opacity-100"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {adding ? (
        <span className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-border bg-surface p-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="w-28 rounded-lg border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent-dim"
          />
          <button
            onClick={() => {
              void window.api.invoke('dialog:pickFolder').then((dir) => dir && setCwd(dir))
            }}
            className="max-w-40 truncate rounded-lg border border-border bg-bg px-2 py-1 text-sm text-text-dim hover:text-text"
          >
            {cwd ? cwd.split(/[\\/]/).pop() : 'Pick folder…'}
          </button>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="First prompt (optional)"
            className="w-48 rounded-lg border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent-dim"
          />
          <button
            onClick={() => void save()}
            disabled={!name.trim() || !cwd}
            className="rounded-lg bg-accent px-2.5 py-1 text-sm text-white hover:bg-accent-dim disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={() => setAdding(false)}
            className="rounded-lg px-2 py-1 text-sm text-text-dim hover:text-text"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => setAdding(true)}
          title="Save a one-click session preset: folder + optional first prompt"
          className="flex items-center gap-1 rounded-xl border border-dashed border-border px-3 py-1.5 text-sm text-text-dim hover:border-accent-dim/60 hover:text-text"
        >
          <Plus size={13} />
          Template
        </button>
      )}
    </div>
  )
}

export default function App(): React.JSX.Element {
  const authState = useAuth((s) => s.auth)
  const tabs = useSessions((s) => s.tabs)
  const activeTabId = useSessions((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.tabId === activeTabId)
  const [changesOpen, setChangesOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const commandsManagerOpen = useUi((s) => s.commandsManager)
  const settingsLoaded = useSettings((s) => s.loaded)
  const reopenLast = useSettings((s) => s.settings.reopenLastProject)
  const reopened = useRef(false)

  // Optional: jump straight back into the last project on launch.
  useEffect(() => {
    if (reopened.current || !settingsLoaded || !reopenLast) return
    reopened.current = true
    if (tabs.length > 0) return
    const last = localStorage.getItem('last-project')
    if (last) void createTab(last).catch(() => {})
  }, [settingsLoaded, reopenLast, tabs.length])

  if (authState.state === 'loggedOut') {
    return <OnboardingView reason={authState.detail} />
  }

  return (
    <div className="flex h-full">
      <Sidebar
        changesOpen={changesOpen}
        onToggleChanges={() => setChangesOpen(!changesOpen)}
        onShowUsage={() => setUsageOpen(true)}
        onShowSettings={() => setSettingsOpen(true)}
      />
      <div className="min-w-0 flex-1">
        {activeTab ? <ChatView key={activeTab.tabId} tab={activeTab} /> : <Welcome />}
      </div>
      {changesOpen && activeTab && (
        <ChangesPanel key={`changes-${activeTab.tabId}`} tabId={activeTab.tabId} />
      )}
      {usageOpen && <UsagePanel onClose={() => setUsageOpen(false)} />}
      {settingsOpen && <SettingsView onClose={() => setSettingsOpen(false)} />}
      {commandsManagerOpen && activeTab && <CommandsManager tabId={activeTab.tabId} />}
      <CommandPalette
        onShowSettings={() => setSettingsOpen(true)}
        onShowUsage={() => setUsageOpen(true)}
        onToggleChanges={() => setChangesOpen((v) => !v)}
      />
      <ApprovalModal />
      <Toaster />
    </div>
  )
}
