import { spawn } from 'child_process'

// One place for "how do I do X on this OS" — everything else stays clean.

export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'

function fire(cmd: string, args: string[], cwd?: string): void {
  spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

/** Reveal a folder (or file) in the OS file manager. */
export function openPath(path: string): void {
  if (IS_WIN) fire('explorer.exe', [path])
  else if (IS_MAC) fire('open', [path])
  else fire('xdg-open', [path])
}

/** Open a URL in the default browser.
 *
 *  Windows goes through rundll32's protocol handler rather than
 *  `cmd /c start`: cmd re-parses its arguments and treats `&` as a command
 *  separator, which Node's quoting does not escape. That both truncated any
 *  URL with a query string and turned `…?a=1&calc` into a command execution.
 *  rundll32 is a plain CreateProcess call with no shell in the middle. */
export function openUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  if (IS_WIN) fire('rundll32.exe', ['url.dll,FileProtocolHandler', url])
  else if (IS_MAC) fire('open', [url])
  else fire('xdg-open', [url])
}

/** Open a folder in VS Code (best effort — needs `code` on PATH). */
export function openInVsCode(cwd: string): void {
  if (IS_WIN) fire('cmd.exe', ['/c', 'code', '.'], cwd)
  else fire('code', ['.'], cwd)
}

/** Run a command in a fresh interactive terminal window. */
export function openTerminalWith(command: string, cwd?: string): void {
  if (IS_WIN) {
    fire('cmd.exe', ['/c', 'start', 'cmd', '/k', command], cwd)
  } else if (IS_MAC) {
    // Build the shell line first, then escape it as one AppleScript string
    // literal — interpolating `command` straight into the quoted script broke
    // on any quote it contained.
    const line = `${cwd ? `cd ${JSON.stringify(cwd)} && ` : ''}${command}`
    fire('osascript', [
      '-e',
      `tell application "Terminal" to do script ${JSON.stringify(line)}`,
      '-e',
      'tell application "Terminal" to activate'
    ])
  } else {
    // Debian alternative first, then the most common emulators.
    for (const [term, args] of [
      ['x-terminal-emulator', ['-e', `bash -c '${command}; exec bash'`]],
      ['gnome-terminal', ['--', 'bash', '-c', `${command}; exec bash`]],
      ['konsole', ['-e', `bash -c '${command}; exec bash'`]]
    ] as [string, string[]][]) {
      try {
        fire(term, args, cwd)
        return
      } catch {
        // try the next emulator
      }
    }
  }
}
