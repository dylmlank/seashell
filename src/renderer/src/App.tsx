import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import { useAuth } from './stores/auth'
import { useSettings } from './stores/settings'
import { createTab, useSessions } from './stores/sessions'
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
      </div>
      <ProjectGallery />
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
