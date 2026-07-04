import { useEffect, useMemo, useState } from 'react'
import { Plus, Slash, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import type { UserCommand } from '@shared/types'
import { NATIVE_COMMANDS } from '../lib/slash-commands'
import { useCommands } from '../stores/commands'
import { useUi } from '../stores/ui'

interface Draft {
  original?: string // name of the command being edited (undefined = new)
  scope: 'project' | 'user'
  name: string
  description: string
  argumentHint: string
  body: string
}

const EMPTY: Draft = { scope: 'project', name: '', description: '', argumentHint: '', body: '' }

/** Create, edit and delete `.claude/commands/*.md` macros without leaving the app. */
export function CommandsManager({ tabId }: { tabId: string }): React.JSX.Element {
  const close = (): void => useUi.getState().setCommandsManager(false)
  const commands = useCommands((s) => s.byTab[tabId]) ?? []
  const reload = useCommands((s) => s.load)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void reload(tabId)
  }, [tabId, reload])

  const startNew = (): void => {
    setError(null)
    setDraft({ ...EMPTY })
  }
  const startEdit = (c: UserCommand): void => {
    setError(null)
    setDraft({
      original: c.name,
      scope: c.scope,
      name: c.name,
      description: c.description ?? '',
      argumentHint: c.argumentHint ?? '',
      body: c.body
    })
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) return setError('Give the command a name.')
    if (!draft.body.trim()) return setError('The command body is empty.')
    setSaving(true)
    // Renaming = delete the old file, write the new one.
    if (draft.original && draft.original !== name) {
      await window.api.invoke('commands:delete', { tabId, scope: draft.scope, name: draft.original })
    }
    const res = await window.api.invoke('commands:save', {
      tabId,
      scope: draft.scope,
      name,
      description: draft.description,
      argumentHint: draft.argumentHint,
      body: draft.body
    })
    setSaving(false)
    if ('error' in res) return setError(res.error)
    await reload(tabId)
    setDraft(null)
  }

  const remove = async (c: UserCommand): Promise<void> => {
    await window.api.invoke('commands:delete', { tabId, scope: c.scope, name: c.name })
    await reload(tabId)
    if (draft?.original === c.name) setDraft(null)
  }

  const nativeNames = useMemo(() => NATIVE_COMMANDS.map((c) => c.name).sort(), [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop-in flex h-[80vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Slash size={17} className="text-accent" />
          <h2 className="font-semibold">Slash commands</h2>
          <span className="text-xs text-text-dim">
            Reusable prompts stored in <span className="font-mono">.claude/commands</span> — they
            work here and in the CLI
          </span>
          <button onClick={close} className="ml-auto rounded p-1 hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left: the command list */}
          <div className="flex w-64 shrink-0 flex-col border-r border-border">
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
              <button
                onClick={startNew}
                className="mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-accent hover:bg-surface-2"
              >
                <Plus size={14} /> New command
              </button>
              {commands.length === 0 && (
                <p className="px-2.5 py-2 text-xs text-text-dim">No custom commands yet.</p>
              )}
              {commands.map((c) => (
                <button
                  key={`${c.scope}:${c.name}`}
                  onClick={() => startEdit(c)}
                  className={clsx(
                    'group flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                    draft?.original === c.name ? 'bg-accent-dim/25 text-text' : 'text-text-dim hover:bg-surface-2'
                  )}
                >
                  <span className="truncate font-mono text-xs">/{c.name}</span>
                  <span className="ml-auto shrink-0 rounded px-1 py-0.5 text-[9px] uppercase text-text-dim/70">
                    {c.scope}
                  </span>
                  <Trash2
                    size={13}
                    className="shrink-0 text-text-dim opacity-0 hover:text-red-400 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      void remove(c)
                    }}
                  />
                </button>
              ))}
            </div>
            <div className="border-t border-border p-3 text-[11px] text-text-dim">
              <p className="mb-1 font-medium">Built-in app commands</p>
              <p className="font-mono leading-relaxed">
                {nativeNames.map((n) => `/${n}`).join('  ')}
              </p>
            </div>
          </div>

          {/* Right: the editor */}
          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            {!draft ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-text-dim">
                Select a command to edit, or create a new one.
                <br />
                Use <span className="mx-1 font-mono">$ARGUMENTS</span> (or{' '}
                <span className="mx-1 font-mono">$1 $2</span>) in the body for input.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex gap-3">
                  <label className="flex flex-1 flex-col gap-1 text-xs text-text-dim">
                    Name
                    <div className="flex items-center rounded-lg border border-border bg-bg px-2 focus-within:border-accent-dim">
                      <span className="font-mono text-sm text-text-dim">/</span>
                      <input
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value.replace(/\s/g, '-') })}
                        placeholder="review"
                        className="w-full bg-transparent px-1 py-2 font-mono text-sm outline-none"
                      />
                    </div>
                  </label>
                  <label className="flex w-40 flex-col gap-1 text-xs text-text-dim">
                    Scope
                    <select
                      value={draft.scope}
                      onChange={(e) => setDraft({ ...draft, scope: e.target.value as 'project' | 'user' })}
                      className="rounded-lg border border-border bg-bg px-2 py-2 text-sm outline-none focus:border-accent-dim"
                    >
                      <option value="project">This project</option>
                      <option value="user">All projects</option>
                    </select>
                  </label>
                </div>

                <div className="flex gap-3">
                  <label className="flex flex-1 flex-col gap-1 text-xs text-text-dim">
                    Description
                    <input
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      placeholder="Review the current diff for bugs"
                      className="rounded-lg border border-border bg-bg px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
                    />
                  </label>
                  <label className="flex w-52 flex-col gap-1 text-xs text-text-dim">
                    Argument hint
                    <input
                      value={draft.argumentHint}
                      onChange={(e) => setDraft({ ...draft, argumentHint: e.target.value })}
                      placeholder="[file]"
                      className="rounded-lg border border-border bg-bg px-2.5 py-2 font-mono text-sm outline-none focus:border-accent-dim"
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-1 text-xs text-text-dim">
                  Prompt body
                  <textarea
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    spellCheck={false}
                    rows={12}
                    placeholder={'Review the staged changes for correctness bugs.\nFocus on: $ARGUMENTS'}
                    className="resize-none rounded-lg border border-border bg-bg p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent-dim"
                  />
                </label>

                {error && <p className="text-sm text-red-400">{error}</p>}

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setDraft(null)}
                    className="rounded-lg px-3 py-1.5 text-sm text-text-dim hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void save()}
                    disabled={saving}
                    className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-dim disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : 'Save command'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
