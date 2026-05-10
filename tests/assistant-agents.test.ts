import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as onBriefPost } from '../functions/api/ai/brief'
import { onRequestPost as onChatPost } from '../functions/api/ai/chat'
import { onRequestPost as onReflectionPost } from '../functions/api/ai/reflection'
import {
  classifyRouteHeuristically,
  runGeminiAgent,
} from '../functions/_shared/agents'

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

function ragSource() {
  return {
    body: '用户喜欢上午做深度工作。',
    metadata: { memory_type: 'work_habit' },
    similarity: 0.9,
    source_key: 'memory-1',
    source_type: 'assistant_memory',
    title: '上午深度工作',
  }
}

function contentItem() {
  return {
    body: '今天要完成 Alpha 任务。',
    content_hash: 'hash-alpha',
    content_key: 'scheduled_task:schedule-1:task-1',
    content_type: 'scheduled_task',
    id: 'content-1',
    metadata: { completed: false, dueDate: '2026-05-10' },
    object_id: 'task-1',
    object_type: 'scheduled_task',
    source_surface: 'widget',
    source_updated_at: '2026-05-10T00:00:00.000Z',
    title: 'Alpha Task',
    updated_at: '2026-05-10T00:00:00.000Z',
    widget_id: 'schedule-1',
    widget_type: 'scheduled-todo',
  }
}

function generateContentResponse(text: string) {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text }], role: 'model' } }],
  })
}

describe('assistant multi-agent routing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('classifies Chinese requests into dashboard, memory, and general routes', () => {
    expect(classifyRouteHeuristically('今天有哪些任务？').intent).toBe('dashboard_operation')
    expect(classifyRouteHeuristically('你记得我的工作习惯吗？').intent).toBe('memory_question')
    expect(classifyRouteHeuristically('解释一下什么是时间盒。').intent).toBe('general_answer')
  })

  it('routes dashboard operations to the only agent allowed to receive tools', async () => {
    const geminiBodies: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes(':embedContent')) return jsonResponse({ embedding: { values: embedding } })
      if (url.includes('/rpc/match_assistant_rag_chunks')) return jsonResponse([ragSource()])
      if (url.includes(':generateContent')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        geminiBodies.push(body)
        const serialized = JSON.stringify(body)
        if (serialized.includes('Orchestrator Agent')) {
          return generateContentResponse(JSON.stringify({
            confidence: 0.93,
            intent: 'dashboard_operation',
            reason: '用户询问今天任务。',
          }))
        }
        expect(serialized).toContain('必须先调用对应的读工具')
        return jsonResponse({
          candidates: [{
            content: {
              parts: [{
                functionCall: {
                  args: { includeCompleted: true },
                  name: 'list_scheduled_tasks',
                },
              }],
              role: 'model',
            },
          }],
        })
      }
      return jsonResponse({ error: `unexpected url ${url}` }, 500)
    })

    const response = await onChatPost({
      env,
      request: new Request('https://app.local/api/ai/chat', {
        body: JSON.stringify({
          clientDate: '2026-05-10',
          contents: [{ parts: [{ text: '今天有哪些任务？' }], role: 'user' }],
        }),
        headers: { authorization: 'Bearer token' },
        method: 'POST',
      }),
    })
    const result = await response.json()
    const answerCall = geminiBodies.find((body) => JSON.stringify(body).includes('dashboard_operator'))

    expect(response.status).toBe(200)
    expect(result.functionCalls[0].name).toBe('list_scheduled_tasks')
    expect(result.agent_trace.map((item: { role: string }) => item.role)).toEqual(
      expect.arrayContaining(['orchestrator', 'rag_retriever', 'policy_guard', 'dashboard_operator'])
    )
    expect(answerCall).toHaveProperty('tools')
  })

  it('routes memory questions without dashboard tools and only uses RAG context', async () => {
    const geminiBodies: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes(':embedContent')) return jsonResponse({ embedding: { values: embedding } })
      if (url.includes('/rpc/match_assistant_rag_chunks')) return jsonResponse([ragSource()])
      if (url.includes(':generateContent')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        geminiBodies.push(body)
        const serialized = JSON.stringify(body)
        if (serialized.includes('Orchestrator Agent')) {
          return generateContentResponse(JSON.stringify({
            confidence: 0.95,
            intent: 'memory_question',
            reason: '用户询问长期记忆。',
          }))
        }
        expect(serialized).toContain('Memory Agent')
        expect(serialized).toContain('上午深度工作')
        return generateContentResponse('我记得你偏好上午做深度工作。')
      }
      return jsonResponse({ error: `unexpected url ${url}` }, 500)
    })

    const response = await onChatPost({
      env,
      request: new Request('https://app.local/api/ai/chat', {
        body: JSON.stringify({
          clientDate: '2026-05-10',
          contents: [{ parts: [{ text: '你记得我的工作习惯吗？' }], role: 'user' }],
        }),
        headers: { authorization: 'Bearer token' },
        method: 'POST',
      }),
    })
    const result = await response.json()
    const answerCall = geminiBodies.find((body) => JSON.stringify(body).includes('memory_agent'))

    expect(response.status).toBe(200)
    expect(result.text).toContain('上午做深度工作')
    expect(result.agent_trace.map((item: { role: string }) => item.role)).toEqual(
      expect.arrayContaining(['orchestrator', 'rag_retriever', 'policy_guard', 'memory_agent'])
    )
    expect(answerCall).not.toHaveProperty('tools')
  })

  it('routes general answers without dashboard tools', async () => {
    const geminiBodies: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes(':embedContent')) return jsonResponse({ embedding: { values: embedding } })
      if (url.includes('/rpc/match_assistant_rag_chunks')) return jsonResponse([])
      if (url.includes('/user_assistant_rag_chunks')) return jsonResponse([])
      if (url.includes(':generateContent')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        geminiBodies.push(body)
        const serialized = JSON.stringify(body)
        if (serialized.includes('Orchestrator Agent')) {
          return generateContentResponse(JSON.stringify({
            confidence: 0.9,
            intent: 'general_answer',
            reason: '用户问一般概念。',
          }))
        }
        expect(serialized).toContain('通用回答分支')
        return generateContentResponse('时间盒是一种限制任务时间窗口的方法。')
      }
      return jsonResponse({ error: `unexpected url ${url}` }, 500)
    })

    const response = await onChatPost({
      env,
      request: new Request('https://app.local/api/ai/chat', {
        body: JSON.stringify({
          clientDate: '2026-05-10',
          contents: [{ parts: [{ text: '解释一下什么是时间盒。' }], role: 'user' }],
        }),
        headers: { authorization: 'Bearer token' },
        method: 'POST',
      }),
    })
    const result = await response.json()
    const answerCall = geminiBodies.find((body) => JSON.stringify(body).includes('orchestrator'))

    expect(response.status).toBe(200)
    expect(result.text).toContain('时间盒')
    expect(result.agent_trace.map((item: { role: string }) => item.role)).toContain('orchestrator')
    expect(answerCall).not.toHaveProperty('tools')
  })

  it('rejects dashboard tools for non-dashboard specialists', async () => {
    await expect(runGeminiAgent({
      contents: [{ parts: [{ text: 'hello' }], role: 'user' }],
      env,
      role: 'memory_agent',
      systemInstruction: 'memory',
      tools: [{ functionDeclarations: [] }],
    })).rejects.toThrow('not allowed to use dashboard tools')
  })
})

describe('assistant specialist traces', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns briefing agent trace with brief content and RAG sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes(':embedContent')) return jsonResponse({ embedding: { values: embedding } })
      if (url.includes('/rpc/match_assistant_rag_chunks')) return jsonResponse([ragSource()])
      if (url.includes(':generateContent')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(JSON.stringify(body)).toContain('briefing_agent')
        return generateContentResponse(JSON.stringify({
          recommendation: '先安排一段深度工作。',
          summary: '今天适合先处理重点。',
        }))
      }
      return jsonResponse({ error: `unexpected url ${url}` }, 500)
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
    expect(result.rag_sources[0].title).toBe('上午深度工作')
    expect(result.agent_trace.map((item: { role: string }) => item.role)).toEqual(
      expect.arrayContaining(['rag_retriever', 'policy_guard', 'briefing_agent'])
    )
  })

  it('returns reflection, memory curator, and RAG traces', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes('/user_behavior_events')) return jsonResponse([])
      if (url.includes('/user_content_items')) return jsonResponse([contentItem()])
      if (url.includes('/user_assistant_reflections?on_conflict=')) return jsonResponse(null, 201)
      if (url.includes('/user_assistant_reflections') && init?.method === 'PATCH') return jsonResponse(null)
      if (url.includes('/user_assistant_reflections') && url.includes('reflection_key=eq.')) return jsonResponse([])
      if (url.includes('/user_assistant_reflections')) return jsonResponse([])
      if (url.includes('/user_assistant_memories')) return jsonResponse([])
      if (url.includes('/user_assistant_rag_chunks') && init?.method === 'POST') return jsonResponse(null, 201)
      if (url.includes('/user_assistant_rag_chunks')) return jsonResponse([])
      if (url.includes('/rpc/match_assistant_rag_chunks')) return jsonResponse([ragSource()])
      if (url.includes(':embedContent')) return jsonResponse({ embedding: { values: embedding } })
      if (url.includes(':generateContent')) {
        const serialized = String(init?.body)
        if (serialized.includes('长期记忆提炼层')) {
          return generateContentResponse(JSON.stringify({ memories: [] }))
        }
        expect(serialized).toContain('reflection_agent')
        return generateContentResponse(JSON.stringify({
          completion_summary: '今天完成情况清楚。',
          priority_items: [],
          suggestions: ['保留深度工作窗口。'],
          summary: '今天的重点很集中。',
        }))
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
    expect(result.agent_trace.map((item: { role: string }) => item.role)).toEqual(
      expect.arrayContaining(['rag_retriever', 'reflection_agent', 'memory_curator', 'policy_guard'])
    )
  })
})
