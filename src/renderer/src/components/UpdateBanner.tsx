import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

type Phase = 'idle' | 'available' | 'installing' | 'failed'

/** How often to look for a new release while the app stays open. */
const CHECK_EVERY_MS = 15 * 60 * 1000

/** Watches GitHub Releases and offers a new build in-app.
 *
 *  Checks at startup and every 15 minutes after, because a window left open
 *  for a day would otherwise never learn about anything published since —
 *  which is most of the point of shipping small builds often. */
export function UpdateBanner(): React.JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle')
  const [update, setUpdate] = useState<Update | null>(null)
  const [progress, setProgress] = useState(0)
    // The poll runs from an effect that mounts once, so it needs the current
  // phase rather than the one captured in that closure. Synced in an effect
  // rather than during render — a ref written mid-render is a tearing hazard
  // under concurrent rendering, and React's lint rule is right to reject it.
  const phaseRef = useRef<Phase>('idle')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    let alive = true

    const look = async (): Promise<void> => {
      // Don't yank the banner out from under someone mid-download, and don't
      // re-offer a version they've already been shown.
      if (!alive || phaseRef.current !== 'idle') return
      try {
        const found = await check()
        if (!alive || !found) return
        setUpdate(found)
        setPhase('available')
      } catch (err) {
        // Offline, rate-limited, or running an unpackaged dev build — all
        // normal. An update check is never worth interrupting anyone over.
        console.warn('[updater] check failed:', err)
      }
    }

    void look()
    // Checking only at startup meant a session left open for a day never
    // learned about anything published since, which is most of the value of
    // shipping small builds often.
    const timer = setInterval(() => void look(), CHECK_EVERY_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
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

  if (phase === 'idle') return null

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
          onClick={() => {
            // "Not now", not "never": returning to idle lets the next poll
            // re-offer this version, or a newer one.
            setUpdate(null)
            setPhase('idle')
          }}
          className="ml-auto rounded p-1 text-text-dim hover:bg-border hover:text-text"
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
