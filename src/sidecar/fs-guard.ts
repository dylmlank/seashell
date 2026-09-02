import { resolve, sep } from 'path'

/** Resolve a path inside `root`, returning null if it escapes.
 *
 *  A plain `target.startsWith(root)` is not enough: with root `/work/app` it
 *  happily admits `/work/app-secrets`. Comparing against `root + sep` (and
 *  allowing root itself) is the separator-aware form.
 */
export function resolveWithin(root: string, ...segments: string[]): string | null {
  const base = resolve(root)
  const target = resolve(base, ...segments)
  if (target === base) return target
  return target.startsWith(base.endsWith(sep) ? base : base + sep) ? target : null
}
