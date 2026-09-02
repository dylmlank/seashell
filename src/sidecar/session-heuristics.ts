import type { ThinkingLevel } from '../shared/types'

/** Per-message reasoning and model routing — the judgement calls the app
 *  makes on the user's behalf before a turn starts.
 *
 *  Split out of session-manager because these are pure functions over a
 *  string, they are the part most worth testing, and they were buried in a
 *  900-line class that does session lifecycle, context accounting and plan
 *  limits besides.
 */

/** Thinking-token budget per level (0 disables extended thinking). Mirrors the
 *  Claude Code CLI's low → ultra reasoning-effort ladder. */
export const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  off: 0,
  low: 4_000,
  medium: 10_000,
  high: 18_000,
  ultra: 31_999
}

const THINKING_RANK: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'ultra']

/** Smart thinking: pick a budget for THIS message, never above the user's
 *  chosen ceiling. Short chatter gets none; hard/code-heavy questions get more.
 *  Also drives smart model routing (off→haiku, low/medium→sonnet, high→chosen).
 *
 *  Signals, from strongest to weakest:
 *  - hard: reasoning-heavy verbs (debug, design, why, refactor, audit…)
 *  - build: coding INTENT even when worded casually (implement, fix, add a
 *    feature, make it do X, write a component…) — these must never grade as
 *    chatter, or a coding task lands on a Q&A model
 *  - code: literal code markers (fences, file extensions, errors) */
const BUILD_VERBS =
  /\b(implement|build|create|add|fix|make|write|update|change|remove|rename|migrate|integrate|wire|hook up|set ?up)\b/i
const BUILD_NOUNS =
  /\b(feature|function|component|page|button|endpoint|api|test|script|file|bug|command|panel|screen|app|site|server|class|module|style|animation|sidebar|menu|list|view|tab|window|dialog|modal|header|footer|icon|theme|layout|form|route|setting)s?\b/i
const BREAKAGE = /\b(bug|broken|doesn'?t work|not working|crash(es|ed)?|fails?|failing)\b/i

/** Coding intent, even when worded casually — "make the sidebar collapsible"
 *  must never be graded (or model-routed) as chatter. */
export function hasBuildIntent(text: string): boolean {
  return (BUILD_VERBS.test(text) && BUILD_NOUNS.test(text)) || BREAKAGE.test(text)
}

export function smartThinkingLevel(text: string, ceiling: ThinkingLevel): ThinkingLevel {
  const capIdx = THINKING_RANK.indexOf(ceiling)
  if (capIdx <= 0) return 'off'
  const t = text.trim()
  const hard =
    /\b(why|debug|design|architect|refactor|optimi[sz]e|prove|plan|complex|race|deadlock|security|audit|investigate|root cause)\b/i.test(t)
  const build = hasBuildIntent(t)
  const ask = /\b(summari[sz]e|explain|describe|compare|walk me through|tell me about|how do(es)?|what does|where is)\b/i.test(t)
  const code = /```|\berror\b|exception|stack trace|\.(ts|tsx|js|jsx|py|rs|cs|cpp|java|go)\b/i.test(t)
  let want: number
  if (t.length < 60 && !hard && !build && !code && !ask) want = 0
  else if ((hard && code) || (build && (hard || code))) want = THINKING_RANK.indexOf('high')
  else if (build || hard || code || t.length > 400) want = THINKING_RANK.indexOf('medium')
  else want = THINKING_RANK.indexOf('low')
  return THINKING_RANK[Math.min(want, capIdx)]
}

/** Model routing on the same signals. Build intent alone (no code attached
 *  yet) still deserves the session's real model — new-feature asks usually
 *  arrive without code blocks. */
export function smartModelChoice(text: string, preferred: string): string {
  const grade = smartThinkingLevel(text, 'ultra')
  if (grade === 'high' || grade === 'ultra') return preferred
  if (hasBuildIntent(text)) return preferred
  return grade === 'off' ? 'haiku' : 'sonnet'
}
