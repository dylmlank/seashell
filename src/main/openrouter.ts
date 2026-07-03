import type { ModelInfo } from '../shared/types'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api'

interface OpenRouterModel {
  id: string
  name: string
}

let cache: { models: ModelInfo[]; fetchedAt: number } | null = null
const CACHE_TTL = 60 * 60 * 1000

/** Public model catalog — no API key required. Cached for an hour. */
export async function listOpenRouterModels(): Promise<ModelInfo[] | { error: string }> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.models
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/v1/models`)
    if (!res.ok) return { error: `OpenRouter model list failed: HTTP ${res.status}` }
    const body = (await res.json()) as { data?: OpenRouterModel[] }
    const models = (body.data ?? [])
      .map((m) => ({ id: m.id, displayName: m.name || m.id }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
    cache = { models, fetchedAt: Date.now() }
    return models
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
