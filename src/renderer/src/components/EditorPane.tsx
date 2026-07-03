import { useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { langs } from '@uiw/codemirror-extensions-langs'
import { basicSetup } from '@uiw/codemirror-extensions-basic-setup'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { MergeView } from '@codemirror/merge'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { Code2, FolderTree, GitCompare, Loader2, X } from 'lucide-react'
import clsx from 'clsx'
import { useEditor, type FileBuf } from '../stores/editor'
import { useSettings } from '../stores/settings'
import { FileExplorer } from './FileExplorer'
import { confirmDialog } from '../lib/dialogs'

// The langs registry is keyed by file extension (ts, tsx, py, rs, md, …).
function langFor(rel: string): Extension[] {
  const ext = rel.split('.').pop()?.toLowerCase() ?? ''
  const load = (langs as Record<string, (() => Extension) | undefined>)[ext]
  return load ? [load()] : []
}

/** Side-by-side review of the active file against git HEAD, with per-chunk
 *  revert arrows — undo any individual change Claude made. */
function DiffPane({
  tabId,
  buf,
  onChange
}: {
  tabId: string
  buf: FileBuf
  onChange: (text: string) => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [oldText, setOldText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOldText(null)
    setError(null)
    void window.api.invoke('changes:diff', { tabId, path: buf.rel }).then((result) => {
      if ('error' in result) setError(result.error)
      else setOldText(result.oldText)
    })
    // Re-fetch only when switching files — the right side tracks live edits itself.
  }, [tabId, buf.rel])

  useEffect(() => {
    const host = hostRef.current
    if (oldText === null || !host) return
    const lang = langFor(buf.rel)
    const view = new MergeView({
      a: {
        doc: oldText,
        extensions: [basicSetup({}), vscodeDark, ...lang, EditorState.readOnly.of(true)]
      },
      b: {
        doc: buf.text,
        extensions: [
          basicSetup({}),
          vscodeDark,
          ...lang,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString())
          })
        ]
      },
      parent: host,
      revertControls: 'a-to-b',
      gutter: true
    })
    return () => view.destroy()
    // Rebuild only when the baseline arrives/changes — not per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldText, buf.rel])

  if (error) return <p className="p-4 text-sm text-red-400">{error}</p>
  if (oldText === null) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-text-dim">
        <Loader2 size={14} className="animate-spin" /> Loading git baseline…
      </div>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="flex border-b border-border/60 text-center text-[11px] text-text-dim">
        <span className="flex-1 py-1">last commit (HEAD)</span>
        <span className="flex-1 py-1 text-accent">current — editable, ▷ reverts a chunk</span>
      </div>
      <div ref={hostRef} className="h-full overflow-auto [&_.cm-editor]:text-xs" />
    </div>
  )
}

/** The code editor pane: open-file tabs, CodeMirror, Ctrl+S, diff review. */
export function EditorPane({ tabId }: { tabId: string }): React.JSX.Element {
  const tab = useEditor((s) => s.byTab[tabId])
  const editorFontSize = useSettings((s) => s.settings.editorFontSize)
  const { setText, save, closeFile, setActive, toggleDiff } = useEditor.getState()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [treeOpen, setTreeOpen] = useState(false)
  const open = tab?.open ?? []
  const active = open.find((b) => b.rel === tab?.active) ?? null

  const doSave = async (): Promise<void> => {
    if (!active) return
    setSaveError(await save(tabId, active.rel))
  }

  return (
    <div
      className="flex h-full w-full flex-col border-l border-border bg-[#0d0d0d]"
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key.toLowerCase() === 's') {
          e.preventDefault()
          void doSave()
        }
      }}
    >
      {/* Open-file tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border px-1.5 pt-1.5">
        <Code2 size={14} className="ml-1.5 shrink-0 text-accent" />
        <button
          onClick={() => setTreeOpen(!treeOpen)}
          title="Toggle the file tree inside the editor"
          className={clsx(
            'mx-1 mb-1 shrink-0 rounded-lg p-1',
            treeOpen ? 'bg-accent/15 text-accent' : 'text-text-dim hover:bg-surface-2 hover:text-text'
          )}
        >
          <FolderTree size={13} />
        </button>
        {open.length === 0 && (
          <span className="px-2 pb-1.5 text-xs text-text-dim">
            Open a file from the Files panel or Ctrl+P
          </span>
        )}
        {open.map((b) => {
          const isActive = b.rel === tab?.active
          const dirty = !b.error && b.text !== b.savedText
          const name = b.rel.split('/').pop() ?? b.rel
          return (
            <div
              key={b.rel}
              onClick={() => setActive(tabId, b.rel)}
              title={b.rel}
              className={clsx(
                'group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg border-x border-t px-2.5 py-1 font-mono text-xs',
                isActive
                  ? 'border-border bg-bg text-text'
                  : 'border-transparent text-text-dim hover:bg-surface hover:text-text'
              )}
            >
              {dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Unsaved changes" />}
              {name}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void (async () => {
                    if (
                      dirty &&
                      !(await confirmDialog(`"${name}" has unsaved changes. Close without saving?`))
                    ) {
                      return
                    }
                    closeFile(tabId, b.rel)
                  })()
                }}
                className="rounded p-0.5 opacity-0 hover:bg-border group-hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          )
        })}
        {active && !active.error && (
          <span className="ml-auto flex shrink-0 items-center gap-1 pb-1">
            <button
              onClick={() => toggleDiff(tabId)}
              title="Review changes vs the last git commit — revert chunks you don't want"
              className={clsx(
                'flex items-center gap-1 rounded-lg px-2 py-1 text-xs',
                tab?.diff ? 'bg-accent/15 text-accent' : 'text-text-dim hover:bg-surface-2 hover:text-text'
              )}
            >
              <GitCompare size={13} />
              Diff
            </button>
            <button
              onClick={() => void doSave()}
              disabled={active.text === active.savedText}
              title="Save (Ctrl+S)"
              className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-dim disabled:opacity-40"
            >
              {active.text === active.savedText ? 'Saved' : 'Save'}
            </button>
          </span>
        )}
      </div>

      {saveError && <p className="px-3 py-1 text-xs text-red-400">Save failed: {saveError}</p>}

      {/* Editor body, with an optional in-pane file tree */}
      <div className="flex min-h-0 flex-1">
        {treeOpen && (
          <div className="w-60 shrink-0 overflow-hidden border-r border-border">
            <FileExplorer tabId={tabId} />
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!active ? (
            <div className="flex flex-1 items-center justify-center text-sm text-text-dim">
              Nothing open yet.
            </div>
          ) : active.error ? (
            <p className="p-4 text-sm text-text-dim">{active.error}</p>
          ) : tab?.diff ? (
            <DiffPane
              tabId={tabId}
              buf={active}
              onChange={(text) => setText(tabId, active.rel, text)}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <CodeMirror
                value={active.text}
                theme={vscodeDark}
                extensions={langFor(active.rel)}
                onChange={(value) => setText(tabId, active.rel, value)}
                height="100%"
                style={{ height: '100%', fontSize: `${editorFontSize}px` }}
                basicSetup={{ foldGutter: true, highlightActiveLine: true }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
