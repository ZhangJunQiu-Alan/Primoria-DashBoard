import { supabase } from '@/lib/supabase'
import { useDashboardStore } from '@/store/dashboardStore'
import { useWidgetDataStore } from '@/store/widgetDataStore'
import type { WidgetType } from '@/types/widget'

export type ContentItemType =
  | 'note'
  | 'lined_note_page'
  | 'todo'
  | 'scheduled_task'
  | 'habit'
  | 'daily_brief'
  | 'calendar_event'
  | 'ai_message'
  | 'ai_tool_call'
  | 'pending_action'

export interface UserContentItemDraft {
  body: string
  contentKey: string
  contentType: ContentItemType
  metadata?: Record<string, unknown>
  objectId?: string | null
  objectType?: string | null
  sourceCreatedAt?: string | null
  sourceSurface: string
  sourceUpdatedAt?: string | null
  title: string
  widgetId?: string | null
  widgetType?: string | null
}

export interface UserContentItemRow {
  body: string
  content_hash: string
  content_key: string
  content_type: ContentItemType
  metadata: Record<string, unknown>
  object_id: string | null
  object_type: string | null
  schema_version: 1
  source_created_at: string | null
  source_surface: string
  source_updated_at: string | null
  sync_batch_id: string
  title: string
  user_id: string
  widget_id: string | null
  widget_type: string | null
}

interface SupabaseMutationResult {
  error: { message?: string } | null
}

interface SupabaseLikeClient {
  from: (table: string) => {
    upsert: (
      rows: UserContentItemRow[],
      options: { onConflict: string }
    ) => PromiseLike<SupabaseMutationResult>
    delete: () => {
      eq: (column: string, value: string) => {
        neq: (column: string, value: string) => PromiseLike<SupabaseMutationResult>
      }
    }
  }
}

export interface UserContentSyncResult {
  error?: string
  ok: boolean
  synced: number
}

const CONTENT_SCHEMA_VERSION = 1
const MAX_METADATA_STRING_LENGTH = 500
const MAX_METADATA_ARRAY_LENGTH = 40
const MAX_METADATA_DEPTH = 5

const WIDGET_TITLE_BY_TYPE: Record<WidgetType, string> = {
  clock: '时钟',
  'daily-brief': '每日简报',
  'focus-journey': '番茄钟',
  'google-calendar': 'Google 日历',
  habits: '习惯打卡',
  'lined-notes': '格纸笔记',
  motto: '格言',
  'music-player': '音乐播放器',
  notes: '便签',
  'quick-links': '快速链接',
  'scheduled-todo': '日程任务',
  todo: '待办事项',
}

function makeSyncBatchId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `content-sync-${crypto.randomUUID()}`
  }
  return `content-sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function sanitizeContentBody(value: string) {
  return value
    .replace(/data:[^,\s]+;base64,[a-z0-9+/=]+/gi, '[data-url]')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '[iframe]')
    .replace(/https?:\/\/\S*[?&](?:token|signature|x-amz-signature|policy|key-pair-id)=\S*/gi, '[signed-url]')
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (depth > MAX_METADATA_DEPTH) return '[max-depth]'
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `[data-url:${value.length}]`
    if (/<iframe/i.test(value)) return '[html]'
    if (/https?:\/\/\S*[?&](?:token|signature|x-amz-signature|policy|key-pair-id)=/i.test(value)) {
      return '[signed-url]'
    }
    return value.length > MAX_METADATA_STRING_LENGTH
      ? `${value.slice(0, MAX_METADATA_STRING_LENGTH)}...`
      : value
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ARRAY_LENGTH)
      .map((item) => sanitizeMetadataValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const lower = key.toLowerCase()
        if (lower.includes('token') || lower.includes('secret')) return [key, '[redacted]']
        if (lower.includes('iframe') || lower.includes('html') || lower.includes('embed')) return [key, '[html]']
        if (lower.includes('signedurl') || lower.includes('signed_url')) return [key, '[signed-url]']
        if (lower.includes('dataurl') || lower.includes('data_url')) return [key, '[data-url]']
        return [key, sanitizeMetadataValue(item, depth + 1)]
      })
    )
  }
  return String(value)
}

function sanitizeMetadata(metadata: Record<string, unknown> = {}) {
  return sanitizeMetadataValue(metadata, 0) as Record<string, unknown>
}

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function getWidgetTitles() {
  const dashboard = useDashboardStore.getState()
  return new Map(
    dashboard.widgets.map((widget) => [
      widget.id,
      dashboard.widgetNames[widget.id] ?? WIDGET_TITLE_BY_TYPE[widget.type],
    ])
  )
}

function toIsoFromMillis(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null
}

function toRow(draft: UserContentItemDraft, userId: string, syncBatchId: string): UserContentItemRow {
  const body = sanitizeContentBody(draft.body)
  const title = sanitizeContentBody(draft.title)
  const metadata = sanitizeMetadata(draft.metadata)
  const contentHash = hashString(JSON.stringify({
    body,
    contentType: draft.contentType,
    metadata,
    title,
  }))

  return {
    body,
    content_hash: contentHash,
    content_key: draft.contentKey,
    content_type: draft.contentType,
    metadata,
    object_id: draft.objectId ?? null,
    object_type: draft.objectType ?? null,
    schema_version: CONTENT_SCHEMA_VERSION,
    source_created_at: draft.sourceCreatedAt ?? null,
    source_surface: draft.sourceSurface,
    source_updated_at: draft.sourceUpdatedAt ?? null,
    sync_batch_id: syncBatchId,
    title,
    user_id: userId,
    widget_id: draft.widgetId ?? null,
    widget_type: draft.widgetType ?? null,
  }
}

export function buildUserContentItems(): UserContentItemDraft[] {
  const data = useWidgetDataStore.getState()
  const widgetTitles = getWidgetTitles()
  const items: UserContentItemDraft[] = []

  for (const [widgetId, content] of Object.entries(data.notesByWidget)) {
    if (!content.trim()) continue
    items.push({
      body: content,
      contentKey: `note:${widgetId}`,
      contentType: 'note',
      metadata: { length: content.length, widgetTitle: widgetTitles.get(widgetId) ?? '便签' },
      objectId: widgetId,
      objectType: 'note',
      sourceSurface: 'widget',
      title: widgetTitles.get(widgetId) ?? '便签',
      widgetId,
      widgetType: 'notes',
    })
  }

  for (const [widgetId, document] of Object.entries(data.linedNotesByWidget)) {
    document.pages.forEach((page, index) => {
      if (!page.content.trim()) return
      items.push({
        body: page.content,
        contentKey: `lined_note:${widgetId}:${page.id}`,
        contentType: 'lined_note_page',
        metadata: {
          active: page.id === document.activePageId,
          length: page.content.length,
          pageIndex: index + 1,
          pageCount: document.pages.length,
          widgetTitle: widgetTitles.get(widgetId) ?? '格纸笔记',
        },
        objectId: page.id,
        objectType: 'lined_note_page',
        sourceSurface: 'widget',
        title: `${widgetTitles.get(widgetId) ?? '格纸笔记'} 第 ${index + 1} 页`,
        widgetId,
        widgetType: 'lined-notes',
      })
    })
  }

  for (const [widgetId, todos] of Object.entries(data.todosByWidget)) {
    todos.forEach((todo, index) => {
      items.push({
        body: todo.text,
        contentKey: `todo:${widgetId}:${todo.id}`,
        contentType: 'todo',
        metadata: {
          completed: todo.done,
          order: index,
          widgetTitle: widgetTitles.get(widgetId) ?? '待办事项',
        },
        objectId: todo.id,
        objectType: 'todo',
        sourceCreatedAt: toIsoFromMillis(todo.createdAt),
        sourceSurface: 'widget',
        title: todo.text,
        widgetId,
        widgetType: 'todo',
      })
    })
  }

  for (const [widgetId, tasks] of Object.entries(data.scheduledTasksByWidget)) {
    tasks.forEach((task, index) => {
      items.push({
        body: task.text,
        contentKey: `scheduled_task:${widgetId}:${task.id}`,
        contentType: 'scheduled_task',
        metadata: {
          completed: task.completed,
          completedAt: task.completedAt ?? null,
          dueDate: task.dueDate,
          order: index,
          widgetTitle: widgetTitles.get(widgetId) ?? '日程任务',
        },
        objectId: task.id,
        objectType: 'scheduled_task',
        sourceSurface: 'widget',
        sourceUpdatedAt: task.completedAt ?? null,
        title: task.text,
        widgetId,
        widgetType: 'scheduled-todo',
      })
    })
  }

  for (const [widgetId, habits] of Object.entries(data.habitsByWidget)) {
    habits.forEach((habit, index) => {
      items.push({
        body: habit.name,
        contentKey: `habit:${widgetId}:${habit.id}`,
        contentType: 'habit',
        metadata: {
          logDates: data.habitLogs[habit.id] ?? [],
          order: index,
          widgetTitle: widgetTitles.get(widgetId) ?? '习惯打卡',
        },
        objectId: habit.id,
        objectType: 'habit',
        sourceSurface: 'widget',
        title: habit.name,
        widgetId,
        widgetType: 'habits',
      })
    })
  }

  for (const [date, brief] of Object.entries(data.dailyBriefsByDate)) {
    items.push({
      body: `${brief.summary}\n\n${brief.recommendation}`.trim(),
      contentKey: `daily_brief:${date}`,
      contentType: 'daily_brief',
      metadata: {
        calendarConnected: brief.calendarConnected,
        date,
        sourceFingerprint: brief.sourceFingerprint,
      },
      objectId: date,
      objectType: 'daily_brief',
      sourceCreatedAt: brief.generatedAt,
      sourceSurface: 'widget',
      sourceUpdatedAt: brief.generatedAt,
      title: `每日简报 ${date}`,
      widgetType: 'daily-brief',
    })
  }

  for (const [date, events] of Object.entries(data.calendarEventsByDate)) {
    events.forEach((event) => {
      items.push({
        body: normalizeWhitespace([
          event.title,
          event.start,
          event.end,
          event.location,
        ].filter(Boolean).join(' ')),
        contentKey: `calendar_event:${date}:${event.id}`,
        contentType: 'calendar_event',
        metadata: {
          allDay: event.allDay,
          date,
          end: event.end,
          location: event.location ?? null,
          start: event.start,
        },
        objectId: event.id,
        objectType: 'calendar_event',
        sourceSurface: 'calendar',
        sourceUpdatedAt: event.start,
        title: event.title,
      })
    })
  }

  for (const conversation of Object.values(data.aiConversations)) {
    conversation.messages.forEach((message) => {
      items.push({
        body: message.content,
        contentKey: `ai_message:${conversation.id}:${message.id}`,
        contentType: 'ai_message',
        metadata: {
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          role: message.role,
        },
        objectId: message.id,
        objectType: 'ai_message',
        sourceCreatedAt: message.createdAt,
        sourceSurface: 'ai_chat',
        sourceUpdatedAt: message.createdAt,
        title: `${message.role === 'user' ? '用户' : message.role === 'assistant' ? 'AI' : '系统'}消息`,
      })
    })

    conversation.toolCalls.forEach((toolCall) => {
      items.push({
        body: `AI 调用工具：${toolCall.name}`,
        contentKey: `ai_tool_call:${conversation.id}:${toolCall.id}`,
        contentType: 'ai_tool_call',
        metadata: {
          args: toolCall.args,
          conversationId: conversation.id,
          result: toolCall.result,
          toolName: toolCall.name,
        },
        objectId: toolCall.id,
        objectType: 'ai_tool_call',
        sourceCreatedAt: toolCall.createdAt,
        sourceSurface: 'ai_chat',
        sourceUpdatedAt: toolCall.createdAt,
        title: `AI 工具调用：${toolCall.name}`,
      })
    })

    conversation.pendingActions.forEach((action) => {
      items.push({
        body: action.label,
        contentKey: `pending_action:${conversation.id}:${action.id}`,
        contentType: 'pending_action',
        metadata: {
          action,
          actionType: action.type,
          conversationId: conversation.id,
        },
        objectId: action.id,
        objectType: 'pending_action',
        sourceSurface: 'ai_chat',
        sourceUpdatedAt: conversation.updatedAt,
        title: action.label,
      })
    })
  }

  return items
}

export async function syncUserContentItems(
  userId: string,
  client: SupabaseLikeClient | null = supabase
): Promise<UserContentSyncResult> {
  if (!client) return { ok: false, synced: 0, error: 'Supabase 未配置' }

  const syncBatchId = makeSyncBatchId()
  const rows = buildUserContentItems().map((draft) => toRow(draft, userId, syncBatchId))

  if (rows.length > 0) {
    const { error } = await client
      .from('user_content_items')
      .upsert(rows, { onConflict: 'user_id,content_key' })

    if (error) {
      return { ok: false, synced: 0, error: error.message ?? '内容索引同步失败' }
    }
  }

  const { error: deleteError } = await client
    .from('user_content_items')
    .delete()
    .eq('user_id', userId)
    .neq('sync_batch_id', syncBatchId)

  if (deleteError) {
    return { ok: false, synced: rows.length, error: deleteError.message ?? '内容索引清理失败' }
  }

  return { ok: true, synced: rows.length }
}

