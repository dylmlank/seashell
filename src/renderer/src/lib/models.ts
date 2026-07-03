/** Context window size for a model id (best-effort static table). */
export function contextWindow(model?: string): number {
  if (!model) return 200_000
  if (model.includes('[1m]') || model.includes('-1m')) return 1_000_000
  return 200_000
}
