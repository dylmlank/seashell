/// <reference types="bun-types" />
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ApprovalRequest } from '../src/shared/types'

// The DOM is registered here rather than through a bunfig preload: preloads
// are global, and happy-dom's WebSocket replaces the real one that
// sidecar.test.ts needs to reach an actual server. Everything that touches
// the DOM is therefore imported after this line, dynamically.
GlobalRegistrator.register()

/** Calls the component made through the bridge, newest last. */
let invoked: { channel: string; arg: unknown }[] = []

// The approvals store touches window.api at import time, so the bridge has to
// exist before the component module is pulled in.
window.api = {
  invoke: (channel: string, arg: unknown) => {
    invoked.push({ channel, arg })
    return Promise.resolve(null)
  },
  on: () => () => {},
  pathForFile: () => '',
  pickFiles: () => Promise.resolve(null),
  saveTextFile: () => Promise.resolve(null)
} as unknown as typeof window.api

const { cleanup, fireEvent, render, screen } = await import('@testing-library/react')
const { ApprovalModal } = await import('../src/renderer/src/components/ApprovalModal')
const { useApprovals } = await import('../src/renderer/src/stores/approvals')

function queue(input: Record<string, unknown>, toolName = 'Edit'): ApprovalRequest {
  const req = {
    requestId: 'req-1',
    tabId: 'tab-1',
    toolUseId: 'tu-1',
    toolName,
    input
  } as ApprovalRequest
  useApprovals.setState({ queue: [req] })
  return req
}

beforeEach(() => {
  invoked = []
  useApprovals.setState({ queue: [] })
})
afterEach(cleanup)

test('renders nothing when no approval is pending', () => {
  const { container } = render(<ApprovalModal />)
  expect(container.textContent).toBe('')
})

test('an ordinary edit shows no reveal toggle', () => {
  queue({ file_path: '/p/math.ts', old_string: 'a + b', new_string: 'a - b' })
  render(<ApprovalModal />)
  expect(screen.queryByText(/reveal/i)).toBeNull()
})

// react-diff-viewer-continued renders its rows through a virtualiser that
// stays empty under happy-dom, so diff BODIES can't be asserted on here.
// Whether a given string masks correctly is redact.test.ts's job; these check
// what this component actually decides — when to offer the toggle, and what
// it puts in the parts it renders itself.

test('a .env edit offers the reveal toggle', () => {
  queue({
    file_path: '/p/.env',
    old_string: 'API_TOKEN=old-secret-value',
    new_string: 'API_TOKEN=new-secret-value'
  })
  render(<ApprovalModal />)
  expect(screen.getByText(/reveal/i)).toBeTruthy()
})

test('the toggle flips to a hide affordance once revealed', () => {
  queue({
    file_path: '/p/.env',
    old_string: 'API_TOKEN=old-secret-value',
    new_string: 'API_TOKEN=new-secret-value'
  })
  render(<ApprovalModal />)
  fireEvent.click(screen.getByText(/reveal/i))
  expect(screen.getByText(/hide secret values/i)).toBeTruthy()
  expect(screen.queryByText(/— reveal/i)).toBeNull()
})

test('a Bash command carrying a token is masked in the body', () => {
  queue({ command: 'curl -H "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123"' }, 'Bash')
  const { container } = render(<ApprovalModal />)
  expect(container.textContent).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123')
  expect(container.textContent).toContain('curl')
})

test('the headline masks a token too — it sits above the reveal toggle', () => {
  // Regression: the body was masked while the title rendered the raw command.
  queue({ command: 'curl -H "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123"' }, 'Bash')
  render(<ApprovalModal />)
  const heading = screen.getByText(/Claude wants to use Bash/i)
  expect(heading.textContent).not.toContain('ghp_abcdef')
  expect(heading.textContent).toContain('••••')
})

test('Allow answers the request it was showing', () => {
  queue({ file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })
  render(<ApprovalModal />)
  fireEvent.click(screen.getByText('Allow'))
  expect(invoked).toHaveLength(1)
  expect(invoked[0].channel).toBe('approval:respond')
  expect(invoked[0].arg).toMatchObject({ requestId: 'req-1', behavior: 'allow' })
})

test('Deny carries the reason the user typed', () => {
  queue({ file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })
  render(<ApprovalModal />)
  fireEvent.change(screen.getByPlaceholderText(/why, if denying/i), {
    target: { value: 'wrong file' }
  })
  fireEvent.click(screen.getByText('Deny'))
  expect(invoked[0].arg).toMatchObject({ behavior: 'deny', message: 'wrong file' })
})

test('denying without a reason still sends one', () => {
  queue({ file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })
  render(<ApprovalModal />)
  fireEvent.click(screen.getByText('Deny'))
  expect(invoked[0].arg).toMatchObject({ behavior: 'deny' })
  expect((invoked[0].arg as { message: string }).message.length).toBeGreaterThan(0)
})

test('answering a queued request removes it from the queue', () => {
  queue({ file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })
  render(<ApprovalModal />)
  fireEvent.click(screen.getByText('Allow'))
  expect(useApprovals.getState().queue).toHaveLength(0)
})
