import { Component, type ErrorInfo, type ReactNode } from 'react'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  stack: string
  copied: boolean
}

/** Without this, a single render throw anywhere in the tree leaves the user
 *  staring at a blank window with no way to tell us what happened — and with
 *  no crash reporting, no way for us to find out either. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '', copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' })
    console.error('[ui] render crashed:', error, info.componentStack)
  }

  /** Everything useful about the crash, and nothing else. No project paths,
   *  no conversation content — a stack trace and a build id. */
  private diagnostics(): string {
    const { error, stack } = this.state
    return [
      `Seashell ${__APP_VERSION__} — ${navigator.userAgent}`,
      '',
      `${error?.name}: ${error?.message}`,
      error?.stack ?? '',
      '',
      'Component stack:',
      stack
    ].join('\n')
  }

  private copy = (): void => {
    void navigator.clipboard.writeText(this.diagnostics())
    this.setState({ copied: true })
  }

  /** There's no telemetry endpoint and there shouldn't be one — an app that
   *  reads your source has no business phoning home. Reporting is a prefilled
   *  issue instead: the user sees exactly what is sent, and sends it. */
  private report = (): void => {
    const title = `Crash: ${this.state.error?.message ?? 'unknown'}`.slice(0, 120)
    // GitHub truncates long query strings; keep the body well under the limit.
    const body = `**What I was doing:**\n\n_(please describe)_\n\n\`\`\`\n${this.diagnostics().slice(0, 5000)}\n\`\`\``
    const url =
      'https://github.com/dylmlank/seashell/issues/new' +
      `?labels=crash&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
    void tauriInvoke('open_external', { url })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-lg font-semibold">Something broke in the UI</h1>
        <p className="max-w-md text-sm text-text-dim">
          Your conversation is safe — it lives in the sidecar, not this window. Reloading usually
          picks up right where you left off.
        </p>
        <pre className="max-h-40 max-w-xl overflow-auto rounded bg-black/30 p-3 text-left text-xs">
          {error.name}: {error.message}
        </pre>
        <div className="flex gap-2">
          <button
            className="rounded bg-accent px-3 py-1.5 text-sm text-white"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            className="rounded border border-white/15 px-3 py-1.5 text-sm"
            onClick={this.report}
          >
            Report on GitHub
          </button>
          <button
            className="rounded border border-white/15 px-3 py-1.5 text-sm"
            onClick={this.copy}
          >
            {this.state.copied ? 'Copied' : 'Copy diagnostics'}
          </button>
        </div>
      </div>
    )
  }
}
