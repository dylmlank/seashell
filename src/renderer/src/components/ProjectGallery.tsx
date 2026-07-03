import { useEffect, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import type { ProjectPreview } from '@shared/types'
import { createTab } from '../stores/sessions'
import { alertDialog } from '../lib/dialogs'

function timeAgo(ms: number): string {
  const hours = Math.floor((Date.now() - ms) / 3_600_000)
  if (hours < 1) return 'active now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Recent projects as visual cards: a generated SVG cover (languages, README,
 *  git) or a captured screenshot of the running site. Click to open. */
export function ProjectGallery(): React.JSX.Element | null {
  const [cards, setCards] = useState<ProjectPreview[] | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [capturing, setCapturing] = useState<string | null>(null)
  const [captureUrl, setCaptureUrl] = useState('http://localhost:')

  const refresh = async (): Promise<void> => {
    setCards(await window.api.invoke('previews:cards'))
  }

  useEffect(() => {
    void refresh()
  }, [])

  const open = async (cwd: string): Promise<void> => {
    if (opening) return
    setOpening(cwd)
    try {
      await createTab(cwd)
    } catch (err) {
      void alertDialog(err instanceof Error ? err.message : String(err))
    } finally {
      setOpening(null)
    }
  }

  const capture = async (cwd: string): Promise<void> => {
    const result = await window.api.invoke('previews:capture', { cwd, url: captureUrl.trim() })
    setCapturing(null)
    if ('error' in result) void alertDialog(`Screenshot failed: ${result.error}`)
    else void refresh()
  }

  if (cards === null || cards.length === 0) return null

  return (
    <div className="w-full max-w-4xl px-8 pb-10">
      <p className="pb-3 text-xs font-semibold uppercase tracking-wider text-text-dim/70">
        Your projects
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.cwd}
            className="group overflow-hidden rounded-2xl border border-border bg-surface transition-all hover:-translate-y-1 hover:border-accent-dim/60 hover:shadow-xl hover:shadow-accent/5"
          >
            <button onClick={() => void open(card.cwd)} title={card.cwd} className="block w-full">
              <div className="relative aspect-[2/1] w-full overflow-hidden bg-bg">
                {card.screenshot ? (
                  <img
                    src={`data:image/png;base64,${card.screenshot}`}
                    alt={card.name}
                    className="h-full w-full object-cover object-top"
                  />
                ) : (
                  <img
                    src={`data:image/svg+xml;utf8,${encodeURIComponent(card.svg)}`}
                    alt={card.name}
                    className="h-full w-full object-cover"
                  />
                )}
                {opening === card.cwd && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 size={20} className="animate-spin text-accent" />
                  </span>
                )}
              </div>
            </button>
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{card.name}</p>
                <p className="text-[11px] text-text-dim/70">
                  {card.sessionCount} session{card.sessionCount !== 1 ? 's' : ''} ·{' '}
                  {timeAgo(card.lastActive)}
                </p>
              </div>
              <button
                onClick={() => {
                  setCapturing(capturing === card.cwd ? null : card.cwd)
                  setCaptureUrl('http://localhost:')
                }}
                title="Capture a screenshot of this project's site as its cover"
                className="ml-auto rounded-lg p-1.5 text-text-dim opacity-0 transition-opacity hover:bg-surface-2 hover:text-text group-hover:opacity-100"
              >
                <Camera size={14} />
              </button>
            </div>
            {capturing === card.cwd && (
              <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
                <input
                  autoFocus
                  value={captureUrl}
                  onChange={(e) => setCaptureUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void capture(card.cwd)
                    if (e.key === 'Escape') setCapturing(null)
                  }}
                  placeholder="http://localhost:5173"
                  className="w-full rounded-lg border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent-dim"
                />
                <button
                  onClick={() => void capture(card.cwd)}
                  className="shrink-0 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-dim"
                >
                  Capture
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
