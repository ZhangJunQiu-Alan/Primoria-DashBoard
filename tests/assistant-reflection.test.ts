import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../functions/api/ai/reflection'
import {
  buildReflectionPrompt,
  buildSourceFingerprint,
  getReflectionPeriod,
  mergeLlmReflection,
  scorePriorityItems,
  type BehaviorEventRow,
  type ContentItemRow,
} from '../functions/_shared/reflection'

function contentItem(overrides: Partial<ContentItemRow>): ContentItemRow {
  return {
    body: '测试内容',
    content_hash: 'hash',
    content_key: 'scheduled_task:schedule-1:task-1',
    content_type: 'scheduled_task',
    metadata: {},
    object_id: 'task-1',
    object_type: 'scheduled_task',
    source_surface: 'widget',
    source_updated_at: null,
    title: '测试任务',
    updated_at: '2026-05-10T00:00:00.000Z',
    widget_id: 'schedule-1',
    widget_type: 'scheduled-todo',
    ...overrides,
  }
}

function behaviorEvent(overrides: Partial<BehaviorEventRow>): BehaviorEventRow {
  return {
    actor: 'user',
    event_name: 'scheduled_task.moved',
    metadata: {},
    object_id: 'task-1',
    object_type: 'scheduled_task',
    occurred_at: '2026-05-10T01:00:00.000Z',
    summary: '移动日程任务：测试任务',
    surface: 'widget',
    widget_id: 'schedule-1',
    widget_type: 'scheduled-todo',
    ...overrides,
  }
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

describe('assistant reflection rules', () => {
  it('calculates daily and weekly periods with Monday as week start', () => {
    const daily = getReflectionPeriod('daily', '2026-05-10')
    const weekly = getReflectionPeriod('weekly', '2026-05-10')

    expect(daily).toMatchObject({
      periodEnd: '2026-05-10',
      periodStart: '2026-05-10',
      reflectionKey: 'daily:2026-05-10',
    })
    expect(weekly).toMatchObject({
      periodEnd: '2026-05-10',
      periodStart: '2026-05-04',
      reflectionKey: 'weekly:2026-05-04',
    })
  })

  it('scores overdue, due, pending, and completed items with expected priority signals', () => {
    const period = getReflectionPeriod('daily', '2026-05-10')
    const items = [
      contentItem({
        content_key: 'scheduled_task:schedule-1:overdue',
        metadata: { completed: false, dueDate: '2026-05-09' },
        object_id: 'overdue',
        title: '逾期任务',
      }),
      contentItem({
        content_key: 'scheduled_task:schedule-1:today',
        metadata: { completed: false, dueDate: '2026-05-10' },
        object_id: 'today',
        title: '今天任务',
      }),
      contentItem({
        content_key: 'pending_action:default:action-1',
        content_type: 'pending_action',
        metadata: { actionType: 'moveScheduledTasks' },
        object_id: 'action-1',
        title: '等待确认移动任务',
      }),
      contentItem({
        content_key: 'scheduled_task:schedule-1:done',
        metadata: { completed: true, dueDate: '2026-05-10' },
        object_id: 'done',
        title: '已完成任务',
      }),
    ]
    const events = [
      behaviorEvent({ object_id: 'overdue' }),
      behaviorEvent({ object_id: 'overdue', occurred_at: '2026-05-10T02:00:00.000Z' }),
    ]

    const scored = scorePriorityItems(items, events, period)
    const overdue = scored.find((item) => item.content_key.includes('overdue'))
    const pending = scored.find((item) => item.content_type === 'pending_action')
    const completed = scored.find((item) => item.content_key.includes('done'))

    expect(scored[0].content_key).toContain('overdue')
    expect(overdue?.signals).toEqual(expect.arrayContaining(['已逾期', '多次移动或推迟']))
    expect(overdue?.importance_score).toBeGreaterThanOrEqual(90)
    expect(pending?.signals).toContain('等待用户确认')
    expect(completed?.urgency_score ?? 0).toBeLessThan(50)
  })

  it('keeps reflection context compact and sanitized', () => {
    const period = getReflectionPeriod('daily', '2026-05-10')
    const contentItems = [
      contentItem({
        body: '图片 data:image/png;base64,abcdef <iframe src="https://calendar.google.com"></iframe> https://example.com/a?token=secret',
        content_key: 'note:notes-1',
        content_type: 'note',
        object_id: 'notes-1',
        title: '敏感片段',
      }),
    ]
    const context = { contentItems, events: [], period, periodType: 'daily' as const }
    const prompt = buildReflectionPrompt(context, {
      ...mergeLlmReflection('{}', {
        cached: false,
        completion_summary: '',
        evidence: [],
        generated_at: '2026-05-10T00:00:00.000Z',
        habit_signals: [],
        model: null,
        period_end: period.periodEnd,
        period_start: period.periodStart,
        period_type: 'daily',
        priority_items: [],
        reflection_key: period.reflectionKey,
        schema_version: 1,
        source_fingerprint: buildSourceFingerprint(context),
        suggestions: [],
        summary: '',
      }, null),
    })

    expect(prompt).not.toContain('data:image')
    expect(prompt).not.toContain('<iframe')
    expect(prompt).not.toContain('token=secret')
    expect(prompt).toContain('[data-url]')
    expect(prompt).toContain('[iframe]')
    expect(prompt).toContain('[signed-url]')
  })

  it('falls back to rule output when LLM JSON is invalid or hallucinated', () => {
    const period = getReflectionPeriod('daily', '2026-05-10')
    const fallback = {
      cached: false,
      completion_summary: '规则完成总结',
      evidence: [],
      generated_at: '2026-05-10T00:00:00.000Z',
      habit_signals: [],
      model: null,
      period_end: period.periodEnd,
      period_start: period.periodStart,
      period_type: 'daily' as const,
      priority_items: [{
        confidence: 0.8,
        content_key: 'scheduled_task:schedule-1:task-1',
        content_type: 'scheduled_task',
        importance_score: 80,
        object_id: 'task-1',
        reason: '规则原因',
        signals: ['本周期到期'],
        suggested_next_action: '先推进一次。',
        title: '测试任务',
        urgency_score: 70,
        widget_id: 'schedule-1',
      }],
      reflection_key: period.reflectionKey,
      schema_version: 1 as const,
      source_fingerprint: 'fingerprint',
      suggestions: ['规则建议'],
      summary: '规则总结',
    }

    expect(mergeLlmReflection('not json', fallback, 'gemini-test').summary).toBe('规则总结')
    expect(mergeLlmReflection(
      JSON.stringify({ priority_items: [{ content_key: 'fake:key', importance_score: 100 }] }),
      fallback,
      'gemini-test'
    ).priority_items[0].content_key).toBe('scheduled_task:schedule-1:task-1')
  })
})

describe('assistant reflection API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('upserts generated reflection rows and returns cached rows when source fingerprint is unchanged', async () => {
    const period = getReflectionPeriod('daily', '2026-05-10')
    const events = [behaviorEvent({})]
    const contentItems = [contentItem({ metadata: { completed: false, dueDate: '2026-05-10' } })]
    const sourceFingerprint = buildSourceFingerprint({
      contentItems,
      events,
      period,
      periodType: 'daily',
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes('/user_behavior_events')) return jsonResponse(events)
      if (url.includes('/user_content_items')) return jsonResponse(contentItems)
      if (url.includes('/user_assistant_reflections?') && init?.method !== 'POST') {
        return jsonResponse([])
      }
      if (url.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({
          candidates: [{
            content: {
              role: 'model',
              parts: [{
                text: JSON.stringify({
                  completion_summary: '今天完成情况清楚，还有一个任务要推进。',
                  priority_items: [{
                    content_key: 'scheduled_task:schedule-1:task-1',
                    importance_score: 88,
                    reason: '今天到期。',
                    urgency_score: 82,
                  }],
                  suggestions: ['先完成测试任务。'],
                  summary: '今天的重点很集中。',
                }),
              }],
            },
          }],
        })
      }
      if (url.includes('/user_assistant_reflections?on_conflict=')) {
        expect(init?.method).toBe('POST')
        expect(String(init?.body)).toContain('今天的重点很集中')
        return jsonResponse(null, 201)
      }
      return jsonResponse({ error: 'unexpected url' }, 500)
    })

    const response = await onRequestPost({
      env: {
        GEMINI_API_KEY: 'gemini-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        SUPABASE_URL: 'https://example.supabase.co',
      },
      request: new Request('https://app.local/api/ai/reflection', {
        body: JSON.stringify({
          date: '2026-05-10',
          periodType: 'daily',
          timeMax: period.timeMax,
          timeMin: period.timeMin,
        }),
        headers: { authorization: 'Bearer user-token' },
        method: 'POST',
      }),
    })

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.summary).toBe('今天的重点很集中。')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('generativelanguage.googleapis.com'),
      expect.anything()
    )

    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes('/user_behavior_events')) return jsonResponse(events)
      if (url.includes('/user_content_items')) return jsonResponse(contentItems)
      if (url.includes('/user_assistant_reflections?') && init?.method !== 'POST') {
        return jsonResponse([{
          completion_summary: 'cached completion',
          evidence: [],
          generated_at: '2026-05-10T00:00:00.000Z',
          habit_signals: [],
          model: 'gemini-test',
          period_end: period.periodEnd,
          period_start: period.periodStart,
          period_type: 'daily',
          priority_items: [],
          reflection_key: period.reflectionKey,
          schema_version: 1,
          source_fingerprint: sourceFingerprint,
          suggestions: [],
          summary: 'cached summary',
        }])
      }
      if (url.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({ error: 'should not call gemini' }, 500)
      }
      return jsonResponse(null, 201)
    })

    const cachedResponse = await onRequestPost({
      env: {
        GEMINI_API_KEY: 'gemini-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        SUPABASE_URL: 'https://example.supabase.co',
      },
      request: new Request('https://app.local/api/ai/reflection', {
        body: JSON.stringify({ date: '2026-05-10', periodType: 'daily' }),
        headers: { authorization: 'Bearer user-token' },
        method: 'POST',
      }),
    })
    const cachedResult = await cachedResponse.json()
    expect(cachedResult).toMatchObject({ cached: true, summary: 'cached summary' })
  })
})
