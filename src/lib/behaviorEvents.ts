export type BehaviorEventActor = 'user' | 'assistant' | 'system'

export type BehaviorEventName =
  | 'ai.error'
  | 'ai.chat_cleared'
  | 'ai.message_sent'
  | 'ai.pending_actions_cancelled'
  | 'ai.pending_actions_confirmed'
  | 'ai.pending_actions_created'
  | 'ai.reply_received'
  | 'ai.tool_called'
  | 'assistant_reflection.error'
  | 'assistant_reflection.generated'
  | 'assistant_reflection.requested'
  | 'calendar.connect_requested'
  | 'calendar.embed_saved'
  | 'daily_brief.calendar_status_loaded'
  | 'daily_brief.error'
  | 'daily_brief.generated'
  | 'daily_brief.refresh_requested'
  | 'dashboard.background_changed'
  | 'dashboard.layout_updated'
  | 'dashboard.ui_visibility_changed'
  | 'dashboard.widget_added'
  | 'dashboard.widget_removed'
  | 'dashboard.widget_renamed'
  | 'habit.added'
  | 'habit.log_updated'
  | 'habit.removed'
  | 'habit.renamed'
  | 'music.playback_paused'
  | 'music.playback_started'
  | 'music.track_removed'
  | 'music.track_selected'
  | 'music.track_uploaded'
  | 'note.appended'
  | 'note.lined_page_added'
  | 'note.lined_page_deleted'
  | 'note.lined_page_selected'
  | 'note.lined_updated'
  | 'note.updated'
  | 'pomodoro.completed'
  | 'pomodoro.default_duration_changed'
  | 'pomodoro.dismissed'
  | 'pomodoro.focus_resumed'
  | 'pomodoro.notification_permission_changed'
  | 'pomodoro.rest_started'
  | 'pomodoro.setup_cancelled'
  | 'pomodoro.setup_opened'
  | 'pomodoro.started'
  | 'quick_link.added'
  | 'quick_link.opened'
  | 'quick_link.removed'
  | 'scheduled_task.added'
  | 'scheduled_task.moved'
  | 'scheduled_task.removed'
  | 'scheduled_task.toggled'
  | 'scheduled_task.updated'
  | 'todo.added'
  | 'todo.cleared_completed'
  | 'todo.marked_all_done'
  | 'todo.moved'
  | 'todo.removed'
  | 'todo.renamed'
  | 'todo.reordered'
  | 'todo.toggled'

export interface BehaviorEventDraft {
  actor?: BehaviorEventActor
  eventName: BehaviorEventName
  metadata?: Record<string, unknown>
  objectId?: string | null
  objectType?: string | null
  occurredAt?: string
  summary: string
  surface?: string
  widgetId?: string | null
  widgetType?: string | null
}

export interface QueuedBehaviorEvent {
  actor: BehaviorEventActor
  clientEventId: string
  eventName: BehaviorEventName
  metadata: Record<string, unknown>
  objectId: string | null
  objectType: string | null
  occurredAt: string
  schemaVersion: 1
  summary: string
  surface: string
  widgetId: string | null
  widgetType: string | null
}

export interface BehaviorEventContext {
  actor?: BehaviorEventActor
  surface?: string
}

export const BEHAVIOR_EVENT_QUEUE_KEY = 'primoria-behavior-events-queue.v1'
export const BEHAVIOR_EVENT_QUEUE_CHANGED = 'primoria:behavior-events-queue-changed'
export const BEHAVIOR_EVENT_SCHEMA_VERSION = 1
export const BEHAVIOR_EVENT_BATCH_SIZE = 50
export const BEHAVIOR_EVENT_FLUSH_DELAY_MS = 60_000
export const BEHAVIOR_EVENT_RETRY_INITIAL_DELAY_MS = 10_000
export const BEHAVIOR_EVENT_MAX_RETRY_DELAY_MS = 60_000

const MAX_QUEUE_SIZE = 1_000
const MAX_SUMMARY_LENGTH = 220
const MAX_METADATA_STRING_LENGTH = 180
const MAX_METADATA_ARRAY_LENGTH = 20
const MAX_METADATA_DEPTH = 4

let suppressionDepth = 0
let contextStack: BehaviorEventContext[] = []

function canUseLocalStorage() {
  return typeof localStorage !== 'undefined'
}

function makeEventId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `evt-${crypto.randomUUID()}`
  }
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function dispatchQueueChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(BEHAVIOR_EVENT_QUEUE_CHANGED))
}

function readRawQueue(): QueuedBehaviorEvent[] {
  if (!canUseLocalStorage()) return []
  try {
    const raw = localStorage.getItem(BEHAVIOR_EVENT_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isQueuedBehaviorEvent)
  } catch {
    return []
  }
}

function writeRawQueue(events: QueuedBehaviorEvent[]) {
  if (!canUseLocalStorage()) return
  try {
    localStorage.setItem(BEHAVIOR_EVENT_QUEUE_KEY, JSON.stringify(events.slice(-MAX_QUEUE_SIZE)))
    dispatchQueueChanged()
  } catch {
    return
  }
}

function isQueuedBehaviorEvent(value: unknown): value is QueuedBehaviorEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<QueuedBehaviorEvent>
  return (
    typeof event.clientEventId === 'string' &&
    typeof event.eventName === 'string' &&
    typeof event.occurredAt === 'string' &&
    typeof event.summary === 'string'
  )
}

function activeContext() {
  return contextStack.reduce<BehaviorEventContext>(
    (merged, item) => ({ ...merged, ...item }),
    {}
  )
}

export function withBehaviorEventContext<T>(context: BehaviorEventContext, fn: () => T): T {
  contextStack = [...contextStack, context]
  try {
    return fn()
  } finally {
    contextStack = contextStack.slice(0, -1)
  }
}

export function withBehaviorTrackingSuppressed<T>(fn: () => T): T {
  suppressionDepth += 1
  try {
    return fn()
  } finally {
    suppressionDepth = Math.max(0, suppressionDepth - 1)
  }
}

export function summarizeText(value: string, maxLength = 80) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

export function getDomainFromUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}

function sanitizeSummary(summary: string) {
  return summarizeText(summary, MAX_SUMMARY_LENGTH)
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (depth > MAX_METADATA_DEPTH) return '[max-depth]'
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `[data-url:${value.length}]`
    if (/^https?:\/\//i.test(value)) return '[url]'
    return summarizeText(value, MAX_METADATA_STRING_LENGTH)
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ARRAY_LENGTH)
      .map((item) => sanitizeMetadataValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 40)
    return Object.fromEntries(
      entries.map(([key, item]) => {
        const lower = key.toLowerCase()
        if (lower.includes('url') || lower.includes('href')) {
          if (typeof item === 'string' && item.startsWith('data:')) {
            return [key, sanitizeMetadataValue(item, depth + 1)]
          }
          return [key, '[url]']
        }
        if (lower.includes('embed') || lower.includes('iframe') || lower.includes('html')) {
          return [key, '[html]']
        }
        if (lower.includes('token') || lower.includes('secret')) return [key, '[redacted]']
        return [key, sanitizeMetadataValue(item, depth + 1)]
      })
    )
  }
  return String(value)
}

export function sanitizeBehaviorMetadata(metadata: Record<string, unknown> = {}) {
  return sanitizeMetadataValue(metadata, 0) as Record<string, unknown>
}

export function getQueuedBehaviorEvents() {
  return readRawQueue()
}

export function replaceQueuedBehaviorEvents(events: QueuedBehaviorEvent[]) {
  writeRawQueue(events)
}

export function trackBehaviorEvent(draft: BehaviorEventDraft): QueuedBehaviorEvent | null {
  if (suppressionDepth > 0) return null

  const context = activeContext()
  const event: QueuedBehaviorEvent = {
    actor: draft.actor ?? context.actor ?? 'user',
    clientEventId: makeEventId(),
    eventName: draft.eventName,
    metadata: sanitizeBehaviorMetadata(draft.metadata),
    objectId: draft.objectId ?? null,
    objectType: draft.objectType ?? null,
    occurredAt: draft.occurredAt ?? new Date().toISOString(),
    schemaVersion: BEHAVIOR_EVENT_SCHEMA_VERSION,
    summary: sanitizeSummary(draft.summary),
    surface: draft.surface ?? context.surface ?? 'dashboard',
    widgetId: draft.widgetId ?? null,
    widgetType: draft.widgetType ?? null,
  }

  writeRawQueue([...readRawQueue(), event])
  return event
}

export function removeQueuedBehaviorEvents(clientEventIds: Set<string>) {
  const remaining = readRawQueue().filter((event) => !clientEventIds.has(event.clientEventId))
  writeRawQueue(remaining)
}
