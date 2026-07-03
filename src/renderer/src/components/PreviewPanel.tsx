import { useCallback, useEffect, useState } from 'react'
import { Eye, Loader2, RefreshCw } from 'lucide-react'
import { Markdown } from './Markdown'

function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\')
}

/** Live rendered view of the latest HTML/SVG/Markdown file Claude produced —
 *  the shell's take on Claude Desktop's artifacts panel. */
export function PreviewPanel({ path, cwd }: { path: string; cwd: string }): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const absPath = isAbsolute(path) ? path : `${cwd.replace(/[\\/]+$/, '')}\\${path}`
  const name = path.split(/[\\/]/).pop() ?? path
  const isMarkdown = /\.(md|markdown)$/i.test(name)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    const result = await window.api.invoke('fs:readFile', { path: absPath })
    if ('error' in result) {
      setError(result.error)
      setContent(null)
    } else {
      setContent(result.content)
    }
  }, [absPath])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <Eye size={14} className="text-accent" />
        <span className="truncate font-mono text-xs" title={absPath}>
          {name}
        </span>
        <button
          onClick={() => void load()}
          title="Reload preview"
          className="ml-auto rounded p-1 text-text-dim hover:bg-surface-2 hover:text-text"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {error ? (
        <p className="p-4 text-sm text-red-400">{error}</p>
      ) : content === null ? (
        <div className="flex items-center gap-2 p-4 text-sm text-text-dim">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : isMarkdown ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
          <Markdown text={content} />
        </div>
      ) : (
        // Scripts stay enabled so interactive artifacts work; the sandbox still
        // blocks navigation, popups, and anything outside the frame.
        <iframe
          title="artifact preview"
          sandbox="allow-scripts"
          srcDoc={content}
          className="min-h-0 flex-1 border-0 bg-white"
        />
      )}
    </div>
  )
}
