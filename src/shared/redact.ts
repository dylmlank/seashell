/** Masking for secrets that would otherwise be rendered back at the user.
 *
 *  This is display-only. Claude still receives the real content — the point is
 *  that an approval dialog for a `.env` edit shouldn't paint your API keys
 *  across the screen, where a screen-share or a screenshot picks them up.
 *
 *  Redaction in a *security* dialog is a trade, though: anything hidden is
 *  something the user can't inspect before approving. So this masks values
 *  only, never structure — you can always see which keys changed and how many
 *  — and every redacted view is one click from being revealed.
 */

const MASK = '••••••••'

/** Files whose values are secret by convention, whatever they're named. */
function isEnvLike(filePath?: string): boolean {
  if (!filePath) return false
  const name = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env')
}

/** Token shapes worth masking wherever they appear. Deliberately narrow:
 *  a false positive hides something the user needed to see. */
const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic
  /\bsk-[A-Za-z0-9]{32,}/g, // OpenAI-style
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bAIza[A-Za-z0-9_-]{35}\b/g, // Google
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g // JWT
]

/** `KEY=value`, `KEY: value`, `"key": "value"` where the key smells secret. */
const SECRET_KEY = /(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth)/i

const PEM_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g

function maskAssignments(line: string, everyValue: boolean): string {
  // KEY=value  (env files, shell exports)
  const env = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.+)$/)
  if (env) {
    const [, lead, key, eq] = env
    if (everyValue || SECRET_KEY.test(key)) return `${lead}${key}${eq}${MASK}`
    return line
  }
  // "key": "value"  /  key: value
  const kv = line.match(/^(\s*["']?)([A-Za-z0-9_.-]*?)(["']?\s*:\s*)(["']?)([^"'\s].*?)(["']?,?)$/)
  if (kv) {
    const [, lead, key, sep, openQ, , closeQ] = kv
    if (SECRET_KEY.test(key)) return `${lead}${key}${sep}${openQ}${MASK}${closeQ}`
  }
  return line
}

/** Mask secret-looking values in `text`. Pass the file path when you have it —
 *  env-like files get every value masked, not just suspicious keys. */
export function redactSecrets(text: string, filePath?: string): string {
  if (!text) return text
  const everyValue = isEnvLike(filePath)
  let out = text.replace(PEM_BLOCK, `-----BEGIN PRIVATE KEY-----\n${MASK}\n-----END PRIVATE KEY-----`)
  out = out
    .split('\n')
    .map((line) => maskAssignments(line, everyValue))
    .join('\n')
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, MASK)
  return out
}

/** Would redacting this change anything? Drives whether the UI offers a
 *  "reveal" toggle at all — no point showing one on an ordinary source file. */
export function hasRedactableSecrets(text: string, filePath?: string): boolean {
  return redactSecrets(text, filePath) !== text
}
