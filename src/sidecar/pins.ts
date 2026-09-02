import { writeFileAtomicSync } from './atomic-write'
import { join } from 'path'
import { readJsonFile } from './json-file'
import { userDataDir } from './paths'

// Pinned chat sessions — a plain list of session ids the user starred,
// shown in their own section at the top of the history sidebar.

const file = (): string => join(userDataDir(), 'pins.json')

function load(): string[] {
  try {
    const parsed = readJsonFile<unknown>(file()) as unknown
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
    writeFileAtomicSync(file(), JSON.stringify(next, null, 2))
    return next
  }
}
