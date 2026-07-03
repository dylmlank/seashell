import { memo } from 'react'
import { CircleDashed, CircleCheck, Loader2, ListTodo } from 'lucide-react'
import type { TodoItem } from '@shared/types'

export const PlanCard = memo(function PlanCard({
  todos
}: {
  todos: TodoItem[]
}): React.JSX.Element {
  const done = todos.filter((t) => t.status === 'completed').length
  return (
    <div className="my-1 max-w-xl rounded-xl border border-border bg-surface px-4 py-3 anim-in">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-dim">
        <ListTodo size={14} className="text-accent" />
        Plan
        <span className="ml-auto tabular-nums">
          {done}/{todos.length}
        </span>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${todos.length ? (done / todos.length) * 100 : 0}%` }}
        />
      </div>
      <ul className="space-y-1.5">
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {t.status === 'completed' ? (
              <CircleCheck size={15} className="mt-0.5 shrink-0 text-green-500" />
            ) : t.status === 'in_progress' ? (
              <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-accent" />
            ) : (
              <CircleDashed size={15} className="mt-0.5 shrink-0 text-text-dim" />
            )}
            <span
              className={
                t.status === 'completed'
                  ? 'text-text-dim line-through decoration-border'
                  : t.status === 'in_progress'
                    ? 'text-text'
                    : 'text-text-dim'
              }
            >
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
})
