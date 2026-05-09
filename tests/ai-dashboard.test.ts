import { beforeEach, describe, expect, it } from 'vitest'
import { applyPendingActions } from '@/lib/ai/dashboardTools'
import { buildBriefContext, getLocalDayIsoRange } from '@/lib/ai/briefContext'
import { migrateLegacyNotesToWidgetStore } from '@/lib/notesMigration'
import { useDashboardStore } from '@/store/dashboardStore'
import {
  createLinedNotesDocument,
  normalizeLinedNotesDocument,
  useWidgetDataStore,
} from '@/store/widgetDataStore'
import type { PendingAction } from '@/lib/ai/types'
import type { WidgetInstance } from '@/types/widget'

function resetStores(widgets: WidgetInstance[] = []) {
  useDashboardStore.setState({
    layouts: {},
    widgetNames: {},
    widgets,
  })
  useWidgetDataStore.setState({
    calendarEmbeds: {},
    dailyBriefsByDate: {},
    habitLogs: {},
    habitsByWidget: {},
    linedNotesByWidget: {},
    notesByWidget: {},
    pomodoro: { totalSessions: 0, todaySessions: 0, lastSessionDate: '2026-05-05' },
    quickLinks: [],
    scheduledTasksByWidget: {},
    todosByWidget: {},
  })
}

describe('dashboard AI foundations', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStores()
  })

  it('normalizes legacy lined note strings into a document', () => {
    const document = normalizeLinedNotesDocument('面试在周五下午')
    expect(document.pages).toHaveLength(1)
    expect(document.pages[0].content).toBe('面试在周五下午')
    expect(document.activePageId).toBe(document.pages[0].id)
  })

  it('migrates legacy note localStorage without deleting the old key', () => {
    localStorage.setItem('primoria-notes', '旧便签内容')

    migrateLegacyNotesToWidgetStore([{ id: 'notes-1', type: 'notes' }])

    expect(useWidgetDataStore.getState().notesByWidget['notes-1']).toBe('旧便签内容')
    expect(localStorage.getItem('primoria-notes')).toBe('旧便签内容')
  })

  it('applies a create habit pending action by adding a habits widget when needed', () => {
    const action: PendingAction = {
      id: 'a1',
      label: '添加习惯打卡组件并新建习惯：每天喝 8 杯水',
      name: '每天喝 8 杯水',
      type: 'createHabit',
      widgetId: null,
    }

    applyPendingActions([action])

    const habitWidget = useDashboardStore.getState().widgets.find((widget) => widget.type === 'habits')
    expect(habitWidget).toBeTruthy()
    expect(useWidgetDataStore.getState().habitsByWidget[habitWidget!.id][0].name).toBe('每天喝 8 杯水')
  })

  it('builds brief context from calendar, scheduled tasks, habits, and notes', () => {
    resetStores([
      { id: 'brief-1', type: 'daily-brief' },
      { id: 'schedule-1', type: 'scheduled-todo' },
      { id: 'habits-1', type: 'habits' },
      { id: 'lined-1', type: 'lined-notes' },
    ])
    useWidgetDataStore.setState({
      habitLogs: { habitDone: ['2026-05-05'] },
      habitsByWidget: {
        'habits-1': [
          { id: 'habitDone', name: '喝水' },
          { id: 'habitOpen', name: '运动' },
        ],
      },
      linedNotesByWidget: {
        'lined-1': createLinedNotesDocument('上周笔记：面试安排在 5 月 8 日。'),
      },
      scheduledTasksByWidget: {
        'schedule-1': [
          { id: 'task1', completed: false, completedAt: null, dueDate: '2026-05-05', text: '写日报' },
          { id: 'task2', completed: true, completedAt: '2026-05-05', dueDate: '2026-05-05', text: '已完成' },
        ],
      },
    })

    const { context } = buildBriefContext('2026-05-05', [
      { allDay: false, end: '2026-05-05T10:30:00.000Z', id: 'cal1', start: '2026-05-05T10:00:00.000Z', title: '站会' },
    ])

    expect(context.calendar.count).toBe(1)
    expect(context.scheduledTasks.count).toBe(1)
    expect(context.habits.remaining).toBe(1)
    expect(context.notes[0].content).toContain('面试安排')
  })

  it('moves completed scheduled tasks to the new visible date', () => {
    resetStores([{ id: 'schedule-1', type: 'scheduled-todo' }])
    useWidgetDataStore.setState({
      scheduledTasksByWidget: {
        'schedule-1': [
          {
            id: 'task-completed',
            text: '已完成任务',
            dueDate: '2026-05-08',
            completed: true,
            completedAt: '2026-05-08',
          },
        ],
      },
    })

    useWidgetDataStore.getState().moveScheduledTaskToDate('schedule-1', 'task-completed', '2026-05-11')

    const moved = useWidgetDataStore.getState().scheduledTasksByWidget['schedule-1'][0]
    expect(moved.dueDate).toBe('2026-05-11')
    expect(moved.completedAt).toBe('2026-05-11')
  })

  it('returns a one-day ISO range for a local date key', () => {
    const range = getLocalDayIsoRange('2026-05-05')
    expect(new Date(range.timeMax).getTime() - new Date(range.timeMin).getTime()).toBe(86_400_000)
  })
})
