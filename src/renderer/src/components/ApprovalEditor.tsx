import { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { langs } from '@uiw/codemirror-extensions-langs'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { Eye, PencilLine } from 'lucide-react'
import type { Extension } from '@codemirror/state'
import type { ApprovalRequest } from '@shared/types'

/** Which field of a tool's input is the thing a user would want to change,
 *  and what it should be edited as. Anything not listed here is approve/deny
 *  only — rewriting a tool input we don't understand is worse than refusing. */
const EDITABLE: Record<string, { field: string; label: string; lang?: string }> = {
  Edit: { field: 'new_string', label: 'Replacement text' },
  Write: { field: 'content', label: 'File contents' },
  NotebookEdit: { field: 'new_source', label: 'Cell source' },
  Bash: { field: 'command', label: 'Command', lang: 'shell' }
}

export function editableField(req: ApprovalRequest): { field: string; label: string } | null {
  const spec = EDITABLE[req.toolName]
  if (!spec) return null
  return typeof req.input[spec.field] === 'string' ? spec : null
}

/** What an "Allow" click sends.
 *
 *  An untouched approval must echo nothing: the sidecar fills `updatedInput`
 *  with the original when it's absent, and sending a rebuilt copy risks
 *  differing from what Claude asked for in some field we didn't think about.
 *  An edited one carries the user's version, which is what turns "nearly
 *  right, but" into a small edit instead of a denial and another whole turn.
 */
export function buildAllowPayload(
  req: ApprovalRequest,
  edited: string | null
): { behavior: 'allow'; updatedInput?: Record<string, unknown> } {
  const editable = editableField(req)
  if (edited === null || !editable) return { behavior: 'allow' }
  return { behavior: 'allow', updatedInput: { ...req.input, [editable.field]: edited } }
}

function langFor(req: ApprovalRequest): Extension[] {
  const spec = EDITABLE[req.toolName]
  const ext =
    spec?.lang ??
    String(req.input.file_path ?? '')
      .split('.')
      .pop()
      ?.toLowerCase() ??
    ''
  const load = (langs as Record<string, (() => Extension) | undefined>)[ext]
  return load ? [load()] : []
}

/** Edit what Claude proposed before allowing it.
 *
 *  The permission callback already accepts an `updatedInput`, so an approval
 *  doesn't have to be all-or-nothing — the answer to "nearly right, but"
 *  becomes a small edit instead of a denial and another full turn.
 *
 *  Secret masking is deliberately off in here. Editing masked text would save
 *  the mask over the real value, so the editor always shows what is really
 *  there and says so.
 */
export function ApprovalEditor({
  req,
  field,
  label,
  onChange
}: {
  req: ApprovalRequest
  field: string
  label: string
  onChange: (value: string | null) => void
}): React.JSX.Element {
  const original = String(req.input[field] ?? '')
  const [value, setValue] = useState(original)

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs text-text-dim">
        <PencilLine size={12} className="shrink-0 text-accent" />
        <span>{label} — your edits are what gets applied.</span>
        <span className="ml-auto flex items-center gap-1">
          <Eye size={11} /> values shown unmasked
        </span>
      </div>
      <div className="max-h-80 overflow-auto rounded-lg border border-accent/30">
        <CodeMirror
          value={value}
          theme={vscodeDark}
          extensions={langFor(req)}
          onChange={(next) => {
            setValue(next)
            onChange(next === original ? null : next)
          }}
          basicSetup={{ foldGutter: false, highlightActiveLine: true }}
          style={{ fontSize: '12px' }}
        />
      </div>
    </div>
  )
}
