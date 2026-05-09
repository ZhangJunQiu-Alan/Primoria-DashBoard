import {
  BEHAVIOR_EVENT_BATCH_SIZE,
  getQueuedBehaviorEvents,
  removeQueuedBehaviorEvents,
  type QueuedBehaviorEvent,
} from '@/lib/behaviorEvents'
import { supabase } from '@/lib/supabase'

interface SupabaseLikeClient {
  from: (table: string) => {
    upsert: (
      rows: Record<string, unknown>[],
      options: { ignoreDuplicates: boolean; onConflict: string }
    ) => PromiseLike<{ error: { message?: string } | null }>
  }
}

export interface BehaviorEventFlushResult {
  error: string | null
  flushed: number
  ok: boolean
  remaining: number
}

function toRow(userId: string, event: QueuedBehaviorEvent) {
  return {
    actor: event.actor,
    client_event_id: event.clientEventId,
    event_name: event.eventName,
    metadata: event.metadata,
    object_id: event.objectId,
    object_type: event.objectType,
    occurred_at: event.occurredAt,
    schema_version: event.schemaVersion,
    summary: event.summary,
    surface: event.surface,
    user_id: userId,
    widget_id: event.widgetId,
    widget_type: event.widgetType,
  }
}

function getUniqueBatch(events: QueuedBehaviorEvent[]) {
  const seen = new Set<string>()
  const batch: QueuedBehaviorEvent[] = []

  for (const event of events) {
    if (seen.has(event.clientEventId)) continue
    seen.add(event.clientEventId)
    batch.push(event)
    if (batch.length >= BEHAVIOR_EVENT_BATCH_SIZE) break
  }

  return batch
}

let flushing = false

export async function flushBehaviorEventQueue(
  userId: string,
  client: SupabaseLikeClient | null = supabase
): Promise<BehaviorEventFlushResult> {
  if (!client || flushing) {
    const remaining = getQueuedBehaviorEvents().length
    return { error: null, flushed: 0, ok: Boolean(client), remaining }
  }

  const queue = getQueuedBehaviorEvents()
  const batch = getUniqueBatch(queue)
  if (batch.length === 0) {
    return { error: null, flushed: 0, ok: true, remaining: 0 }
  }

  flushing = true
  try {
    const rows = batch.map((event) => toRow(userId, event))
    const { error } = await client
      .from('user_behavior_events')
      .upsert(rows, {
        ignoreDuplicates: true,
        onConflict: 'user_id,client_event_id',
      })

    if (error) {
      return {
        error: error.message ?? '行为事件同步失败',
        flushed: 0,
        ok: false,
        remaining: queue.length,
      }
    }

    removeQueuedBehaviorEvents(new Set(batch.map((event) => event.clientEventId)))
    return {
      error: null,
      flushed: batch.length,
      ok: true,
      remaining: getQueuedBehaviorEvents().length,
    }
  } finally {
    flushing = false
  }
}
