import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { userDataDir } from './paths'

// Pinned chat sessions — a plain list of session ids the user starred,
// shown in their own section at the top of the history sidebar.

const file = (): string => join(userDataDir(), 'pins.json')

function load(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as unknown
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export const pins = {
  list(): string[] {
    return load()
  },

  toggle(sessionId: string): string[] {
    const current = load()
    const next = current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : [...current, sessionId]
    writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8')
    return next
  }
}
