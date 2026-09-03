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
  // Not limited to turns that touched files — a decision or a dead end is
  // worth remembering even when nothing was written.
  retroOnlyAfterEdits: false,
  autoCompact: true,
  /** The single trigger for both follow-ups.
   *
   *  A retrospective after literally every answer costs an extra full-context
   *  call per turn, and its prompt and reply then ride along in the context
   *  for every turn after — so the price compounds. Sharing compact's
   *  threshold turns that into one extra call per ~100k of accumulated
   *  context, which is the difference between roughly double the baseline
   *  spend and a few percent over it.
   *
   *  The cost is recall granularity, not tokens: one retrospective covers many
   *  exchanges instead of each one, so finer detail is likelier to be missed.
   */
  compactThreshold: 100_000,

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
