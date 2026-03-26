import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
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
  className?: string
}

export function WidgetShell({ type, onRemove, className }: WidgetShellProps) {
  const Component = WIDGET_MAP[type]

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl overflow-hidden h-full',
        'bg-[var(--bg-widget)] border border-[var(--border-color)]',
        'backdrop-blur-sm shadow-lg',
        className
      )}
    >
      {/* Drag handle + title bar */}
      <div className="drag-handle flex items-center px-4 py-2.5 border-b border-white/5 cursor-grab active:cursor-grabbing select-none group/header">
        <span className="text-white/40 text-xs font-medium tracking-wide flex-1">
          {WIDGET_TITLES[type]}
        </span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          className="opacity-0 group-hover/header:opacity-100 p-1 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/10 transition-all"
          title="Remove widget"
        >
          <X size={12} />
        </button>
      </div>

      {/* Widget content */}
      <div className="flex-1 overflow-hidden p-3">
        <Component />
      </div>
    </div>
  )
}
