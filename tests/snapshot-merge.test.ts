import { describe, expect, it } from 'vitest'
import { mergeDashboardSnapshots, type DashboardSyncSnapshot } from '@/lib/snapshotMerge'

function snapshot(overrides: Partial<DashboardSyncSnapshot> = {}): DashboardSyncSnapshot {
  return {
    backgroundPath: null,
    backgroundSignature: null,
    dashboard: {
      layouts: {},
      widgetNames: {},
      widgets: [{ id: 'todo-widget', type: 'todo' }],
    },
    widgetData: {
      activeAiConversationId: 'default-dashboard-agent',
      aiConversations: {},
      calendarEmbeds: {},
      calendarEventsByDate: {},
      dailyBriefsByDate: {},
      habitLogs: {},
      habitsByWidget: {},
      linedNotesByWidget: {},
      notesByWidget: {},
      pomodoro: { lastSessionDate: '2026-05-12', todaySessions: 0, totalSessions: 0 },
      quickLinks: [],
      readingListsByWidget: {},
      scheduledTasksByWidget: {},
      todosByWidget: {
        'todo-widget': [
          { createdAt: 1, done: false, id: 'todo-1', text: '写计划' },
        ],
      },
    },
    ...overrides,
  }
}

describe('dashboard snapshot three-way merge', () => {
  it('keeps local-only changes', () => {
    const base = snapshot()
    const local = snapshot({
      widgetData: {
        ...base.widgetData,
        todosByWidget: {
          'todo-widget': [{ createdAt: 1, done: true, id: 'todo-1', text: '写计划' }],
        },
      },
    })
    const remote = snapshot()

    const result = mergeDashboardSnapshots(base, local, remote)

    expect(result.conflicts).toHaveLength(0)
    expect(result.merged.widgetData.todosByWidget['todo-widget'][0].done).toBe(true)
  })

  it('keeps remote-only changes', () => {
    const base = snapshot()
    const local = snapshot()
    const remote = snapshot({
      dashboard: {
        ...base.dashboard,
        widgetNames: { 'todo-widget': '云端待办' },
      },
    })

    const result = mergeDashboardSnapshots(base, local, remote)

    expect(result.conflicts).toHaveLength(0)
    expect(result.merged.dashboard.widgetNames['todo-widget']).toBe('云端待办')
  })

  it('merges different items changed on both sides', () => {
    const base = snapshot()
    const local = snapshot({
      widgetData: {
        ...base.widgetData,
        todosByWidget: {
          'todo-widget': [
            ...base.widgetData.todosByWidget['todo-widget'],
            { createdAt: 2, done: false, id: 'todo-local', text: '本机任务' },
          ],
        },
      },
    })
    const remote = snapshot({
      widgetData: {
        ...base.widgetData,
        todosByWidget: {
          'todo-widget': [
            ...base.widgetData.todosByWidget['todo-widget'],
            { createdAt: 3, done: false, id: 'todo-remote', text: '云端任务' },
          ],
        },
      },
    })

    const result = mergeDashboardSnapshots(base, local, remote)

    expect(result.conflicts).toHaveLength(0)
    expect(result.merged.widgetData.todosByWidget['todo-widget'].map((todo) => todo.id)).toEqual([
      'todo-1',
      'todo-local',
      'todo-remote',
    ])
  })

  it('flags same-object edits as conflicts', () => {
    const base = snapshot()
    const local = snapshot({
      widgetData: {
        ...base.widgetData,
        todosByWidget: {
          'todo-widget': [{ createdAt: 1, done: false, id: 'todo-1', text: '本机编辑' }],
        },
      },
    })
    const remote = snapshot({
      widgetData: {
        ...base.widgetData,
        todosByWidget: {
          'todo-widget': [{ createdAt: 1, done: false, id: 'todo-1', text: '云端编辑' }],
        },
      },
    })

    const result = mergeDashboardSnapshots(base, local, remote)

    expect(result.conflicts).toEqual([
      expect.objectContaining({ path: 'widgetData.todosByWidget.todo-widget.todo-1.text' }),
    ])
  })

  it('flags delete-versus-edit as a conflict', () => {
    const base = snapshot()
    const local = snapshot({
      widgetData: {
        ...base.widgetData,
        todosByWidget: { 'todo-widget': [] },
      },
    })
    const remote = snapshot({
      widgetData: {
        ...base.widgetData,
        todosByWidget: {
          'todo-widget': [{ createdAt: 1, done: false, id: 'todo-1', text: '云端编辑' }],
        },
      },
    })

    const result = mergeDashboardSnapshots(base, local, remote)

    expect(result.conflicts).toEqual([
      expect.objectContaining({ path: 'widgetData.todosByWidget.todo-widget.todo-1', type: 'delete-edit' }),
    ])
  })

  it('flags background changes on both sides as a conflict', () => {
    const base = snapshot({ backgroundPath: 'user/background.jpg', backgroundSignature: 'old' })
    const local = snapshot({ backgroundPath: 'user/background.jpg', backgroundSignature: 'local' })
    const remote = snapshot({ backgroundPath: 'user/background.jpg', backgroundSignature: 'remote' })

    const result = mergeDashboardSnapshots(base, local, remote)

    expect(result.conflicts).toEqual([
      expect.objectContaining({ path: 'background', type: 'background' }),
    ])
  })
})
