import { addDaysToDateKey, parseLocalDateKey } from '@/lib/date'
import { useDashboardStore } from '@/store/dashboardStore'
import { useWidgetDataStore } from '@/store/widgetDataStore'
import type { CalendarEvent } from '@/lib/ai/types'

export function getLocalDayIsoRange(date: string) {
  const start = parseLocalDateKey(date)
  const end = parseLocalDateKey(addDaysToDateKey(date, 1))
  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
  }
}

function clipText(value: string, length: number) {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length > length ? `${trimmed.slice(0, length)}...` : trimmed
}

export function buildBriefContext(date: string, calendarEvents: CalendarEvent[]) {
  const dashboard = useDashboardStore.getState()
  const data = useWidgetDataStore.getState()
  const widgetTitles = new Map(
    dashboard.widgets.map((widget) => [
      widget.id,
      dashboard.widgetNames[widget.id] ?? widget.type,
    ])
  )

  const scheduledTasks = Object.entries(data.scheduledTasksByWidget).flatMap(([widgetId, tasks]) =>
    tasks
      .filter((task) => !task.completed && (!task.dueDate || task.dueDate <= date))
      .map((task) => ({
        id: task.id,
        text: task.text,
        dueDate: task.dueDate,
        widgetId,
        widgetTitle: widgetTitles.get(widgetId) ?? '日程任务',
      }))
  )

  const habits = Object.entries(data.habitsByWidget).flatMap(([widgetId, habitsInWidget]) =>
    habitsInWidget.map((habit) => ({
      id: habit.id,
      name: habit.name,
      doneToday: (data.habitLogs[habit.id] ?? []).includes(date),
      widgetId,
      widgetTitle: widgetTitles.get(widgetId) ?? '习惯打卡',
    }))
  )

  const notes = [
    ...Object.entries(data.notesByWidget).flatMap(([widgetId, content]) =>
      content.trim()
        ? [{
            content: clipText(content, 360),
            type: 'notes' as const,
            widgetId,
            widgetTitle: widgetTitles.get(widgetId) ?? '便签',
          }]
        : []
    ),
    ...Object.entries(data.linedNotesByWidget).flatMap(([widgetId, document]) =>
      document.pages
        .filter((page) => page.content.trim())
        .slice(0, 3)
        .map((page, index) => ({
          content: clipText(page.content, 260),
          page: index + 1,
          type: 'lined-notes' as const,
          widgetId,
          widgetTitle: widgetTitles.get(widgetId) ?? '格纸笔记',
        }))
    ),
  ].slice(0, 8)

  const context = {
    calendar: {
      count: calendarEvents.length,
      events: calendarEvents.map((event) => ({
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        location: event.location,
      })),
    },
    habits: {
      done: habits.filter((habit) => habit.doneToday).length,
      remaining: habits.filter((habit) => !habit.doneToday).length,
      items: habits,
    },
    notes,
    scheduledTasks: {
      count: scheduledTasks.length,
      overdue: scheduledTasks.filter((task) => task.dueDate && task.dueDate < date).length,
      today: scheduledTasks.filter((task) => task.dueDate === date || !task.dueDate).length,
      items: scheduledTasks,
    },
  }

  return {
    context,
    sourceFingerprint: JSON.stringify(context),
  }
}
