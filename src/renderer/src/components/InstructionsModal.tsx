import { useEffect, useState } from 'react'
import { BookOpen, Loader2, X } from 'lucide-react'
import clsx from 'clsx'

type Scope = 'project' | 'global'

/** Edit the CLAUDE.md instructions Claude loads into every session —
 *  this project's file or the global one. */
export function InstructionsModal({
  tabId,
  onClose
}: {
  tabId: string
  onClose: () => void
}): React.JSX.Element {
  const [scope, setScope] = useState<Scope>('project')
  const [content, setContent] = useState<string | null>(null)
  const [path, setPath] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setContent(null)
    setError(null)
    setDirty(false)
    void window.api.invoke('instructions:get', { scope, tabId }).then((result) => {
      if ('error' in result) {
        setError(result.error)
      } else {
        setContent(result.content)
        setPath(result.path)
      }
    })
  }, [scope, tabId])

  const save = async (): Promise<void> => {
    if (content === null) return
    setSaving(true)
    const result = await window.api.invoke('instructions:set', { scope, tabId, content })
    setSaving(false)
    if ('error' in result) setError(result.error)
    else setDirty(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop-in flex h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <BookOpen size={18} className="text-accent" />
          <h2 className="font-semibold">Instructions for Claude</h2>
          <div className="ml-4 flex rounded-lg bg-surface-2 p-0.5 text-xs">
            {(['project', 'global'] as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={clsx(
                  'rounded-md px-2.5 py-1 capitalize',
                  scope === s ? 'bg-accent text-white' : 'text-text-dim hover:text-text'
                )}
              >
                {s === 'project' ? 'This project' : 'Global'}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="ml-auto rounded p-1 hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-6 py-3">
          <p className="pb-2 font-mono text-[11px] text-text-dim" title={path}>
            {path}
          </p>
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : content === null ? (
            <div className="flex items-center gap-2 text-sm text-text-dim">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                setDirty(true)
              }}
              spellCheck={false}
              placeholder={
                scope === 'project'
                  ? '# Project instructions\n\nRules and context Claude should follow in this folder…'
                  : '# Global instructions\n\nRules Claude should follow in every project…'
              }
              className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-bg p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent-dim"
            />
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-6 py-3">
          <p className="text-xs text-text-dim">Changes apply to sessions started after saving.</p>
          <button
            onClick={() => void save()}
            disabled={!dirty || saving || content === null}
            className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>
    </div>
  )
}
