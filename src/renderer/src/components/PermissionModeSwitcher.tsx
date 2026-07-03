import type { PermissionMode } from '@shared/types'
import { useSessions } from '../stores/sessions'
import { alertDialog, confirmDialog } from '../lib/dialogs'

const MODES: { value: PermissionMode; label: string; title: string }[] = [
  { value: 'default', label: 'Ask', title: 'Prompt before running tools' },
  { value: 'acceptEdits', label: 'Auto-edit', title: 'Auto-accept file edits' },
  { value: 'plan', label: 'Plan', title: 'Plan only, no execution' },
  { value: 'bypassPermissions', label: 'Bypass', title: 'Skip all permission checks' }
]

export function PermissionModeSwitcher({ tabId }: { tabId: string }): React.JSX.Element {
  const mode = useSessions((s) => s.tabs.find((t) => t.tabId === tabId)?.permissionMode)

  const setMode = async (value: PermissionMode): Promise<void> => {
    if (
      value === 'bypassPermissions' &&
      !(await confirmDialog(
        'Bypass mode runs every command and file edit without asking you first. Only use it in folders you trust. Enable?'
      ))
    ) {
      return
    }
    const previous = useSessions.getState().tabs.find((t) => t.tabId === tabId)?.permissionMode
    useSessions.getState().update(tabId, { permissionMode: value })
    window.api.invoke('session:setPermissionMode', { tabId, mode: value }).catch((err) => {
      console.error('setPermissionMode failed:', err)
      void alertDialog(`Could not switch mode: ${err instanceof Error ? err.message : err}`)
      if (previous) useSessions.getState().update(tabId, { permissionMode: previous })
    })
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface-2/60 p-0.5 text-xs">
      {MODES.map((m) => (
        <button
          key={m.value}
          title={m.title}
          onClick={() => void setMode(m.value)}
          className={
            'rounded-md px-2 py-0.5 transition-colors ' +
            (mode === m.value
              ? m.value === 'bypassPermissions'
                ? 'bg-red-900/60 text-red-200'
                : 'bg-accent/20 text-accent'
              : 'text-text-dim hover:text-text')
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
