import { CheckCircle2, AlertCircle, X } from 'lucide-react'
import { useUi } from '../stores/ui'

/** Bottom-right transient notifications — feedback for native slash commands. */
export function Toaster(): React.JSX.Element {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto anim-in flex max-w-sm items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm shadow-xl"
        >
          {t.kind === 'error' ? (
            <AlertCircle size={15} className="shrink-0 text-red-400" />
          ) : (
            <CheckCircle2 size={15} className="shrink-0 text-accent" />
          )}
          <span className="text-text">{t.text}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="ml-1 rounded p-0.5 text-text-dim hover:bg-border hover:text-text"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
