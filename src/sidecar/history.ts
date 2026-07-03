import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import type { ProjectSummary, SessionSummary } from '../shared/types'

function toSummary(s: {
  sessionId: string
  summary: string
  firstPrompt?: string
  cwd?: string
  lastModified: number
  createdAt?: number
  gitBranch?: string
}): SessionSummary {
  return {
    sessionId: s.sessionId,
    title: s.summary,
    firstPrompt: s.firstPrompt,
    cwd: s.cwd,
    lastModified: s.lastModified,
    createdAt: s.createdAt,
    gitBranch: s.gitBranch
  }
}

export const history = {
  async listProjects(): Promise<ProjectSummary[]> {
    const sessions = await listSessions()
    const byPath = new Map<string, ProjectSummary>()
    for (const s of sessions) {
      if (!s.cwd) continue
      const existing = byPath.get(s.cwd)
      if (existing) {
        existing.sessionCount++
        existing.lastActive = Math.max(existing.lastActive, s.lastModified)
      } else {
        byPath.set(s.cwd, { realPath: s.cwd, sessionCount: 1, lastActive: s.lastModified })
      }
    }
    return [...byPath.values()].sort((a, b) => b.lastActive - a.lastActive)
  },

  async listSessions(dir?: string): Promise<SessionSummary[]> {
    let sessions = await listSessions(dir ? { dir } : { limit: 50 })
    if (dir && sessions.length === 0) {
      // {dir} finds nothing for drive-root projects (E:\) — filter globally.
      const want = dir.replace(/[\\/]+$/, '').toLowerCase()
      sessions = (await listSessions({ limit: 200 })).filter(
        (s) => (s.cwd ?? '').replace(/[\\/]+$/, '').toLowerCase() === want
      )
    }
    return sessions.map(toSummary).sort((a, b) => b.lastModified - a.lastModified)
  }
}
