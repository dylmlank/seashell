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

test('an Edit offers to be edited before allowing', () => {
  queue({ file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })
  render(<ApprovalModal />)
  expect(screen.getByText(/edit before allowing/i)).toBeTruthy()
})

test('a tool with no editable field is approve-or-deny only', () => {
  queue({ pattern: '**/*.ts' }, 'Glob')
  render(<ApprovalModal />)
  expect(screen.queryByText(/edit before allowing/i)).toBeNull()
})

test('allowing without editing sends no updatedInput', () => {
  queue({ file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })
  render(<ApprovalModal />)
  fireEvent.click(screen.getByText('Allow'))
  expect(invoked[0].arg).not.toHaveProperty('updatedInput')
})

test('the editor toggle swaps the diff for an editor and back', () => {
  queue({ file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })
  render(<ApprovalModal />)
  fireEvent.click(screen.getByText(/edit before allowing/i))
  expect(screen.getByText(/replacement text/i)).toBeTruthy()
  fireEvent.click(screen.getByText(/back to diff/i))
  expect(screen.queryByText(/replacement text/i)).toBeNull()
})

test('the editor says values are unmasked — editing masked text would save the mask', () => {
  queue({ file_path: '/p/.env', old_string: 'A=1', new_string: 'API_TOKEN=secret' })
  render(<ApprovalModal />)
  fireEvent.click(screen.getByText(/edit before allowing/i))
  expect(screen.getByText(/values shown unmasked/i)).toBeTruthy()
})

test('Bash exposes its command as the editable field', () => {
  queue({ command: 'rm -rf build' }, 'Bash')
  render(<ApprovalModal />)
  fireEvent.click(screen.getByText(/edit before allowing/i))
  expect(screen.getByText(/^Command —/i)).toBeTruthy()
})

// The payload builder is where "edited" actually becomes an updatedInput, and
// CodeMirror doesn't drive under happy-dom — so it's tested directly.
const { buildAllowPayload, editableField } = await import(
  '../src/renderer/src/components/ApprovalEditor'
)

const request = (input: Record<string, unknown>, toolName: string): ApprovalRequest =>
  ({ requestId: 'r', tabId: 't', toolUseId: 'u', toolName, input }) as ApprovalRequest

test('an untouched allow carries no updatedInput at all', () => {
  const req = request({ file_path: '/p/a.ts', old_string: 'x', new_string: 'y' }, 'Edit')
  expect(buildAllowPayload(req, null)).toEqual({ behavior: 'allow' })
})

test('an edited Edit sends the rewritten replacement', () => {
  const req = request({ file_path: '/p/a.ts', old_string: 'x', new_string: 'y' }, 'Edit')
  expect(buildAllowPayload(req, 'z')).toEqual({
    behavior: 'allow',
    updatedInput: { file_path: '/p/a.ts', old_string: 'x', new_string: 'z' }
  })
})

test('editing preserves every other field of the tool input', () => {
  const req = request({ file_path: '/p/a.ts', content: 'old', replace_all: true }, 'Write')
  const payload = buildAllowPayload(req, 'new')
  expect(payload.updatedInput).toMatchObject({ file_path: '/p/a.ts', replace_all: true })
  expect(payload.updatedInput?.content).toBe('new')
})

test('an edited Bash sends the rewritten command', () => {
  const req = request({ command: 'rm -rf /' }, 'Bash')
  expect(buildAllowPayload(req, 'rm -rf build').updatedInput).toEqual({ command: 'rm -rf build' })
})

test('a tool with no editable field never gains an updatedInput', () => {
  const req = request({ pattern: '**/*' }, 'Glob')
  expect(buildAllowPayload(req, 'anything')).toEqual({ behavior: 'allow' })
})

test('editableField ignores a tool whose field is absent or not a string', () => {
  expect(editableField(request({}, 'Edit'))).toBeNull()
  expect(editableField(request({ new_string: 42 }, 'Edit'))).toBeNull()
  expect(editableField(request({ new_string: 'y' }, 'Edit'))).toMatchObject({
    field: 'new_string'
  })
})
