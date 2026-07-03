import { useState } from 'react'

/** Wraps a side panel with a draggable left edge; the width sticks per panel type. */
export function SidePanelShell({
  storageKey,
  defaultWidth,
  min = 260,
  max = 1100,
  children
}: {
  storageKey: string
  defaultWidth: number
  min?: number
  max?: number
  children: React.ReactNode
}): React.JSX.Element {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(`panel-width:${storageKey}`))
    return saved >= min && saved <= max ? saved : defaultWidth
  })

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const clamp = (w: number): number => Math.min(max, Math.max(min, w))
    const onMove = (ev: MouseEvent): void => setWidth(clamp(startWidth + (startX - ev.clientX)))
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      localStorage.setItem(
        `panel-width:${storageKey}`,
        String(clamp(startWidth + (startX - ev.clientX)))
      )
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="relative flex h-full shrink-0" style={{ width }}>
      <div
        onMouseDown={startDrag}
        title="Drag to resize"
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-accent/40 active:bg-accent/60"
      />
      <div className="h-full w-full min-w-0">{children}</div>
    </div>
  )
}
