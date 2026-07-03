import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, FileText, Mic, Square, Paperclip, X } from 'lucide-react'
import type { ImageAttachment } from '@shared/types'
import { ModelSelector } from './ModelSelector'
import { PermissionModeSwitcher } from './PermissionModeSwitcher'

interface PendingImage extends ImageAttachment {
  id: string
}

interface PendingFile {
  id: string
  path: string
  name: string
}

export function Composer({
  tabId,
  disabled,
  streaming,
  slashCommands,
  hideModeControls,
  onSend,
  onStop
}: {
  tabId: string
  disabled: boolean
  streaming: boolean
  slashCommands: string[]
  /** Chat-only sessions have no permission modes worth switching. */
  hideModeControls?: boolean
  onSend: (text: string, images: ImageAttachment[]) => void
  onStop: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [files, setFiles] = useState<PendingFile[]>([])
  const [slashIndex, setSlashIndex] = useState(0)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  // Slash autocomplete: active while the input is a single line starting with "/".
  const slashMatches = useMemo(() => {
    if (!text.startsWith('/') || text.includes(' ') || text.includes('\n')) return []
    const needle = text.slice(1).toLowerCase()
    return slashCommands.filter((c) => c.toLowerCase().startsWith(needle)).slice(0, 8)
  }, [text, slashCommands])

  useEffect(() => setSlashIndex(0), [slashMatches.length])

  const submit = (): void => {
    const trimmed = text.trim()
    if ((!trimmed && images.length === 0 && files.length === 0) || disabled) return
    // Non-image attachments travel as paths — Claude reads them with its own tools.
    const withFiles = files.length
      ? `${trimmed}\n\n[Attached files — read them as needed]\n${files.map((f) => `- ${f.path}`).join('\n')}`
      : trimmed
    onSend(withFiles, images.map(({ id: _id, ...img }) => img))
    setText('')
    setImages([])
    setFiles([])
    if (areaRef.current) areaRef.current.style.height = 'auto'
  }

  const addAttachments = async (fileList: FileList | File[]): Promise<void> => {
    for (const file of Array.from(fileList)) {
      if (file.type.startsWith('image/')) {
        const buf = await file.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buf)
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
        }
        setImages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), mediaType: file.type, data: btoa(binary) }
        ])
      } else {
        const path = window.api.pathForFile(file)
        if (!path) continue // pasted content with no on-disk location
        setFiles((prev) =>
          prev.some((f) => f.path === path)
            ? prev
            : [...prev, { id: crypto.randomUUID(), path, name: file.name }]
        )
      }
    }
  }

  // Attach files by absolute path — from the native picker or a Tauri drop.
  // Images inline as base64; everything else becomes a path chip Claude reads.
  const addPaths = useCallback(async (paths: string[]): Promise<void> => {
    for (const path of paths) {
      const name = path.split(/[\\/]/).pop() ?? path
      if (/\.(png|jpe?g|gif|webp)$/i.test(name)) {
        const result = await window.api.invoke('fs:readFileBase64', { path })
        if (!('error' in result)) {
          setImages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), mediaType: result.mediaType, data: result.data }
          ])
          continue
        }
      }
      setFiles((prev) =>
        prev.some((f) => f.path === path)
          ? prev
          : [...prev, { id: crypto.randomUUID(), path, name }]
      )
    }
  }, [])

  const attachViaDialog = async (): Promise<void> => {
    const paths = await window.api.pickFiles()
    if (paths) void addPaths(paths)
  }

  // Files dropped anywhere on the window land in the main composer (side
  // chats are read-only, so they don't take attachments).
  useEffect(() => {
    if (hideModeControls) return
    const onDrop = (e: Event): void => {
      void addPaths((e as CustomEvent<string[]>).detail)
    }
    window.addEventListener('shell-file-drop', onDrop)
    return () => window.removeEventListener('shell-file-drop', onDrop)
  }, [hideModeControls, addPaths])

  const dictate = async (): Promise<void> => {
    areaRef.current?.focus()
    const result = await window.api.invoke('dictation:start')
    if ('error' in result) alert(result.error)
  }

  return (
    <div className="px-6 pb-4 pt-2">
      <div className="mx-auto w-full max-w-3xl">
        {(images.length > 0 || files.length > 0) && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {images.map((img) => (
              <div key={img.id} className="group relative anim-in">
                <img
                  src={`data:${img.mediaType};base64,${img.data}`}
                  alt="attachment"
                  className="h-16 w-16 rounded-lg border border-border object-cover"
                />
                <button
                  onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-surface-2 p-0.5 opacity-0 shadow group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {files.map((f) => (
              <span
                key={f.id}
                title={f.path}
                className="anim-in flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs"
              >
                <FileText size={12} className="shrink-0 text-accent" />
                <span className="max-w-40 truncate">{f.name}</span>
                <button
                  onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                  className="rounded-full p-0.5 text-text-dim hover:bg-border hover:text-text"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          {slashMatches.length > 0 && (
            <div className="pop-in absolute bottom-full left-0 z-10 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-xl">
              {slashMatches.map((cmd, i) => (
                <button
                  key={cmd}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => {
                    setText(`/${cmd} `)
                    areaRef.current?.focus()
                  }}
                  className={
                    'block w-full px-3 py-1.5 text-left font-mono text-sm ' +
                    (i === slashIndex ? 'bg-accent-dim/30 text-accent' : 'text-text')
                  }
                >
                  /{cmd}
                </button>
              ))}
            </div>
          )}

          <div className="composer-card rounded-2xl border border-border bg-surface">
            <textarea
              ref={areaRef}
              value={text}
              disabled={disabled}
              rows={1}
              placeholder={
                disabled
                  ? 'Session not ready…'
                  : streaming
                    ? 'Queue your next message…'
                    : 'Message Claude…'
              }
              className="max-h-48 w-full resize-none bg-transparent px-4 pb-1 pt-3.5 outline-none placeholder:text-text-dim/70"
              onChange={(e) => {
                setText(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 192)}px`
              }}
              onPaste={(e) => {
                const pasted = Array.from(e.clipboardData.files)
                if (pasted.length) {
                  e.preventDefault()
                  void addAttachments(pasted)
                }
              }}
              onKeyDown={(e) => {
                if (slashMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSlashIndex((i) => (i + 1) % slashMatches.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length)
                    return
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    setText(`/${slashMatches[slashIndex]} `)
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (slashMatches.length > 0 && text === `/${slashMatches[slashIndex]}`) {
                    submit()
                  } else if (slashMatches.length > 0 && !text.includes(' ')) {
                    setText(`/${slashMatches[slashIndex]} `)
                  } else {
                    submit()
                  }
                }
              }}
            />

            <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1">
              <ModelSelector tabId={tabId} />
              {!hideModeControls && <PermissionModeSwitcher tabId={tabId} />}
              <span className="ml-auto" />
              <button
                onClick={() => void dictate()}
                title="Dictate with your voice (opens Windows dictation — or press Win+H)"
                className="rounded-lg p-1.5 text-text-dim hover:bg-surface-2 hover:text-text"
              >
                <Mic size={15} />
              </button>
              <button
                onClick={() => void attachViaDialog()}
                title="Attach files — images, PDFs, docs, code (or paste an image)"
                className="rounded-lg p-1.5 text-text-dim hover:bg-surface-2 hover:text-text"
              >
                <Paperclip size={15} />
              </button>
              {streaming && (
                <button
                  onClick={onStop}
                  title="Stop"
                  className="rounded-lg bg-surface-2 p-1.5 text-red-400 transition-colors hover:bg-border"
                >
                  <Square size={15} />
                </button>
              )}
              <button
                onClick={submit}
                disabled={disabled || (!text.trim() && images.length === 0 && files.length === 0)}
                title={streaming ? 'Queue message' : 'Send'}
                className="rounded-full bg-accent p-1.5 text-white shadow-md shadow-accent/20 transition-all hover:bg-accent-dim disabled:opacity-30 disabled:shadow-none"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>

        <p className="mt-2 select-none text-center text-[11px] text-text-dim/50">
          Enter to send · Shift+Enter for a new line · &quot;/&quot; for commands
        </p>
      </div>
    </div>
  )
}
