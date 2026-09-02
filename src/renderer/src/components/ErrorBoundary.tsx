import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  stack: string
}

/** Without this, a single render throw anywhere in the tree leaves the user
 *  staring at a blank window with no way to tell us what happened — and with
 *  no crash reporting, no way for us to find out either. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' })
    console.error('[ui] render crashed:', error, info.componentStack)
  }

  private report = (): void => {
    const { error, stack } = this.state
    const body = [
      `Seashell ${__APP_VERSION__} — ${navigator.userAgent}`,
      '',
      `${error?.name}: ${error?.message}`,
      error?.stack ?? '',
      '',
      'Component stack:',
      stack
    ].join('\n')
    void navigator.clipboard.writeText(body)
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
            Copy diagnostics
          </button>
        </div>
      </div>
    )
  }
}
