import { X } from 'lucide-react'
import type { WidgetType } from '@/types/widget'
import { ClockWidget } from '@/components/widgets/ClockWidget'
import { WeatherWidget } from '@/components/widgets/WeatherWidget'
import { QuickLinksWidget } from '@/components/widgets/QuickLinksWidget'
import { NotesWidget } from '@/components/widgets/NotesWidget'
import { TodoWidget } from '@/components/widgets/TodoWidget'
import { PomodoroWidget } from '@/components/widgets/PomodoroWidget'
import { AIChatWidget } from '@/components/widgets/AIChatWidget'

const WIDGET_TITLES: Record<WidgetType, string> = {
  clock: 'Clock',
  weather: 'Weather',
  'quick-links': 'Quick Links',
  notes: 'Notes',
  todo: 'Todo',
  pomodoro: 'Pomodoro',
  'ai-chat': 'AI Assistant',
}

const WIDGET_MAP: Record<WidgetType, React.ComponentType> = {
  clock: ClockWidget,
  weather: WeatherWidget,
  'quick-links': QuickLinksWidget,
  notes: NotesWidget,
  todo: TodoWidget,
  pomodoro: PomodoroWidget,
  'ai-chat': AIChatWidget,
}

interface WidgetShellProps {
  type: WidgetType
  onRemove: () => void
}

export function WidgetShell({ type, onRemove }: WidgetShellProps) {
  const Component = WIDGET_MAP[type]

  return (
    <div className="widget-card h-full flex flex-col">
      {/* Drag handle */}
      <div
        className="drag-handle flex items-center px-4 py-2.5 cursor-grab active:cursor-grabbing select-none group/header"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span
          className="flex-1 text-xs font-medium tracking-wide"
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: '12px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          {WIDGET_TITLES[type]}
        </span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="opacity-0 group-hover/header:opacity-100 p-1 rounded-lg transition-all"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--bg-muted)'
            e.currentTarget.style.color = 'var(--text)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = ''
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
          title="Remove widget"
        >
          <X size={12} />
        </button>
      </div>

      <div className="widget-content flex-1 overflow-hidden p-3">
        <Component />
      </div>
    </div>
  )
}
