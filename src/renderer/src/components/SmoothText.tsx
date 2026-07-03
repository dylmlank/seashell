import { useEffect, useState } from 'react'
import { useSettings } from '../stores/settings'
import { Markdown } from './Markdown'

// Streaming text arrives in ragged chunks. Instead of painting every chunk
// (choppy), hold the in-progress line back and release completed blocks one
// at a time on a steady cadence — each new block fades in (see .smooth-stream
// in index.css). When the turn ends, the remainder drains quickly.

const REVEAL_MS = 150
const DRAIN_MS = 50

/** Split into paragraph blocks, keeping unbalanced code fences glued together
 *  so a reveal boundary never lands inside a ``` block. */
function splitBlocks(text: string): string[] {
  const rough = text.split('\n\n')
  const blocks: string[] = []
  let open = false
  for (const part of rough) {
    if (open) blocks[blocks.length - 1] += `\n\n${part}`
    else blocks.push(part)
    const fences = (blocks[blocks.length - 1].match(/```/g) ?? []).length
    open = fences % 2 === 1
  }
  return blocks
}

export function SmoothText({
  text,
  streaming
}: {
  text: string
  streaming: boolean
}): React.JSX.Element {
  const reducedMotion = useSettings((s) => s.settings.reducedMotion)
  const [revealed, setRevealed] = useState(0)

  const blocks = splitBlocks(text)
  // While streaming, the last block is still being written — hold it back.
  const ready = streaming ? Math.max(0, blocks.length - 1) : blocks.length

  // Timeout chain: release one block per tick until caught up.
  useEffect(() => {
    if (revealed >= ready) return
    if (reducedMotion) {
      setRevealed(ready)
      return
    }
    const timer = setTimeout(
      () => setRevealed((r) => Math.min(r + 1, ready)),
      streaming ? REVEAL_MS : DRAIN_MS
    )
    return () => clearTimeout(timer)
  }, [revealed, ready, streaming, reducedMotion])

  const count = Math.min(revealed, ready)
  const settled = !streaming && count >= blocks.length

  return (
    <div className={settled ? undefined : 'smooth-stream'}>
      {count > 0 && <Markdown text={blocks.slice(0, count).join('\n\n')} />}
      {!settled && <span className="cursor-blink inline-block h-4 w-2 bg-accent" />}
    </div>
  )
}
