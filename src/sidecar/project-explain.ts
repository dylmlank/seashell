import { query } from '@anthropic-ai/claude-agent-sdk'
import { createHash } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ProjectExplanation } from '../shared/types'
import { userDataDir } from './paths'
import { analyzeProject } from './project-map'
import { settingsStore } from './settings-store'

// The narrative layer of the Workflow tab: one Claude call, grounded in the
// static project map + README, that explains how the project actually works
// and what makes it different. Generated only when the user asks (it spends
// plan quota), then cached per project until they hit refresh.

function cachePath(cwd: string): string {
  const dir = join(userDataDir(), 'explain')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${createHash('sha1').update(cwd.toLowerCase()).digest('hex')}.json`)
}

function readGrounding(cwd: string): string {
  for (const name of ['README.md', 'readme.md', 'README.txt']) {
    try {
      return readFileSync(join(cwd, name), 'utf8').slice(0, 5000)
    } catch {
      // try the next name
    }
  }
  return '(no README)'
}

function isExplanation(v: unknown): v is Omit<ProjectExplanation, 'generatedAt'> {
  const e = v as ProjectExplanation
  return (
    typeof e?.summary === 'string' &&
    Array.isArray(e.flow) &&
    e.flow.every((s) => typeof s?.title === 'string' && typeof s?.detail === 'string') &&
    Array.isArray(e.parts) &&
    e.parts.every((p) => typeof p?.name === 'string' && typeof p?.role === 'string') &&
    Array.isArray(e.different) &&
    e.different.every((d) => typeof d === 'string')
  )
}

export const projectExplain = {
  cached(cwd: string): ProjectExplanation | null {
    try {
      const parsed = JSON.parse(readFileSync(cachePath(cwd), 'utf8')) as unknown
      return isExplanation(parsed) ? (parsed as ProjectExplanation) : null
    } catch {
      return null
    }
  },

  async generate(cwd: string): Promise<ProjectExplanation | { error: string }> {
    const map = await analyzeProject(cwd)
    const prompt = `You are explaining a software project to its owner in plain, everyday language (no jargon; when a technical term is unavoidable, say what it means).

Here is what static analysis found:
- Stack: ${map.stack.join(', ') || 'unknown'}
- Size: ${map.totalLines} lines across ${map.totalFiles} files
- Modules: ${map.modules.map((m) => `${m.name} (${m.lines} lines)`).join(', ')}
- Module dependencies: ${map.edges.map((e) => `${e.from}→${e.to}`).join(', ') || 'none'}
- External services called: ${map.externals.map((e) => `${e.host} (${e.kind}, from ${e.files[0] ?? '?'})`).join(', ') || 'none'}

README (may be truncated):
${readGrounding(cwd)}

Explain how this project ACTUALLY works — the way you would if the owner asked "how does this work and how is it different from others?".

Respond with ONLY a JSON object (no markdown fences, no other text) in exactly this shape:
{
  "summary": "one tight paragraph: what it is, what it does, in plain language",
  "flow": [{ "title": "3-6 word step name", "detail": "one sentence: what happens in this step" }],
  "parts": [{ "name": "component name", "role": "one sentence: its job" }],
  "different": ["one sentence per point: what sets this apart from typical alternatives"]
}

Rules: flow = 4 to 7 steps tracing what happens end to end when the project is used (start from the user's action). parts = 3 to 6. different = 2 to 5. Ground every claim in the analysis and README above — do not invent features. Do not use any tools.`

    try {
      const q = query({
        prompt,
        options: {
          cwd,
          model: settingsStore.get().defaultModel ?? undefined,
          maxTurns: 1,
          // Bare session: no CLAUDE.md, plugins, or MCP servers — keeps this
          // call as small as possible since it answers purely from the prompt.
          settingSources: [],
          allowedTools: []
        }
      })
      let text: string | null = null
      for await (const msg of q) {
        if (msg.type === 'result') {
          if (msg.subtype === 'success') text = msg.result
          else return { error: `Claude call ended early (${msg.subtype})` }
        }
      }
      if (!text) return { error: 'No response from Claude' }

      // Tolerate a fenced or padded reply: grab the outermost JSON object.
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start === -1 || end <= start) return { error: 'Claude did not return JSON' }
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
      if (!isExplanation(parsed)) return { error: 'Claude returned an unexpected shape' }

      const explanation: ProjectExplanation = { ...parsed, generatedAt: Date.now() }
      writeFileSync(cachePath(cwd), JSON.stringify(explanation, null, 2), 'utf8')
      return explanation
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
}
