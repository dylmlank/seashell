import { create } from 'zustand'
import type { ImageAttachment, UserCommand } from '@shared/types'
import {
  findNative,
  NATIVE_SUGGESTIONS,
  type SlashSuggestion
} from '../lib/slash-commands'
import { sendMessage, useSessions } from './sessions'

interface CommandsStore {
  /** User-authored macros per tab, loaded from `.claude/commands`. */
  byTab: Record<string, UserCommand[]>
  load: (tabId: string) => Promise<void>
}

export const useCommands = create<CommandsStore>((set) => ({
  byTab: {},
  load: async (tabId) => {
    const res = await window.api.invoke('commands:list', { tabId })
    if (!('error' in res)) set((s) => ({ byTab: { ...s.byTab, [tabId]: res.commands } }))
  }
}))

/** Merge the three command sources into one autocomplete list, native first,
 *  de-duped by name (native shadows a same-named macro shadows a builtin). */
export function mergeSuggestions(
  userCmds: UserCommand[] | undefined,
  builtin: string[]
): SlashSuggestion[] {
  const seen = new Set<string>()
  const out: SlashSuggestion[] = []
  for (const s of NATIVE_SUGGESTIONS) {
    out.push(s)
    seen.add(s.name)
  }
  for (const c of userCmds ?? []) {
    if (seen.has(c.name)) continue
    seen.add(c.name)
    out.push({ name: c.name, description: c.description, argHint: c.argumentHint, source: 'user' })
  }
  for (const name of builtin) {
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ name, source: 'builtin' })
  }
  return out
}

/** Substitute `$ARGUMENTS` and positional `$1`…`$9` in a macro body. */
export function expandMacro(cmd: UserCommand, args: string): string {
  const trimmed = args.trim()
  const argv = trimmed ? trimmed.split(/\s+/) : []
  return cmd.body
    .replace(/\$ARGUMENTS\b/g, trimmed)
    .replace(/\$([1-9])/g, (_m, d: string) => argv[Number(d) - 1] ?? '')
}

/** Route a composer submission: run a native command locally, expand a user
 *  macro, or hand the text to the SDK (builtin commands + normal messages). */
export async function dispatchMessage(
  tabId: string,
  text: string,
  images?: ImageAttachment[]
): Promise<void> {
  const trimmed = text.trimStart()
  // `//` escapes the leading slash so you can literally message something like "/etc".
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    const rest = trimmed.slice(1)
    const gap = rest.search(/\s/)
    const name = (gap === -1 ? rest : rest.slice(0, gap)).trim()
    const args = gap === -1 ? '' : rest.slice(gap + 1)
    const tab = useSessions.getState().tabs.find((t) => t.tabId === tabId)

    const native = findNative(name)
    if (native) {
      await native.run(args, { tabId, cwd: tab?.cwd ?? '' })
      return
    }

    const macro = useCommands.getState().byTab[tabId]?.find((c) => c.name === name)
    if (macro) {
      // If the SDK already indexed this command, let it expand — that keeps
      // Claude Code's own `!`/`@` directives working. Otherwise expand locally.
      if (tab?.slashCommands.includes(name)) sendMessage(tabId, text, images)
      else sendMessage(tabId, expandMacro(macro, args), images)
      return
    }
  }
  sendMessage(tabId, text, images)
}
