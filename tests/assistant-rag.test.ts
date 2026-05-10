import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as onBriefPost } from '../functions/api/ai/brief'
import { onRequestPost as onChatPost } from '../functions/api/ai/chat'
import { onRequestPost as onRagIndexPost } from '../functions/api/ai/rag/index'
import { onRequestPost as onReflectionPost } from '../functions/api/ai/reflection'
import {
  buildRagChunkDraft,
  indexAssistantRag,
  retrieveAssistantRag,
} from '../functions/_shared/rag'

const env = {
  GEMINI_API_KEY: 'gemini-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_URL: 'https://example.supabase.co',
}

const embedding = Array.from({ length: 768 }, () => 0.01)

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

function contentItem(overrides: Record<string, unknown> = {}) {
  return {
    body: 'Alpha task body',
    content_hash: 'hash-alpha',
    content_key: 'scheduled_task:schedule-1:task-1',
    content_type: 'scheduled_task',
    id: 'content-1',
    metadata: { dueDate: '2026-05-10' },
    object_id: 'task-1',
    object_type: 'scheduled_task',
    source_surface: 'widget',
    source_updated_at: '2026-05-10T00:00:00.000Z',
    title: 'Alpha Task',
    updated_at: '2026-05-10T00:00:00.000Z',
    widget_id: 'schedule-1',
    widget_type: 'scheduled-todo',
    ...overrides,
  }
}

function ragSource(overrides: Record<string, unknown> = {}) {
  return {
    body: 'User prefers deep work in the morning.',
    metadata: { memory_type: 'work_habit' },
    similarity: 0.91,
    source_key: 'memory-1',
    source_type: 'assistant_memory',
    title: 'Morning Deep Work',
    ...overrides,
  }
}

describe('assistant RAG helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds sanitized chunks without data URLs, iframes, or signed URLs', () => {
    const chunk = buildRagChunkDraft({
      body:
        'Image data:image/png;base64,abcdef <iframe src="https://calendar.google.com"></iframe> https://example.com/file?signature=secret',
      id: 'content-1',
      metadata: { url: 'https://example.com/file?token=secret' },
      source_key: 'note:1',
      source_type: 'content_item',
      title: 'Sensitive chunk',
    })

    expect(chunk.body).not.toContain('data:image')
    expect(chunk.body).not.toContain('<iframe')
    expect(chunk.body).not.toContain('signature=secret')
    expect(JSON.stringify(chunk.metadata)).not.toContain('token=secret')
    expect(chunk.body).toContain('[data-url]')
    expect(chunk.body).toContain('[iframe]')
    expect(chunk.body).toContain('[signed-url]')
  })

  it('does not regenerate embeddings when content_hash is unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/user_content_items')) return jsonResponse([contentItem()])
      if (url.includes('/user_assistant_rag_chunks')) {
        return jsonResponse([{
          content_hash: 'hash-alpha',
          id: 'chunk-1',
          source_key: 'scheduled_task:schedule-1:task-1',
          source_type: 'content_item',
        }])
      }
      if (url.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({ error: 'embedding should not be called' }, 500)
      }
      return jsonResponse({ error: 'unexpected url' }, 500)
    })

    const result = await indexAssistantRag({
      env,
      sourceTypes: ['content_item'],
      userId: 'user-1',
    })

    expect(result).toEqual({ indexed: 0, remaining: 0, skipped: 1, staleDeleted: 0 })
  })

  it('cleans stale chunks for the requested source types', async () => {
    const deleted: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/user_content_items')) return jsonResponse([])
      if (url.includes('/user_assistant_rag_chunks') && init?.method === 'DELETE') {
        deleted.push(url)
        return jsonResponse(null)
      }
      if (url.includes('/user_assistant_rag_chunks')) {
        return jsonResponse([{
          content_hash: 'old-hash',
          id: 'stale-chunk',
          source_key: 'note:deleted',
          source_type: 'content_item',
        }])
      }
      return jsonResponse({ error: 'unexpected url' }, 500)
    })

    const result = await indexAssistantRag({
      env,
      sourceTypes: ['content_item'],
      userId: 'user-1',
    })

    expect(result.staleDeleted).toBe(1)
    expect(deleted[0]).toContain('id=in.%28stale-chunk%29')
  })

  it('falls back to text search when embedding retrieval fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({ error: { message: 'embedding down' } }, 500)
      }
      if (url.includes('/user_assistant_rag_chunks')) return jsonResponse([ragSource()])
      return jsonResponse({ error: 'unexpected url' }, 500)
    })

    const result = await retrieveAssistantRag({
      env,
      query: 'morning',
      userId: 'user-1',
    })

    expect(result.ragSources).toHaveLength(1)
    expect(result.ragSources[0].similarity).toBe(0.5)
    expect(result.ragContext).toContain('Morning Deep Work')
  })
})

describe('assistant RAG API and injection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('indexes only the authenticated user through the RAG index route', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes('/user_content_items')) {
        expect(url).toContain('user_id=eq.user-1')
        return jsonResponse([])
      }
      if (url.includes('/user_assistant_rag_chunks')) {
        expect(url).toContain('user_id=eq.user-1')
        return jsonResponse([])
      }
      return jsonResponse({ error: 'unexpected url' }, 500)
    })

    const response = await onRagIndexPost({
      env,
      request: new Request('https://app.local/api/ai/rag/index', {
        body: JSON.stringify({ sourceTypes: ['content_item'] }),
        headers: { authorization: 'Bearer token' },
        method: 'POST',
      }),
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.indexed).toBe(0)
  })

  it('injects RAG context into chat and returns sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes(':embedContent')) return jsonResponse({ embedding: { values: embedding } })
      if (url.includes('/rpc/match_assistant_rag_chunks')) return jsonResponse([ragSource()])
      if (url.includes(':generateContent')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(JSON.stringify(body.systemInstruction)).toContain('Morning Deep Work')
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: '已参考长期记忆。' }], role: 'model' } }],
        })
      }
      return jsonResponse({ error: 'unexpected url' }, 500)
    })

    const response = await onChatPost({
      env,
      request: new Request('https://app.local/api/ai/chat', {
        body: JSON.stringify({
          contents: [{ parts: [{ text: '今天怎么安排深度工作？' }], role: 'user' }],
          clientDate: '2026-05-10',
        }),
        headers: { authorization: 'Bearer token' },
        method: 'POST',
      }),
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.text).toBe('已参考长期记忆。')
    expect(result.rag_sources[0].title).toBe('Morning Deep Work')
  })

  it('injects RAG context into daily brief and returns sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes(':embedContent')) return jsonResponse({ embedding: { values: embedding } })
      if (url.includes('/rpc/match_assistant_rag_chunks')) return jsonResponse([ragSource()])
      if (url.includes(':generateContent')) {
        const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> }
        const prompt = body.contents[0].parts[0].text
        expect(prompt).toContain('rag_context')
        expect(prompt).toContain('Morning Deep Work')
        return jsonResponse({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify({ recommendation: '先安排一段深度工作。', summary: '今天适合先处理重点。' }) }],
              role: 'model',
            },
          }],
        })
      }
      return jsonResponse({ error: 'unexpected url' }, 500)
    })

    const response = await onBriefPost({
      env,
      request: new Request('https://app.local/api/ai/brief', {
        body: JSON.stringify({ context: { scheduledTasks: [] }, date: '2026-05-10' }),
        headers: { authorization: 'Bearer token' },
        method: 'POST',
      }),
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.summary).toBe('今天适合先处理重点。')
    expect(result.rag_sources[0].source_type).toBe('assistant_memory')
  })

  it('injects RAG context into reflection and returns sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes('/user_behavior_events')) return jsonResponse([])
      if (url.includes('/user_content_items')) return jsonResponse([contentItem()])
      if (url.includes('/user_assistant_reflections?on_conflict=')) return jsonResponse(null, 201)
      if (url.includes('/user_assistant_reflections') && init?.method === 'PATCH') return jsonResponse(null, 204)
      if (url.includes('/user_assistant_reflections') && url.includes('reflection_key=eq.')) return jsonResponse([])
      if (url.includes('/user_assistant_reflections')) {
        return jsonResponse([{
          body: 'Alpha reflection body',
          completion_summary: '完成情况稳定。',
          evidence: [],
          generated_at: '2026-05-10T00:00:00.000Z',
          habit_signals: [],
          id: 'reflection-1',
          model: 'gemini-test',
          period_end: '2026-05-10',
          period_start: '2026-05-10',
          period_type: 'daily',
          priority_items: [],
          reflection_key: 'daily:2026-05-10',
          schema_version: 1,
          source_fingerprint: 'fingerprint',
          suggestions: [],
          summary: '已生成反思。',
          updated_at: '2026-05-10T00:00:00.000Z',
        }])
      }
      if (url.includes('/user_assistant_memories')) return jsonResponse([])
      if (url.includes('/user_assistant_rag_chunks') && init?.method === 'POST') return jsonResponse(null, 201)
      if (url.includes('/user_assistant_rag_chunks')) return jsonResponse([])
      if (url.includes('/rpc/match_assistant_rag_chunks')) return jsonResponse([ragSource()])
      if (url.includes(':embedContent')) return jsonResponse({ embedding: { values: embedding } })
      if (url.includes(':generateContent')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        const serialized = JSON.stringify(body)
        if (serialized.includes('长期记忆提炼层')) {
          return jsonResponse({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ memories: [] }) }], role: 'model' } }],
          })
        }
        expect(serialized).toContain('rag_context')
        expect(serialized).toContain('Morning Deep Work')
        return jsonResponse({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  completion_summary: '今天完成情况清楚。',
                  priority_items: [],
                  suggestions: ['保留深度工作窗口。'],
                  summary: '今天的重点很集中。',
                }),
              }],
              role: 'model',
            },
          }],
        })
      }
      return jsonResponse({ error: `unexpected url ${url}` }, 500)
    })

    const response = await onReflectionPost({
      env,
      request: new Request('https://app.local/api/ai/reflection', {
        body: JSON.stringify({ date: '2026-05-10', periodType: 'daily' }),
        headers: { authorization: 'Bearer token' },
        method: 'POST',
      }),
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.summary).toBe('今天的重点很集中。')
    expect(result.rag_sources[0].title).toBe('Morning Deep Work')
  })
})
