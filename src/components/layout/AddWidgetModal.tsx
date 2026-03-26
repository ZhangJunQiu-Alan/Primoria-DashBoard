import { useState } from 'react'
import { X, Search, Clock, Cloud, Link2, FileText, CheckSquare, Timer, Bot } from 'lucide-react'
import { useDashboardStore } from '@/store/dashboardStore'
import type { WidgetType } from '@/types/widget'

interface WidgetDef {
  type: WidgetType
  name: string
  description: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  category: string
}

const WIDGET_DEFS: WidgetDef[] = [
  { type: 'clock', name: 'Clock', description: 'Current time and date', icon: Clock, category: 'Information' },
  { type: 'weather', name: 'Weather', description: 'Current weather conditions', icon: Cloud, category: 'Information' },
  { type: 'quick-links', name: 'Quick Links', description: 'Your favorite bookmarks at a glance', icon: Link2, category: 'Productivity' },
  { type: 'notes', name: 'Notes', description: 'Scratch pad for quick notes', icon: FileText, category: 'Productivity' },
  { type: 'todo', name: 'Todo', description: 'Track your tasks', icon: CheckSquare, category: 'Productivity' },
  { type: 'pomodoro', name: 'Pomodoro', description: 'Focus timer with breaks', icon: Timer, category: 'Productivity' },
  { type: 'ai-chat', name: 'AI Assistant', description: 'Chat with an AI assistant', icon: Bot, category: 'AI' },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function AddWidgetModal({ open, onClose }: Props) {
  const [search, setSearch] = useState('')
  const addWidget = useDashboardStore((s) => s.addWidget)

  if (!open) return null

  const filtered = WIDGET_DEFS.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.description.toLowerCase().includes(search.toLowerCase())
  )

  const categories = [...new Set(filtered.map((w) => w.category))]

  function handleAdd(type: WidgetType) {
    addWidget(type)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl max-h-[80vh] bg-[#1a1a24] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-white font-semibold">Add Widget</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 transition-all">
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-white/5">
          <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/10 focus-within:border-white/30 transition-colors">
            <Search size={14} className="text-white/30 flex-shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search widgets..."
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/20"
            />
          </div>
        </div>

        {/* Widget list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6">
          {categories.map((category) => (
            <div key={category}>
              <h3 className="text-white/40 text-xs font-medium uppercase tracking-wider mb-3">{category}</h3>
              <div className="grid grid-cols-2 gap-2">
                {filtered
                  .filter((w) => w.category === category)
                  .map((w) => {
                    const Icon = w.icon
                    return (
                      <button
                        key={w.type}
                        onClick={() => handleAdd(w.type)}
                        className="flex items-center gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/8 border border-white/5 hover:border-white/15 transition-all text-left group"
                      >
                        <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/20 flex items-center justify-center flex-shrink-0 group-hover:bg-[var(--accent)]/30 transition-colors">
                          <Icon size={18} className="text-[var(--accent-hover)]" />
                        </div>
                        <div>
                          <p className="text-white/80 text-sm font-medium">{w.name}</p>
                          <p className="text-white/30 text-xs leading-tight">{w.description}</p>
                        </div>
                      </button>
                    )
                  })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-white/20 text-sm text-center py-8">No widgets found</p>
          )}
        </div>
      </div>
    </div>
  )
}
