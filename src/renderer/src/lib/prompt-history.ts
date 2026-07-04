// Terminal-style prompt recall, per project. Up-arrow in an empty composer
// walks back through what you've sent; down-arrow walks forward again.

const KEY = 'prompt-history'
const MAX = 100

function load(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

export function pushPrompt(cwd: string, text: string): void {
  const all = load()
  const list = (all[cwd] ?? []).filter((t) => t !== text)
  list.push(text)
  all[cwd] = list.slice(-MAX)
  localStorage.setItem(KEY, JSON.stringify(all))
}

export function getPrompts(cwd: string): string[] {
  return load()[cwd] ?? []
}
