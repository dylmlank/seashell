import type { AppSettings } from '@shared/types'

/** Max-width class for the chat transcript + composer column. Lets the
 *  conversation fill more of the window instead of a narrow center strip. */
export function chatWidthClass(width: AppSettings['chatWidth']): string {
  switch (width) {
    case 'full':
      return 'max-w-none'
    case 'wide':
      return 'max-w-5xl'
    case 'comfortable':
    default:
      return 'max-w-3xl'
  }
}
