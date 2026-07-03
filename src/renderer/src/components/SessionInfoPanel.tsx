import { useEffect, useState } from 'react'
import { Blocks, X, Wrench, Sparkles, Puzzle, Bot, SlashSquare, MonitorDown } from 'lucide-react'
import type { DesktopConnector } from '@shared/types'
import type { TabState } from '../stores/sessions'

function Section({
  icon,
  title,
  count,
  children
}: {
  icon: React.ReactNode
  title: string
  count: number
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="py-3">
      <div className="flex items-center gap-2 pb-1.5 text-sm font-medium">
        {icon}
        {title}
        <span className="text-xs text-text-dim">({count})</span>
      </div>
      {children}
    </div>
  )
}

function ChipList({ items }: { items: string[] }): React.JSX.Element {
  if (items.length === 0) return <p className="text-xs text-text-dim">none</p>
  return (
    <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
      {items.map((s) => (
        <span key={s} className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-dim">
          {s}
        </span>
      ))}
    </div>
  )
}

/** What Claude can use in this session: MCP servers, plugins, skills, agents, tools. */
export function SessionInfoPanel({
  tab,
  onClose
}: {
  tab: TabState
  onClose: () => void
}): React.JSX.Element {
  const [desktop, setDesktop] = useState<DesktopConnector[]>([])
  useEffect(() => {
    void window.api.invoke('providers:desktopMcp').then(setDesktop)
  }, [])

  // Live statuses arrive with the session's init message (after the first
  // message is sent) — until then, show what will be loaded.
  const liveStatus = new Map(tab.mcpServers.map((s) => [s.name.toLowerCase(), s.status]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop-in flex max-h-full w-full max-w-xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <Blocks size={18} className="text-accent" />
          <h2 className="font-semibold">What Claude can use here</h2>
          <button onClick={onClose} className="ml-auto rounded p-1 hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>

        <div className="divide-y divide-border/60 overflow-y-auto px-6 pb-4">
          <Section
            icon={<MonitorDown size={14} className="text-accent" />}
            title="From Claude Desktop"
            count={desktop.filter((d) => d.imported).length}
          >
            {desktop.length === 0 ? (
              <p className="text-xs text-text-dim">no Claude Desktop connectors found</p>
            ) : (
              <div className="space-y-1">
                {desktop.map((d) => {
                  const status = liveStatus.get(d.name.toLowerCase())
                  return (
                    <div key={`${d.source}-${d.name}`} className="flex items-center gap-2 text-sm">
                      <span
                        className={
                          'h-1.5 w-1.5 shrink-0 rounded-full ' +
                          (status === 'connected'
                            ? 'bg-green-500'
                            : d.imported
                              ? 'bg-accent/70'
                              : 'bg-border')
                        }
                      />
                      <span className="font-mono text-xs">{d.name}</span>
                      <span className="text-xs text-text-dim">
                        {status ?? (d.imported ? 'loads with the first message' : (d.note ?? 'not imported'))}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          <Section
            icon={<Puzzle size={14} className="text-accent" />}
            title="MCP servers (live)"
            count={tab.mcpServers.length}
          >
            {tab.mcpServers.length === 0 ? (
              <p className="text-xs text-text-dim">
                reported once the session starts working — send a message first
              </p>
            ) : (
              <div className="space-y-1">
                {tab.mcpServers.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 text-sm">
                    <span
                      className={
                        'h-1.5 w-1.5 rounded-full ' +
                        (s.status === 'connected' ? 'bg-green-500' : 'bg-yellow-500')
                      }
                    />
                    <span className="font-mono text-xs">{s.name}</span>
                    <span className="text-xs text-text-dim">{s.status}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            icon={<Sparkles size={14} className="text-accent" />}
            title="Skills"
            count={tab.skills.length}
          >
            <ChipList items={tab.skills} />
          </Section>

          <Section
            icon={<Puzzle size={14} className="text-accent" />}
            title="Plugins"
            count={tab.plugins.length}
          >
            <ChipList items={tab.plugins} />
          </Section>

          <Section
            icon={<Bot size={14} className="text-accent" />}
            title="Agents"
            count={tab.agents.length}
          >
            <ChipList items={tab.agents} />
          </Section>

          <Section
            icon={<SlashSquare size={14} className="text-accent" />}
            title="Slash commands"
            count={tab.slashCommands.length}
          >
            <ChipList items={tab.slashCommands.map((c) => `/${c}`)} />
          </Section>

          <Section
            icon={<Wrench size={14} className="text-accent" />}
            title="Tools"
            count={tab.tools.length}
          >
            <ChipList items={tab.tools} />
          </Section>
        </div>
      </div>
    </div>
  )
}
