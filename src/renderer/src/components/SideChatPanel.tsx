import { useEffect, useRef, useState } from 'react'
import { Loader2, MessagesSquare, Trash2 } from 'lucide-react'
import { closeTab, createTab, interrupt, sendMessage, useSessions } from '../stores/sessions'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { confirmDialog } from '../lib/dialogs'

/**
 * A second, independent conversation in the same folder — for quick questions
 * without filling the main session's context. Hiding the panel keeps it alive;
 * the trash button ends it.
 */
export function SideChatPanel({ cwd }: { cwd: string }): React.JSX.Element {
  const sideTab = useSessions((s) => s.tabs.find((t) => t.side && t.cwd === cwd))
  const [error, setError] = useState<string | null>(null)
  const creating = useRef(false)

  useEffect(() => {
    if (sideTab || creating.current) return
    creating.current = true
    createTab(cwd, undefined, true)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        creating.current = false
      })
  }, [cwd, sideTab])

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-surface/40">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-medium">
        <MessagesSquare size={15} className="text-accent" />
        Side chat
        <span className="text-xs text-text-dim">questions only — never changes files</span>
        {sideTab && (
          <button
            onClick={() => {
              void confirmDialog('End this side chat? Its conversation is kept in history.').then(
                (ok) => ok && closeTab(sideTab.tabId)
              )
            }}
            title="End side chat"
            className="ml-auto rounded p-1 text-text-dim hover:bg-surface-2 hover:text-red-400"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {error ? (
        <p className="p-4 text-sm text-red-400">{error}</p>
      ) : !sideTab ? (
        <div className="flex items-center gap-2 p-4 text-sm text-text-dim">
          <Loader2 size={14} className="animate-spin" /> Starting side chat…
        </div>
      ) : (
        <>
          <MessageList items={sideTab.items} tabId={sideTab.tabId} chatOnly />
          <Composer
            tabId={sideTab.tabId}
            disabled={sideTab.status === 'error'}
            streaming={sideTab.status === 'streaming' || sideTab.status === 'awaitingApproval'}
            slashCommands={sideTab.slashCommands}
            hideModeControls
            onSend={(text, images) =>
              sendMessage(sideTab.tabId, text, images.length ? images : undefined)
            }
            onStop={() => interrupt(sideTab.tabId)}
          />
        </>
      )}
    </div>
  )
}
