import { useEffect, useMemo, useRef, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Trash2,
} from 'lucide-react'
import { useTodoDndState } from '@/components/layout/TodoDndProvider'
import { useCurrentDayKey } from '@/hooks/useCurrentDayKey'
import { addDaysToDateKey, parseLocalDateKey } from '@/lib/date'
import { useWidgetDataStore, type ScheduledTask } from '@/store/widgetDataStore'

const MS_PER_DAY = 86400000
const COLUMN_WIDTH = 132
const COLUMN_GAP = 10
const SCHEDULE_DAYS = 5
const EMPTY_TASKS: ScheduledTask[] = []

function addDays(base: string | Date, amount: number) {
  return addDaysToDateKey(base, amount)
}

function diffDays(dateStr: string, base: string) {
  return Math.round((parseLocalDateKey(dateStr).getTime() - parseLocalDateKey(base).getTime()) / MS_PER_DAY)
}

function isDateInRange(dateStr: string, rangeStart: string, rangeEnd: string) {
  return dateStr >= rangeStart && dateStr <= rangeEnd
}

function getPageStart(today: string) {
  return addDays(today, -2)
}

function getThisFriday(today: string) {
  const day = parseLocalDateKey(today).getDay()
  const diff = day === 0 ? 5 : day <= 5 ? 5 - day : 6
  return diff === 0 ? addDays(today, 7) : addDays(today, diff)
}

function getNextMonday(today: string) {
  const day = parseLocalDateKey(today).getDay()
  return addDays(today, day === 0 ? 1 : 8 - day)
}

function formatShortDate(dateStr: string) {
  const date = parseLocalDateKey(dateStr)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function getColumnHeading(dateStr: string, today: string, compact: boolean) {
  const offset = diffDays(dateStr, today)
  const date = parseLocalDateKey(dateStr)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  if (offset === 0) return { title: '今天', subtitle: formatShortDate(dateStr) }
  if (offset === 1) return { title: '明天', subtitle: formatShortDate(dateStr) }
  if (offset === 2) return { title: '后天', subtitle: formatShortDate(dateStr) }

  if (compact) {
    return {
      title: weekdays[date.getDay()],
      subtitle: formatShortDate(dateStr),
    }
  }

  return {
    title: weekdays[date.getDay()],
    subtitle: `${date.getMonth() + 1}月${date.getDate()}日`,
  }
}

function getDelayCount(task: ScheduledTask, today: string) {
  if (task.completed || !task.dueDate || task.dueDate >= today) return 0
  return diffDays(today, task.dueDate)
}

function getVisibleDateForTask(
  task: ScheduledTask,
  today: string,
  currentPageStart: string,
  viewedPageStart: string,
  viewedPageEnd: string
) {
  if (task.completed) {
    const completedAnchor = task.completedAt ?? task.dueDate
    if (!completedAnchor) return null
    return isDateInRange(completedAnchor, viewedPageStart, viewedPageEnd) ? completedAnchor : null
  }

  if (!task.dueDate) {
    return isDateInRange(today, viewedPageStart, viewedPageEnd) ? today : null
  }

  if (task.dueDate < currentPageStart) {
    return isDateInRange(today, viewedPageStart, viewedPageEnd) ? today : null
  }

  return isDateInRange(task.dueDate, viewedPageStart, viewedPageEnd) ? task.dueDate : null
}

function compareTasksForColumn(a: ScheduledTask, b: ScheduledTask, columnDate: string, today: string) {
  if (columnDate === today) {
    const aDelay = getDelayCount(a, today)
    const bDelay = getDelayCount(b, today)

    if (aDelay !== bDelay) return bDelay - aDelay

    if (aDelay > 0 && a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate)
    }

    const aHasDueDate = a.dueDate ? 1 : 0
    const bHasDueDate = b.dueDate ? 1 : 0
    if (aHasDueDate !== bHasDueDate) return bHasDueDate - aHasDueDate
  }

  return 0
}

function orderTasks(tasks: ScheduledTask[], columnDate: string, today: string) {
  const active = tasks.filter((task) => !task.completed)
  const completed = tasks.filter((task) => task.completed)

  active.sort((a, b) => compareTasksForColumn(a, b, columnDate, today))
  completed.sort((a, b) => compareTasksForColumn(a, b, columnDate, today))

  return [...active, ...completed]
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })

    observer.observe(element)
    setWidth(element.getBoundingClientRect().width)

    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

interface DatePickerProps {
  value: string | null
  anchorEl: HTMLElement | null
  today: string
  onSelect: (date: string | null) => void
  onClose: () => void
}

function DatePicker({ value, anchorEl, today, onSelect, onClose }: DatePickerProps) {
  const [viewYear, setViewYear] = useState(() => {
    const date = value ? parseLocalDateKey(value) : parseLocalDateKey(today)
    return date.getFullYear()
  })
  const [viewMonth, setViewMonth] = useState(() => {
    const date = value ? parseLocalDateKey(value) : parseLocalDateKey(today)
    return date.getMonth()
  })
  const ref = useRef<HTMLDivElement>(null)
  const pos = useMemo(() => {
    if (!anchorEl) return { top: 8, left: 8 }

    const rect = anchorEl.getBoundingClientRect()
    const pickerWidth = 224
    const pickerHeight = 300
    let top = rect.bottom + 6
    let left = rect.left

    if (top + pickerHeight > window.innerHeight - 12) top = rect.top - pickerHeight - 6
    if (left + pickerWidth > window.innerWidth - 12) left = rect.right - pickerWidth

    return { top: Math.max(8, top), left: Math.max(8, left) }
  }, [anchorEl])

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(event.target as Node) &&
        anchorEl &&
        !anchorEl.contains(event.target as Node)
      ) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [anchorEl, onClose])

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const startOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7
  const quickDates = [
    { label: '今天', value: today },
    { label: '明天', value: addDays(today, 1) },
    { label: '本周五', value: getThisFriday(today) },
    { label: '下周一', value: getNextMonday(today) },
  ]
  const monthNames = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

  return (
    <div
      ref={ref}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        width: 224,
        padding: '12px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        boxShadow: '0 8px 32px var(--shadow-md)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
        {quickDates.map((quickDate) => (
          <button
            key={quickDate.label}
            onClick={() => {
              onSelect(quickDate.value)
              onClose()
            }}
            style={{
              padding: '2px 9px',
              borderRadius: '999px',
              cursor: 'pointer',
              fontSize: '11px',
              border: '1px solid',
              borderColor: value === quickDate.value ? 'var(--primary-light)' : 'var(--border)',
              background: value === quickDate.value ? 'var(--bg-hover)' : 'var(--bg-muted)',
              color: value === quickDate.value ? 'var(--primary-dark)' : 'var(--text-sub)',
            }}
          >
            {quickDate.label}
          </button>
        ))}
        <button
          onClick={() => {
            onSelect(null)
            onClose()
          }}
          style={{
            padding: '2px 9px',
            borderRadius: '999px',
            cursor: 'pointer',
            fontSize: '11px',
            border: '1px solid var(--border)',
            background: 'var(--bg-muted)',
            color: 'var(--text-muted)',
          }}
        >
          无日期
        </button>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', marginBottom: '10px' }} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <button
          onClick={() => {
            if (viewMonth === 0) {
              setViewYear((year) => year - 1)
              setViewMonth(11)
            } else {
              setViewMonth((month) => month - 1)
            }
          }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-sub)',
            padding: '2px',
          }}
        >
          <ChevronLeft size={14} />
        </button>

        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text)' }}>
          {viewYear}年 {monthNames[viewMonth]}月
        </span>

        <button
          onClick={() => {
            if (viewMonth === 11) {
              setViewYear((year) => year + 1)
              setViewMonth(0)
            } else {
              setViewMonth((month) => month + 1)
            }
          }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-sub)',
            padding: '2px',
          }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          textAlign: 'center',
          marginBottom: '2px',
        }}
      >
        {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
          <div key={day} style={{ fontSize: '10px', color: 'var(--text-muted)', padding: '1px 0' }}>
            {day}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px' }}>
        {Array.from({ length: startOffset }).map((_, index) => (
          <div key={`empty-${index}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, index) => {
          const day = index + 1
          const dateValue = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isSelected = dateValue === value
          const isToday = dateValue === today
          const isPast = dateValue < today

          return (
            <button
              key={day}
              onClick={() => {
                onSelect(dateValue)
                onClose()
              }}
              style={{
                width: '100%',
                aspectRatio: '1',
                borderRadius: '5px',
                border: 'none',
                cursor: 'pointer',
                background: isSelected ? 'var(--primary)' : isToday ? 'var(--bg-hover)' : 'transparent',
                color: isSelected ? 'white' : isPast ? 'var(--text-muted)' : 'var(--text)',
                fontWeight: isToday && !isSelected ? 600 : 400,
                fontSize: '11px',
              }}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface TaskCardProps {
  task: ScheduledTask
  widgetId: string
  today: string
  isEditing: boolean
  editDraft: string
  onToggle: () => void
  onStartEdit: () => void
  onEditChange: (value: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
  onDelete: () => void
}

function TaskCard({
  task,
  widgetId,
  today,
  isEditing,
  editDraft,
  onToggle,
  onStartEdit,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onDelete,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `scheduled:${widgetId}:${task.id}`,
    disabled: isEditing,
    data: { widgetId, taskId: task.id, type: 'scheduled-task' },
  })
  const canDrag = !isEditing

  const delayCount = getDelayCount(task, today)
  const palette = task.completed
    ? {
        background: 'rgba(247,243,236,0.78)',
        text: 'var(--text)',
        action: 'var(--text-muted)',
      }
    : delayCount >= 3
      ? {
          background: '#201616',
          text: '#FEFAF5',
          action: 'rgba(254,250,245,0.76)',
        }
      : delayCount === 2
        ? {
            background: 'rgba(124,29,29,0.16)',
            text: '#7C1D1D',
            action: '#9A4D4D',
          }
        : delayCount === 1
          ? {
              background: 'rgba(196,122,122,0.12)',
              text: '#AF5656',
              action: '#C47A7A',
            }
          : {
              background: 'rgba(254,250,245,0.96)',
              text: 'var(--text)',
              action: 'var(--text-muted)',
            }

  return (
    <div
      ref={setNodeRef}
      className="group/task"
      style={{
        transform: CSS.Transform.toString(transform),
        transition: 'transform 150ms ease, opacity 150ms ease',
        opacity: isDragging ? 0.35 : task.completed ? 0.56 : 1,
        padding: '8px 9px',
        borderRadius: '14px',
        border: 'none',
        background: palette.background,
        boxShadow: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '7px' }}>
        {canDrag && (
          <button
            {...attributes}
            {...listeners}
            className="opacity-0 transition-opacity group-hover/task:opacity-100"
            style={{
              color: palette.action,
              touchAction: 'none',
              cursor: 'grab',
              background: 'none',
              border: 'none',
              padding: 0,
              marginTop: '1px',
              flexShrink: 0,
            }}
            tabIndex={-1}
            title="拖动到其他日期"
          >
            <GripVertical size={12} />
          </button>
        )}

        <button
          onClick={onToggle}
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            flexShrink: 0,
            border: `1.5px solid ${task.completed ? 'var(--primary)' : 'var(--border)'}`,
            background: task.completed ? 'var(--primary)' : 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: '1px',
          }}
        >
          {task.completed && <Check size={9} color="white" strokeWidth={3} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <input
              autoFocus
              value={editDraft}
              onChange={(event) => onEditChange(event.target.value)}
              onBlur={onEditCommit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onEditCommit()
                if (event.key === 'Escape') onEditCancel()
              }}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                outline: 'none',
                borderBottom: '1px solid var(--primary-light)',
                fontSize: '11px',
                lineHeight: 1.45,
                color: palette.text,
                fontFamily: "'DM Sans', sans-serif",
                padding: 0,
              }}
            />
          ) : (
            <button
              onClick={onStartEdit}
              style={{
                display: 'block',
                width: '100%',
                padding: 0,
                background: 'none',
                border: 'none',
                textAlign: 'left',
                fontSize: '11px',
                lineHeight: 1.45,
                color: palette.text,
                textDecoration: task.completed ? 'line-through' : 'none',
                cursor: 'text',
                wordBreak: 'break-word',
              }}
            >
              {task.text}
            </button>
          )}
        </div>

        {!isEditing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <button
              onClick={onDelete}
              className="opacity-0 transition-opacity group-hover/task:opacity-100"
              style={{
                background: 'none',
                border: 'none',
                color: palette.action,
                cursor: 'pointer',
                padding: '1px',
              }}
              title="删除任务"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

interface TimelineColumnProps {
  columnId: string
  widgetId: string
  dueDate: string | null
  title: string
  subtitle: string
  accent: string
  tasks: ScheduledTask[]
  today: string
  droppable: boolean
  canAcceptDrop: boolean
  isCurrent: boolean
  editingId: string | null
  editDraft: string
  onToggleTask: (taskId: string) => void
  onStartEdit: (task: ScheduledTask) => void
  onEditChange: (value: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
  onDeleteTask: (taskId: string) => void
}

function TimelineColumn({
  columnId,
  widgetId,
  dueDate,
  title,
  subtitle,
  accent,
  tasks,
  today,
  droppable,
  canAcceptDrop,
  isCurrent,
  editingId,
  editDraft,
  onToggleTask,
  onStartEdit,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onDeleteTask,
}: TimelineColumnProps) {
  const columnDate = dueDate ?? today
  const orderedTasks = useMemo(() => orderTasks(tasks, columnDate, today), [columnDate, tasks, today])
  const { setNodeRef, isOver } = useDroppable({
    id: columnId,
    disabled: !droppable,
    data: { widgetId, dueDate, type: 'scheduled-day' },
  })

  const count = tasks.length
  const activeCount = tasks.filter((task) => !task.completed).length
  const highlightDrop = droppable && canAcceptDrop && isOver

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        borderRadius: '18px',
        border: highlightDrop
          ? '1px solid var(--primary-light)'
          : isCurrent
            ? '1px solid rgba(122,158,126,0.38)'
            : '1px solid rgba(221,211,195,0.95)',
        background: highlightDrop
          ? 'rgba(122,158,126,0.16)'
          : isCurrent
            ? 'rgba(122,158,126,0.10)'
            : 'rgba(254,250,245,0.9)',
        boxShadow: highlightDrop ? '0 10px 30px rgba(122,158,126,0.12)' : 'none',
      }}
    >
      <div
        style={{
          padding: '10px 10px 8px',
          borderBottom: '1px solid rgba(221,211,195,0.9)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: accent,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </span>
            <span
              style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </span>
          </div>
          <span
            style={{
              minWidth: '20px',
              padding: '0 6px',
              borderRadius: '999px',
              fontSize: '10px',
              lineHeight: '18px',
              textAlign: 'center',
              color: activeCount > 0 ? accent : 'var(--text-muted)',
              background: isCurrent ? 'rgba(122,158,126,0.14)' : 'rgba(122,158,126,0.10)',
            }}
          >
            {count}
          </span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'visible',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          minHeight: '72px',
        }}
      >
        {orderedTasks.length === 0 ? (
          <div
            style={{
              flex: 1,
              minHeight: '72px',
              borderRadius: '14px',
              border: `1px dashed ${highlightDrop ? 'var(--primary-light)' : 'rgba(221,211,195,0.95)'}`,
              background: highlightDrop ? 'rgba(122,158,126,0.08)' : 'rgba(247,243,236,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '10px',
              fontSize: '11px',
              lineHeight: 1.45,
              color: canAcceptDrop && droppable ? 'var(--text-sub)' : 'var(--text-muted)',
            }}
          >
            {droppable && canAcceptDrop ? '拖到这里\n吸附到这一天' : '从待办拖入'}
          </div>
        ) : (
          orderedTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              widgetId={widgetId}
              today={today}
              isEditing={editingId === task.id}
              editDraft={editDraft}
              onToggle={() => onToggleTask(task.id)}
              onStartEdit={() => onStartEdit(task)}
              onEditChange={onEditChange}
              onEditCommit={onEditCommit}
              onEditCancel={onEditCancel}
              onDelete={() => onDeleteTask(task.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

export function ScheduledTodoWidget({ widgetId }: { widgetId: string }) {
  const tasks = useWidgetDataStore((state) => state.scheduledTasksByWidget[widgetId] ?? EMPTY_TASKS)
  const toggleTask = useWidgetDataStore((state) => state.toggleScheduledTask)
  const removeTask = useWidgetDataStore((state) => state.removeScheduledTask)
  const updateTask = useWidgetDataStore((state) => state.updateScheduledTask)
  const { activeType, activeWidgetId } = useTodoDndState()
  const { ref: rootRef, width } = useElementWidth<HTMLDivElement>()

  const today = useCurrentDayKey()
  const approxColumnWidth = width > 0
    ? Math.max(COLUMN_WIDTH, (width - COLUMN_GAP * (SCHEDULE_DAYS - 1)) / SCHEDULE_DAYS)
    : COLUMN_WIDTH
  const compactHeaders = approxColumnWidth < 148
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineMinWidth = `${SCHEDULE_DAYS * COLUMN_WIDTH + (SCHEDULE_DAYS - 1) * COLUMN_GAP}px`

  const [taskPicker, setTaskPicker] = useState<{ id: string; el: HTMLElement } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [pageOffset, setPageOffset] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const currentPageStart = useMemo(() => getPageStart(today), [today])
  const pageStart = useMemo(
    () => addDays(currentPageStart, pageOffset * SCHEDULE_DAYS),
    [currentPageStart, pageOffset]
  )
  const pageEnd = useMemo(() => addDays(pageStart, SCHEDULE_DAYS - 1), [pageStart])
  const showPageControls = isHovered || pageOffset !== 0

  const dateColumns = useMemo(() => {
    return Array.from({ length: SCHEDULE_DAYS }, (_, index) => addDays(pageStart, index))
  }, [pageStart])

  const tasksByDate = useMemo(() => {
    const map: Record<string, ScheduledTask[]> = {}
    for (const date of dateColumns) map[date] = []

    for (const task of tasks) {
      const visibleDate = getVisibleDateForTask(task, today, currentPageStart, pageStart, pageEnd)
      if (!visibleDate || !map[visibleDate]) continue
      map[visibleDate].push(task)
    }

    return map
  }, [currentPageStart, dateColumns, tasks, today, pageEnd, pageStart])

  const canAcceptTimelineDrop =
    activeType === 'todo-item' || (activeType === 'scheduled-task' && activeWidgetId === widgetId)
  const pickerTask = taskPicker ? tasks.find((item) => item.id === taskPicker.id) ?? null : null
  const activeTaskPicker = taskPicker && pickerTask
    ? taskPicker
    : null

  function commitEdit() {
    if (!editingId) return
    const trimmed = editDraft.trim()
    if (trimmed) updateTask(widgetId, editingId, { text: trimmed })
    setEditingId(null)
  }

  function handleTimelineWheel(event: React.WheelEvent<HTMLDivElement>) {
    const container = timelineRef.current
    if (!container) return

    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

    const canScrollVertically = container.scrollHeight > container.clientHeight + 1
    const atTop = container.scrollTop <= 0
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1

    if (canScrollVertically) {
      if (event.deltaY < 0 && !atTop) return
      if (event.deltaY > 0 && !atBottom) return
    }

    event.preventDefault()
    container.scrollLeft += event.deltaY
  }

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: '10px',
      }}
    >
      {showPageControls && (
        <>
          <button
            onClick={() => {
              setTaskPicker(null)
              setPageOffset((value) => value - 1)
            }}
            style={{
              position: 'absolute',
              top: '50%',
              left: '8px',
              transform: 'translateY(-50%)',
              zIndex: 2,
              width: '28px',
              height: '28px',
              borderRadius: '999px',
              border: '1px solid rgba(221,211,195,0.95)',
              background: 'rgba(254,250,245,0.94)',
              color: 'var(--text-sub)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 8px 18px rgba(90,70,50,0.08)',
            }}
            title="前 5 天"
          >
            <ChevronLeft size={15} />
          </button>

          <button
            onClick={() => {
              setTaskPicker(null)
              setPageOffset((value) => value + 1)
            }}
            style={{
              position: 'absolute',
              top: '50%',
              right: '8px',
              transform: 'translateY(-50%)',
              zIndex: 2,
              width: '28px',
              height: '28px',
              borderRadius: '999px',
              border: '1px solid rgba(221,211,195,0.95)',
              background: 'rgba(254,250,245,0.94)',
              color: 'var(--text-sub)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 8px 18px rgba(90,70,50,0.08)',
            }}
            title="后 5 天"
          >
            <ChevronRight size={15} />
          </button>
        </>
      )}

      {pageOffset !== 0 && (
        <button
          onClick={() => {
            setTaskPicker(null)
            setPageOffset(0)
          }}
          style={{
            position: 'absolute',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2,
            padding: '4px 10px',
            borderRadius: '999px',
            border: '1px solid rgba(122,158,126,0.22)',
            background: 'rgba(247,250,245,0.96)',
            color: 'var(--primary-dark)',
            fontSize: '11px',
            lineHeight: 1.2,
            cursor: 'pointer',
            boxShadow: '0 8px 18px rgba(90,70,50,0.08)',
          }}
        >
          回到今天
        </button>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <div
          ref={timelineRef}
          onWheel={handleTimelineWheel}
          style={{
            height: '100%',
            overflowX: 'auto',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            paddingBottom: '2px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${SCHEDULE_DAYS}, minmax(${COLUMN_WIDTH}px, 1fr))`,
              gap: `${COLUMN_GAP}px`,
              width: `max(100%, ${timelineMinWidth})`,
              minHeight: '100%',
            }}
          >
            {dateColumns.map((date) => {
              const { title, subtitle } = getColumnHeading(date, today, compactHeaders)
              const isTodayColumn = date === today
              const accent = isTodayColumn
                ? 'var(--primary-dark)'
                : diffDays(date, today) === 1
                  ? 'var(--secondary)'
                  : 'var(--text-sub)'

              return (
                <TimelineColumn
                  key={date}
                  columnId={`scheduled-day-${widgetId}-${date}`}
                  widgetId={widgetId}
                  dueDate={date}
                  title={title}
                  subtitle={subtitle}
                  accent={accent}
                  tasks={tasksByDate[date] ?? EMPTY_TASKS}
                  today={today}
                  droppable
                  canAcceptDrop={canAcceptTimelineDrop}
                  isCurrent={isTodayColumn}
                  editingId={editingId}
                  editDraft={editDraft}
                  onToggleTask={(taskId) => toggleTask(widgetId, taskId)}
                  onStartEdit={(task) => {
                    setEditingId(task.id)
                    setEditDraft(task.text)
                  }}
                  onEditChange={setEditDraft}
                  onEditCommit={commitEdit}
                  onEditCancel={() => setEditingId(null)}
                  onDeleteTask={(taskId) => removeTask(widgetId, taskId)}
                />
              )
            })}
          </div>
        </div>
      </div>

      {activeTaskPicker && pickerTask && (
        <DatePicker
          value={pickerTask.dueDate ?? null}
          anchorEl={activeTaskPicker.el}
          today={today}
          onSelect={(date) => updateTask(widgetId, activeTaskPicker.id, { dueDate: date })}
          onClose={() => setTaskPicker(null)}
        />
      )}
    </div>
  )
}
