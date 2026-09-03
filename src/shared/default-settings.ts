import type { AppSettings } from './types'

/** The one definition of what an unconfigured Seashell does.
 *
 *  This lived twice — once in the sidecar store, once again in the renderer
 *  store as the placeholder shown before `settings:get` answers. Two copies of
 *  the same 30 fields drift the moment anyone edits one, and the drift is
 *  invisible: the UI just shows the wrong toggle state for a few hundred
 *  milliseconds at boot, or forever if the sidecar never replies.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: null,
  defaultPermissionMode: 'default',
  defaultProvider: 'anthropic',
  openrouterModel: null,
  customBaseUrl: null,
  customModel: null,
  notifications: true,
  allowSelfSkills: true,

  // The point of the app: capture what was learned after every answer, and
  // keep the context from bloating. Both of these shipped off, which meant the
  // feature the project exists for was one nobody would ever find.
  autoRetrospective: true,
  // "After every response" means every response, not only ones that touched
  // files — a decision, a preference or a dead end is worth remembering even
  // when nothing was written.
  retroOnlyAfterEdits: false,
  autoCompact: true,
  // Compact stays threshold-based rather than every-turn on purpose.
  // Summarising a 5k context spends a whole call to save almost nothing and
  // throws away detail there was still room for — it costs more than it saves.
  // 40k is roughly where the savings on later turns clear the price of the
  // call that makes them.
  compactThreshold: 40_000,

  importDesktopMcp: true,
  autoScreenshots: true,
  fontSize: 'md',
  reducedMotion: false,
  accent: '#14b8a6',
  theme: 'abyss',
  terminalShell: 'cmd',
  terminalFontSize: 13,
  editorFontSize: 13,
  smoothStreaming: true,
  reopenLastProject: true,
  chatWidth: 'wide',
  defaultThinkingLevel: 'medium',
  smartThinking: true,
  smartModel: true,
  leanSessions: false,
  templates: [],
  responseStyle: 'normal',
  speakReplies: false,
  autoTidySessions: true,
  projectsRoot: null,
  dailyBudgetUsd: null,
  sessionBudgetUsd: null
}
