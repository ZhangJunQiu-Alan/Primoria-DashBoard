import { useState } from 'react'
import { X, Search, Clock, Cloud, Link2, FileText, CheckSquare, Timer, Bot } from 'lucide-react'
import { useDashboardStore } from '@/store/dashboardStore'
import type { WidgetType } from '@/types/widget'

interface WidgetDef {
  type: WidgetType
  name: string
  description: string
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
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
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(61,52,42,0.3)', backdropFilter: 'blur(6px)' }}
      />
      <div
        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: '0 8px 40px rgba(90,70,50,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: '20px',
              fontWeight: 500,
              color: 'var(--text)',
            }}
          >
            Add Widget
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-all"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-muted)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl transition-colors"
            style={{
              background: 'var(--bg-muted)',
              border: '1.5px solid var(--border)',
            }}
          >
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search widgets..."
              className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: 'var(--text)', fontFamily: "'DM Sans', sans-serif" }}
            />
          </div>
        </div>

        {/* Widget list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6">
          {categories.map((category) => (
            <div key={category}>
              <h3
                className="mb-3"
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)',
                  paddingBottom: '6px',
                }}
              >
                {category}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {filtered
                  .filter((w) => w.category === category)
                  .map((w) => {
                    const Icon = w.icon
                    return (
                      <button
                        key={w.type}
                        onClick={() => handleAdd(w.type)}
                        className="flex items-center gap-3 p-3 rounded-xl text-left transition-all group"
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = '#EFF6F0'
                          e.currentTarget.style.borderColor = 'var(--primary-light)'
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'var(--bg-card)'
                          e.currentTarget.style.borderColor = 'var(--border)'
                        }}
                      >
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
                          style={{ background: '#EAF4EB' }}
                        >
                          <Icon size={18} style={{ color: 'var(--primary-dark)' }} />
                        </div>
                        <div>
                          <p
                            className="font-medium"
                            style={{ fontSize: '13px', color: 'var(--text)' }}
                          >
                            {w.name}
                          </p>
                          <p
                            className="leading-tight"
                            style={{ fontSize: '11px', color: 'var(--text-muted)' }}
                          >
                            {w.description}
                          </p>
                        </div>
                      </button>
                    )
                  })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
              No widgets found
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
