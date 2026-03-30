import { useState, useRef } from 'react'
import { X, SquareArrowOutUpRight } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { WidgetType } from '@/types/widget'
import { useDashboardStore } from '@/store/dashboardStore'
import { ClockWidget } from '@/components/widgets/ClockWidget'
import { QuickLinksWidget } from '@/components/widgets/QuickLinksWidget'
import { MottoWidget } from '@/components/widgets/MottoWidget'
import { NotesWidget } from '@/components/widgets/NotesWidget'
import { LinedNotesWidget } from '@/components/widgets/LinedNotesWidget'
import { TodoWidget } from '@/components/widgets/TodoWidget'
import { PomodoroWidget } from '@/components/widgets/PomodoroWidget'
import { GoogleCalendarWidget } from '@/components/widgets/GoogleCalendarWidget'
import { HabitWidget } from '@/components/widgets/HabitWidget'
import { MusicPlayerWidget } from '@/components/widgets/MusicPlayerWidget'

const DEFAULT_TITLES: Record<WidgetType, string> = {
  clock: '时钟',
  'quick-links': '快速链接',
  motto: '格言',
  notes: '便签',
  'lined-notes': '格纸笔记',
  todo: '待办事项',
  pomodoro: '番茄钟',
  'google-calendar': 'Google 日历',
  'music-player': '网易云播放器',
  'habits': '习惯打卡',
}

interface WidgetShellProps {
  type: WidgetType
  widgetId: string
  onRemove: () => void
  showHeader: boolean
}

export function WidgetShell({ type, widgetId, onRemove, showHeader }: WidgetShellProps) {
  const displayTitle = useDashboardStore((s) => s.widgetNames[widgetId] ?? DEFAULT_TITLES[type])
  const renameWidget = useDashboardStore((s) => s.renameWidget)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [popoutOpen, setPopoutOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setDraft(displayTitle)
    setEditing(true)
    setTimeout(() => { inputRef.current?.select() }, 0)
  }

  function commitEdit() {
    const trimmed = draft.trim()
    if (trimmed) renameWidget(widgetId, trimmed)
    setEditing(false)
  }

  function renderContent() {
    switch (type) {
      case 'clock': return <ClockWidget />
      case 'quick-links': return <QuickLinksWidget />
      case 'motto': return <MottoWidget />
      case 'notes': return <NotesWidget />
      case 'lined-notes': return <LinedNotesWidget widgetId={widgetId} />
      case 'todo': return <TodoWidget widgetId={widgetId} />
      case 'pomodoro': return <PomodoroWidget />
      case 'google-calendar': return <GoogleCalendarWidget widgetId={widgetId} />
      case 'music-player': return <MusicPlayerWidget widgetId={widgetId} />
      case 'habits': return <HabitWidget widgetId={widgetId} />
      default: return null
    }
  }

  return (
    <div className={`widget-card h-full flex flex-col${type === 'clock' ? ' widget-transparent' : ''}`}>
      {showHeader && (
        <div
          className="drag-handle flex items-center px-4 py-2.5 cursor-grab active:cursor-grabbing select-none group/header"
          style={{
            borderBottom: '1px solid var(--border)',
            // Clock card is transparent, so give the header its own background
            ...(type === 'clock' ? {
              background: 'var(--bg-card)',
              borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
            } : {}),
          }}
        >
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                if (e.key === 'Escape') setEditing(false)
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="flex-1 outline-none bg-transparent"
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--text)',
                border: 'none',
                borderBottom: '1px solid var(--primary-light)',
              }}
            />
          ) : (
            <span
              className="flex-1"
              onDoubleClick={startEdit}
              title="双击重命名"
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                cursor: 'default',
              }}
            >
              {displayTitle}
            </span>
          )}

          {type === 'todo' && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (popoutOpen) {
                  invoke('close_todo_popout', { widgetId })
                  setPopoutOpen(false)
                } else {
                  invoke('open_todo_popout', { widgetId, title: displayTitle })
                  setPopoutOpen(true)
                }
              }}
              className="opacity-0 group-hover/header:opacity-100 p-1 rounded-lg transition-all"
              style={{ color: popoutOpen ? 'var(--primary-dark)' : 'var(--text-muted)' }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--bg-muted)'
                e.currentTarget.style.color = 'var(--primary-dark)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = ''
                e.currentTarget.style.color = popoutOpen ? 'var(--primary-dark)' : 'var(--text-muted)'
              }}
              title="弹出窗口"
            >
              <SquareArrowOutUpRight size={12} />
            </button>
          )}

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
            title="移除组件"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {!showHeader && (
        <div className="drag-handle absolute inset-0 z-0 cursor-grab active:cursor-grabbing" />
      )}

      <div className="widget-content flex-1 overflow-hidden p-3">
        {renderContent()}
      </div>

    </div>
  )
}
