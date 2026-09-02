import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

type Phase = 'idle' | 'available' | 'installing' | 'failed'

/** Checks GitHub Releases once at startup and offers the update in-app.
 *  Builds are unsigned, so without this a user who installs once never hears
 *  about a fix again — they'd have to notice the repo moved on. */
export function UpdateBanner(): React.JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle')
  const [update, setUpdate] = useState<Update | null>(null)
  const [progress, setProgress] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const found = await check()
        if (found) {
          setUpdate(found)
          setPhase('available')
        }
      } catch (err) {
        // Offline, rate-limited, or running an unpackaged dev build — all
        // normal. An update check is never worth interrupting anyone over.
        console.warn('[updater] check failed:', err)
      }
    })()
  }, [])

  const install = async (): Promise<void> => {
    if (!update) return
    setPhase('installing')
    try {
      let total = 0
      let got = 0
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0
        else if (event.event === 'Progress') {
          got += event.data.chunkLength
          if (total > 0) setProgress(Math.round((got / total) * 100))
        }
      })
      await relaunch()
    } catch (err) {
      console.error('[updater] install failed:', err)
      setPhase('failed')
    }
  }

  if (phase === 'idle' || dismissed) return null

  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm">
      <Download size={15} className="shrink-0 text-accent" />
      {phase === 'available' && (
        <>
          <span className="text-text">
            Seashell {update?.version} is available — you&apos;re on {update?.currentVersion}.
          </span>
          <button
            onClick={() => void install()}
            className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-white"
          >
            Install and restart
          </button>
        </>
      )}
      {phase === 'installing' && (
        <span className="text-text">
          Downloading… {progress > 0 ? `${progress}%` : ''} — Seashell will restart itself.
        </span>
      )}
      {phase === 'failed' && (
        <span className="text-text">
          Update failed. Grab the installer from the Releases page instead.
        </span>
      )}
      {phase !== 'installing' && (
        <button
          onClick={() => setDismissed(true)}
          className="ml-auto rounded p-1 text-text-dim hover:bg-border hover:text-text"
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
