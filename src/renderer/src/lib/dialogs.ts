// Tauri's webview stubs window.confirm/alert to no-ops — use the native
// dialog plugin instead. Note these are async, unlike the DOM ones.
import { ask, message } from '@tauri-apps/plugin-dialog'

export function confirmDialog(text: string): Promise<boolean> {
  return ask(text, { title: 'Seashell', kind: 'warning' })
}

export async function alertDialog(text: string): Promise<void> {
  await message(text, { title: 'Seashell' })
}
