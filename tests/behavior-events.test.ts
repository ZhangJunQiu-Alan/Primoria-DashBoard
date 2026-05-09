import { beforeEach, describe, expect, it } from 'vitest'
import {
  BEHAVIOR_EVENT_QUEUE_KEY,
  getQueuedBehaviorEvents,
  replaceQueuedBehaviorEvents,
  trackBehaviorEvent,
  type QueuedBehaviorEvent,
} from '@/lib/behaviorEvents'
import { flushBehaviorEventQueue } from '@/lib/behaviorEventSync'
import { useWidgetDataStore } from '@/store/widgetDataStore'

function makeQueuedEvent(id: string): QueuedBehaviorEvent {
  return {
    actor: 'user',
    clientEventId: id,
    eventName: 'todo.added',
    metadata: { textSummary: '写计划' },
    objectId: 'todo-1',
    objectType: 'todo',
    occurredAt: '2026-05-10T00:00:00.000Z',
    schemaVersion: 1,
    summary: '新增待办：写计划',
    surface: 'widget',
    widgetId: 'todo-widget',
    widgetType: 'todo',
  }
}

function makeFakeClient({ fail = false } = {}) {
  const insertedRows: Record<string, unknown>[][] = []
  return {
    client: {
      from: (table: string) => ({
        upsert: async (rows: Record<string, unknown>[]) => {
          expect(table).toBe('user_behavior_events')
          insertedRows.push(rows)
          return fail ? { error: { message: 'network down' } } : { error: null }
        },
      }),
    },
    insertedRows,
  }
}

describe('behavior events', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('queues events locally before login or sync', () => {
    trackBehaviorEvent({
      eventName: 'todo.added',
      metadata: { textSummary: '写实现计划' },
      objectType: 'todo',
      summary: '新增待办：写实现计划',
      surface: 'widget',
      widgetId: 'todo-1',
      widgetType: 'todo',
    })

    const queue = getQueuedBehaviorEvents()
    expect(queue).toHaveLength(1)
    expect(queue[0].actor).toBe('user')
    expect(queue[0].eventName).toBe('todo.added')
    expect(localStorage.getItem(BEHAVIOR_EVENT_QUEUE_KEY)).toContain('todo.added')
  })

  it('flushes queued events to Supabase rows and clears successful batch', async () => {
    replaceQueuedBehaviorEvents([makeQueuedEvent('evt-1'), makeQueuedEvent('evt-2')])
    const fake = makeFakeClient()

    const result = await flushBehaviorEventQueue('user-123', fake.client)

    expect(result.ok).toBe(true)
    expect(result.flushed).toBe(2)
    expect(getQueuedBehaviorEvents()).toHaveLength(0)
    expect(fake.insertedRows[0]).toHaveLength(2)
    expect(fake.insertedRows[0][0]).toMatchObject({
      client_event_id: 'evt-1',
      event_name: 'todo.added',
      user_id: 'user-123',
    })
  })

  it('deduplicates repeated client_event_id values during upload', async () => {
    replaceQueuedBehaviorEvents([makeQueuedEvent('evt-dupe'), makeQueuedEvent('evt-dupe')])
    const fake = makeFakeClient()

    const result = await flushBehaviorEventQueue('user-123', fake.client)

    expect(result.ok).toBe(true)
    expect(result.flushed).toBe(1)
    expect(fake.insertedRows[0]).toHaveLength(1)
    expect(getQueuedBehaviorEvents()).toHaveLength(0)
  })

  it('keeps the local queue when Supabase upload fails', async () => {
    replaceQueuedBehaviorEvents([makeQueuedEvent('evt-1')])
    const fake = makeFakeClient({ fail: true })

    const result = await flushBehaviorEventQueue('user-123', fake.client)

    expect(result.ok).toBe(false)
    expect(result.error).toBe('network down')
    expect(getQueuedBehaviorEvents()).toHaveLength(1)
  })

  it('sanitizes private or heavy metadata before storing it locally', () => {
    trackBehaviorEvent({
      eventName: 'note.updated',
      metadata: {
        backgroundDataUrl: 'data:image/png;base64,abcdef',
        iframeHtml: '<iframe src="https://calendar.google.com"></iframe>',
        signedUrl: 'https://example.com/private.mp3?token=secret',
        nested: { token: 'secret-value' },
      },
      objectType: 'note',
      summary: 'x'.repeat(300),
      surface: 'widget',
      widgetId: 'note-1',
      widgetType: 'notes',
    })

    const event = getQueuedBehaviorEvents()[0]
    expect(event.summary.length).toBeLessThanOrEqual(223)
    expect(event.metadata.backgroundDataUrl).toMatch('[data-url:')
    expect(event.metadata.iframeHtml).toBe('[html]')
    expect(event.metadata.signedUrl).toBe('[url]')
    expect((event.metadata.nested as Record<string, unknown>).token).toBe('[redacted]')
  })

  it('records key store actions as behavior events', () => {
    useWidgetDataStore.setState({ todosByWidget: {} })

    useWidgetDataStore.getState().addTodo('todo-widget', '整理 RAG 方案')

    const event = getQueuedBehaviorEvents().find((item) => item.eventName === 'todo.added')
    expect(event).toBeTruthy()
    expect(event?.widgetId).toBe('todo-widget')
    expect(event?.metadata.textSummary).toBe('整理 RAG 方案')
  })
})
