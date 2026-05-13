import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildUserContentItems,
  syncUserContentItems,
  type UserContentItemRow,
} from '@/lib/userContentItems'
import { useDashboardStore } from '@/store/dashboardStore'
import {
  DEFAULT_AI_CONVERSATION_ID,
  createAiConversationState,
  createLinedNotesDocument,
  useWidgetDataStore,
} from '@/store/widgetDataStore'
import type { WidgetInstance } from '@/types/widget'

function resetStores(widgets: WidgetInstance[] = []) {
  useDashboardStore.setState({
    layouts: {},
    widgetNames: {},
    widgets,
  })
  useWidgetDataStore.setState({
    activeAiConversationId: DEFAULT_AI_CONVERSATION_ID,
    aiConversations: {},
    calendarEmbeds: {},
    calendarEventsByDate: {},
    dailyBriefsByDate: {},
    habitLogs: {},
    habitsByWidget: {},
    linedNotesByWidget: {},
    notesByWidget: {},
    pomodoro: { totalSessions: 0, todaySessions: 0, lastSessionDate: '2026-05-10' },
    quickLinks: [],
    scheduledTasksByWidget: {},
    todosByWidget: {},
  })
}

function makeFakeClient({ deleteFail = false, upsertFail = false } = {}) {
  const upsertedRows: UserContentItemRow[][] = []
  const staleDeletes: Array<{ syncBatchId: string; userId: string }> = []
  return {
    client: {
      from: (table: string) => ({
        delete: () => ({
          eq: (column: string, userId: string) => {
            expect(table).toBe('user_content_items')
            expect(column).toBe('user_id')
            return {
              neq: async (batchColumn: string, syncBatchId: string) => {
                expect(batchColumn).toBe('sync_batch_id')
                staleDeletes.push({ syncBatchId, userId })
                return deleteFail
                  ? { error: { message: 'delete failed' } }
                  : { error: null }
              },
            }
          },
        }),
        upsert: async (rows: UserContentItemRow[], options: { onConflict: string }) => {
          expect(table).toBe('user_content_items')
          expect(options.onConflict).toBe('user_id,content_key')
          upsertedRows.push(rows)
          return upsertFail
            ? { error: { message: 'upsert failed' } }
            : { error: null }
        },
      }),
    },
    staleDeletes,
    upsertedRows,
  }
}

describe('user content items', () => {
  beforeEach(() => {
    localStorage.clear()
    resetStores([
      { id: 'notes-1', type: 'notes' },
      { id: 'lined-1', type: 'lined-notes' },
      { id: 'todo-1', type: 'todo' },
      { id: 'schedule-1', type: 'scheduled-todo' },
      { id: 'habits-1', type: 'habits' },
      { id: 'brief-1', type: 'daily-brief' },
    ])
  })

  it('builds stable content keys for dashboard state and AI history', () => {
    const conversation = createAiConversationState(DEFAULT_AI_CONVERSATION_ID, '2026-05-10T00:00:00.000Z')
    conversation.messages = [
      {
        content: '帮我总结今天的任务安排',
        createdAt: '2026-05-10T00:01:00.000Z',
        id: 'msg-user-1',
        role: 'user',
      },
      {
        content: '今天有两个重点任务。',
        createdAt: '2026-05-10T00:02:00.000Z',
        id: 'msg-ai-1',
        role: 'assistant',
      },
    ]
    conversation.toolCalls = [
      {
        args: { includeCompleted: false },
        createdAt: '2026-05-10T00:01:30.000Z',
        id: 'tool-1',
        name: 'list_scheduled_tasks',
        result: { count: 2 },
      },
    ]
    conversation.pendingActions = [
      {
        id: 'action-1',
        label: '将 1 个任务移动到 2026-05-11',
        taskIds: ['task-1'],
        toDate: '2026-05-11',
        type: 'moveScheduledTasks',
        widgetId: 'schedule-1',
      },
    ]

    useWidgetDataStore.setState({
      aiConversations: { [conversation.id]: conversation },
      calendarEventsByDate: {
        '2026-05-10': [
          {
            allDay: false,
            end: '2026-05-10T03:30:00.000Z',
            id: 'calendar-1',
            location: 'Zoom',
            start: '2026-05-10T03:00:00.000Z',
            title: '项目会议',
          },
        ],
      },
      dailyBriefsByDate: {
        '2026-05-10': {
          calendarConnected: true,
          date: '2026-05-10',
          generatedAt: '2026-05-10T00:05:00.000Z',
          recommendation: '先处理最早截止的任务。',
          sourceFingerprint: 'fingerprint-1',
          summary: '今天有一个会议和两个任务。',
        },
      },
      habitLogs: { 'habit-1': ['2026-05-10'] },
      habitsByWidget: { 'habits-1': [{ id: 'habit-1', name: '阅读' }] },
      linedNotesByWidget: {
        'lined-1': createLinedNotesDocument('格纸笔记完整正文'),
      },
      notesByWidget: { 'notes-1': '便签完整正文' },
      scheduledTasksByWidget: {
        'schedule-1': [
          { completed: false, completedAt: null, dueDate: '2026-05-10', id: 'task-1', text: '写内容层' },
        ],
      },
      todosByWidget: {
        'todo-1': [{ createdAt: 1778371200000, done: false, id: 'todo-a', text: '整理学习文档' }],
      },
    })

    const items = buildUserContentItems()
    expect(items.map((item) => item.contentKey)).toEqual(expect.arrayContaining([
      'note:notes-1',
      expect.stringMatching(/^lined_note:lined-1:/),
      'todo:todo-1:todo-a',
      'scheduled_task:schedule-1:task-1',
      'habit:habits-1:habit-1',
      'daily_brief:2026-05-10',
      'calendar_event:2026-05-10:calendar-1',
      `ai_message:${DEFAULT_AI_CONVERSATION_ID}:msg-user-1`,
      `ai_message:${DEFAULT_AI_CONVERSATION_ID}:msg-ai-1`,
      `ai_tool_call:${DEFAULT_AI_CONVERSATION_ID}:tool-1`,
      `pending_action:${DEFAULT_AI_CONVERSATION_ID}:action-1`,
    ]))
    expect(items.find((item) => item.contentKey === 'note:notes-1')?.body).toBe('便签完整正文')
    expect(items.find((item) => item.contentKey === `ai_message:${DEFAULT_AI_CONVERSATION_ID}:msg-user-1`)?.body)
      .toBe('帮我总结今天的任务安排')
  })

  it('clears AI conversation history before content indexing', () => {
    const conversation = createAiConversationState(DEFAULT_AI_CONVERSATION_ID, '2026-05-10T00:00:00.000Z')
    conversation.messages = [
      {
        content: '清空前的消息',
        createdAt: '2026-05-10T00:01:00.000Z',
        id: 'msg-user-1',
        role: 'user',
      },
    ]
    conversation.geminiContents = [{ role: 'user', parts: [{ text: '清空前的消息' }] }]
    conversation.toolCalls = [
      {
        args: {},
        createdAt: '2026-05-10T00:01:30.000Z',
        id: 'tool-1',
        name: 'get_dashboard_overview',
        result: { ok: true },
      },
    ]
    conversation.pendingActions = [
      {
        id: 'action-1',
        label: '准备移动任务',
        taskIds: ['task-1'],
        toDate: '2026-05-11',
        type: 'moveScheduledTasks',
        widgetId: 'schedule-1',
      },
    ]
    useWidgetDataStore.setState({ aiConversations: { [conversation.id]: conversation } })

    const cleared = useWidgetDataStore.getState().clearAiConversation(DEFAULT_AI_CONVERSATION_ID)
    const items = buildUserContentItems()

    expect(cleared.messages).toHaveLength(0)
    expect(cleared.geminiContents).toHaveLength(0)
    expect(cleared.toolCalls).toHaveLength(0)
    expect(cleared.pendingActions).toHaveLength(0)
    expect(useWidgetDataStore.getState().aiConversations[DEFAULT_AI_CONVERSATION_ID]).toEqual(cleared)
    expect(items.some((item) => item.contentKey.startsWith(`ai_message:${DEFAULT_AI_CONVERSATION_ID}:`))).toBe(false)
    expect(items.some((item) => item.contentKey.startsWith(`ai_tool_call:${DEFAULT_AI_CONVERSATION_ID}:`))).toBe(false)
    expect(items.some((item) => item.contentKey.startsWith(`pending_action:${DEFAULT_AI_CONVERSATION_ID}:`))).toBe(false)
  })

  it('sanitizes heavy or sensitive content before upload rows are built', async () => {
    useWidgetDataStore.setState({
      notesByWidget: {
        'notes-1': '图片 data:image/png;base64,abcdef <iframe src="https://calendar.google.com"></iframe> https://example.com/file.mp3?token=secret',
      },
    })
    const fake = makeFakeClient()

    await syncUserContentItems('user-1', fake.client)

    const noteRow = fake.upsertedRows[0].find((row) => row.content_key === 'note:notes-1')
    expect(noteRow?.body).toContain('[data-url]')
    expect(noteRow?.body).toContain('[iframe]')
    expect(noteRow?.body).toContain('[signed-url]')
    expect(noteRow?.body).not.toContain('data:image')
    expect(noteRow?.body).not.toContain('<iframe')
    expect(noteRow?.body).not.toContain('token=secret')
  })

  it('upserts content items and removes stale rows after a successful sync', async () => {
    useWidgetDataStore.setState({ notesByWidget: { 'notes-1': '同步正文' } })
    const fake = makeFakeClient()

    const result = await syncUserContentItems('user-1', fake.client)

    expect(result.ok).toBe(true)
    expect(result.synced).toBe(1)
    expect(fake.upsertedRows[0][0]).toMatchObject({
      content_key: 'note:notes-1',
      content_type: 'note',
      user_id: 'user-1',
    })
    expect(fake.staleDeletes).toHaveLength(1)
    expect(fake.staleDeletes[0].userId).toBe('user-1')
  })

  it('does not delete stale rows when upsert fails', async () => {
    useWidgetDataStore.setState({ notesByWidget: { 'notes-1': '同步正文' } })
    const fake = makeFakeClient({ upsertFail: true })

    const result = await syncUserContentItems('user-1', fake.client)

    expect(result.ok).toBe(false)
    expect(result.error).toBe('upsert failed')
    expect(fake.staleDeletes).toHaveLength(0)
  })
})
