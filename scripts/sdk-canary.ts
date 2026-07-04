// SDK canary — run BEFORE bumping the pinned @anthropic-ai/claude-agent-sdk.
// Exercises every SDK surface Seashell depends on, token-free. If anything
// here breaks after an upgrade, the matching feature breaks in the app.
//
//   bun scripts/sdk-canary.ts
import * as sdk from '@anthropic-ai/claude-agent-sdk'

let failures = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// 1. Named exports we import directly.
for (const fn of ['query', 'listSessions', 'getSessionMessages', 'renameSession', 'deleteSession']) {
  check(`export ${fn}`, typeof (sdk as Record<string, unknown>)[fn] === 'function')
}

// 2. Session listing + transcript reading (history sidebar, resume, tidy).
const sessions = await sdk.listSessions({ limit: 5 })
check('listSessions returns sessions', Array.isArray(sessions), `${sessions.length} found`)
const s = sessions[0]
if (s) {
  check(
    'session summary shape',
    typeof s.sessionId === 'string' && typeof s.lastModified === 'number',
    s.sessionId.slice(0, 8)
  )
  const msgs = await sdk.getSessionMessages(s.sessionId).catch(() => null)
  check('getSessionMessages (global lookup)', Array.isArray(msgs), `${msgs?.length ?? 0} messages`)
}

// 3. Control-request surface on a live query handle (token-free: no prompt sent).
//    These power the context gauge, plan bars, model switching, and thinking.
// eslint-disable-next-line require-yield -- intentionally never yields: we only probe the control surface
async function* silence(): AsyncGenerator<never> {
  await new Promise(() => {})
}
const q = sdk.query({
  prompt: silence(),
  options: { cwd: process.cwd(), settingSources: [], maxTurns: 1 }
})
for (const method of [
  'getContextUsage',
  'setModel',
  'setMaxThinkingTokens',
  'setPermissionMode',
  'interrupt',
  'supportedModels',
  'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
]) {
  check(`query handle .${method}`, typeof (q as unknown as Record<string, unknown>)[method] === 'function')
}
await q.interrupt().catch(() => {})

console.log(failures === 0 ? '\nCanary clean — safe to consider the upgrade.' : `\n${failures} breakage(s) — do NOT upgrade without fixing.`)
process.exit(failures === 0 ? 0 : 1)
