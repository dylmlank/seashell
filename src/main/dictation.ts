import { spawn } from 'child_process'

// Windows dictation (Win+H) types into whichever textbox has focus — the
// renderer focuses the composer first, then asks us to press the shortcut.
// keybd_event via P/Invoke because Node can't synthesize the Win key itself.
const SCRIPT = [
  "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class K{[DllImport(\"user32.dll\")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);}'",
  '[K]::keybd_event(0x5B,0,0,[UIntPtr]::Zero)', // Win down
  '[K]::keybd_event(0x48,0,0,[UIntPtr]::Zero)', // H down
  '[K]::keybd_event(0x48,0,2,[UIntPtr]::Zero)', // H up
  '[K]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)' // Win up
].join('; ')

export function startDictation(): { ok: true } | { error: string } {
  if (process.platform !== 'win32') return { error: 'Dictation is Windows-only for now' }
  try {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
      stdio: 'ignore',
      windowsHide: true
    }).unref()
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
