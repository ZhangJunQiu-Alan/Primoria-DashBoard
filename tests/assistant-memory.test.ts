import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestDelete, onRequestGet, onRequestPatch } from '../functions/api/ai/memories'
import {
  buildMemoryExtractionPrompt,
  buildMemoryMutations,
  extractAssistantMemories,
  parseMemoryExtractionResponse,
  type AssistantMemoryRow,
} from '../functions/_shared/memory'
import type { AssistantReflectionResult } from '../functions/_shared/reflection'

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

function reflection(overrides: Partial<AssistantReflectionResult> = {}): AssistantReflectionResult {
  return {
    completion_summary: '今天完成情况稳定。',
    evidence: [{ note: '测试证据' }],
    generated_at: '2026-05-10T00:00:00.000Z',
    habit_signals: [],
    model: 'gemini-test',
    period_end: '2026-05-10',
    period_start: '2026-05-10',
    period_type: 'daily',
    priority_items: [],
    reflection_key: 'daily:2026-05-10',
    schema_version: 1,
    source_fingerprint: 'fingerprint-1',
    suggestions: ['先处理最重要的任务。'],
    summary: '今天适合提炼长期记忆。',
    ...overrides,
  }
}

function memory(overrides: Partial<AssistantMemoryRow> = {}): AssistantMemoryRow {
  return {
    body: '用户常在上午处理高优先级任务。',
    confidence: 0.82,
    created_at: '2026-05-09T00:00:00.000Z',
    evidence: [],
    id: 'memory-1',
    last_seen_at: '2026-05-09T00:00:00.000Z',
    memory_type: 'work_habit',
    schema_version: 1,
    scope: 'global',
    source_reflection_keys: ['daily:2026-05-09'],
    title: '上午处理重点任务',
    updated_at: '2026-05-09T00:00:00.000Z',
    user_modified_at: null,
    ...overrides,
  }
}

const env = {
  GEMINI_API_KEY: 'gemini-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_URL: 'https://example.supabase.co',
}

describe('assistant memory extraction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps memory extraction prompt sanitized', () => {
    const prompt = buildMemoryExtractionPrompt(
      reflection({
        summary:
          '图片 data:image/png;base64,abcdef <iframe src="https://calendar.google.com"></iframe> https://example.com/a?token=secret',
      }),
      [
        memory({
          body: '旧记忆 https://example.com/a?signature=secret',
        }),
      ]
    )

    expect(prompt).not.toContain('data:image')
    expect(prompt).not.toContain('<iframe')
    expect(prompt).not.toContain('token=secret')
    expect(prompt).not.toContain('signature=secret')
    expect(prompt).toContain('[data-url]')
    expect(prompt).toContain('[iframe]')
    expect(prompt).toContain('[signed-url]')
  })

  it('skips invalid JSON and low confidence memory candidates', () => {
    const invalid = parseMemoryExtractionResponse('not json', [])
    expect(invalid.candidates).toHaveLength(0)
    expect(invalid.skipped).toBe(1)

    const lowConfidence = parseMemoryExtractionResponse(
      JSON.stringify({
        memories: [{
          body: '证据不足的偏好。',
          confidence: 0.4,
          memory_type: 'user_preference',
          operation: 'create',
          scope: 'global',
          title: '低置信度偏好',
        }],
      }),
      []
    )
    const mutations = buildMemoryMutations({
      candidates: lowConfidence.candidates,
      existingMemories: [],
      now: '2026-05-10T01:00:00.000Z',
      reflection: reflection(),
      skipped: lowConfidence.skipped,
      userId: 'user-1',
    })

    expect(mutations.createRows).toHaveLength(0)
    expect(mutations.updateRows).toHaveLength(0)
    expect(mutations.skipped).toBe(1)
  })

  it('does not overwrite user edited memory text during automatic extraction', () => {
    const existing = memory({
      body: '用户手动保留的内容。',
      title: '用户手动标题',
      user_modified_at: '2026-05-10T00:30:00.000Z',
    })
    const parsed = parseMemoryExtractionResponse(
      JSON.stringify({
        memories: [{
          body: 'AI 想覆盖的内容。',
          confidence: 0.92,
          evidence: [{ note: '新证据' }],
          id: existing.id,
          memory_type: 'work_habit',
          operation: 'update',
          scope: 'global',
          title: 'AI 想覆盖的标题',
        }],
      }),
      [existing]
    )
    const mutations = buildMemoryMutations({
      candidates: parsed.candidates,
      existingMemories: [existing],
      now: '2026-05-10T01:00:00.000Z',
      reflection: reflection(),
      skipped: parsed.skipped,
      userId: 'user-1',
    })

    expect(mutations.updateRows).toHaveLength(1)
    expect(mutations.updateRows[0].row).not.toHaveProperty('body')
    expect(mutations.updateRows[0].row).not.toHaveProperty('title')
    expect(mutations.updateRows[0].row.source_reflection_keys).toContain('daily:2026-05-10')
    expect(mutations.updateRows[0].row.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ note: '新证据' })])
    )
  })

  it('does not call Gemini again when the reflection fingerprint was already extracted', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}))

    const result = await extractAssistantMemories({
      env,
      reflection: reflection({
        memory_extracted_at: '2026-05-10T01:00:00.000Z',
        memory_source_fingerprint: 'fingerprint-1',
      }),
      userId: 'user-1',
    })

    expect(result).toEqual({ created: 0, extracted: false, skipped: 0, updated: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('assistant memories API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads memories through the authenticated user filter', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes('/user_assistant_memories')) {
        expect(url).toContain('user_id=eq.user-1')
        return jsonResponse([memory()])
      }
      return jsonResponse({ error: 'unexpected url' }, 500)
    })

    const response = await onRequestGet({
      env,
      request: new Request('https://app.local/api/ai/memories', {
        headers: { authorization: 'Bearer token' },
      }),
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.memories[0].id).toBe('memory-1')
  })

  it('updates and deletes memories only through the authenticated user filter', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' })
      if (url.includes('/user_assistant_memories') && init?.method === 'PATCH') {
        expect(url).toContain('id=eq.memory-1')
        expect(url).toContain('user_id=eq.user-1')
        expect(String(init.body)).toContain('user_modified_at')
        return jsonResponse([memory({ body: '用户更新后的内容。' })])
      }
      if (url.includes('/user_assistant_memories') && init?.method === 'DELETE') {
        expect(url).toContain('id=eq.memory-1')
        expect(url).toContain('user_id=eq.user-1')
        return jsonResponse(null)
      }
      return jsonResponse({ error: 'unexpected url' }, 500)
    })

    const patchResponse = await onRequestPatch({
      env,
      request: new Request('https://app.local/api/ai/memories', {
        body: JSON.stringify({
          body: '用户更新后的内容。',
          id: 'memory-1',
          memory_type: 'work_habit',
          scope: 'global',
          title: '上午处理重点任务',
        }),
        headers: { authorization: 'Bearer token' },
        method: 'PATCH',
      }),
    })
    const patchResult = await patchResponse.json()
    expect(patchResponse.status).toBe(200)
    expect(patchResult.memory.body).toBe('用户更新后的内容。')

    const deleteResponse = await onRequestDelete({
      env,
      request: new Request('https://app.local/api/ai/memories?id=memory-1', {
        headers: { authorization: 'Bearer token' },
        method: 'DELETE',
      }),
    })
    const deleteResult = await deleteResponse.json()

    expect(deleteResponse.status).toBe(200)
    expect(deleteResult.deleted).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  })
})
