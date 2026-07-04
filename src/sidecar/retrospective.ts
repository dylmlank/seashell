import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const SKILL_DIR = join(homedir(), '.claude', 'skills', 'shell-retrospective')

const SKILL_MD = `---
name: shell-retrospective
description: Brief end-of-turn retrospective — capture durable lessons from the exchange that just happened into persistent memory. Invoked automatically by Seashell when auto-retrospective is enabled.
---

Look back at the exchange that just finished (the user's last request and how you handled it) and do a fast retrospective:

1. **What is worth remembering?** Non-obvious facts about the user's project, preferences they expressed, decisions made, or approaches that worked/failed. Skip anything derivable from the code or already recorded.
2. **Store it.** If (and only if) something durable surfaced, write it to your persistent memory following your memory instructions (one fact per file, update the index). Update existing memories rather than duplicating.
3. **Stay silent otherwise.** If nothing durable surfaced, reply with exactly: "Nothing new to remember." Do not pad.

Hard limits: no code changes, no file edits outside the memory directory, reply in at most 3 short lines.
`

/** Make sure the user-level retrospective skill exists so sessions can invoke it. */
export function ensureRetrospectiveSkill(): void {
  try {
    if (!existsSync(SKILL_DIR)) mkdirSync(SKILL_DIR, { recursive: true })
    const file = join(SKILL_DIR, 'SKILL.md')
    if (!existsSync(file)) writeFileSync(file, SKILL_MD)
  } catch (err) {
    console.error('failed to install shell-retrospective skill:', err)
  }
}

export const RETRO_PROMPT =
  'Run your shell-retrospective skill now for the exchange above. At most 3 short lines.'
