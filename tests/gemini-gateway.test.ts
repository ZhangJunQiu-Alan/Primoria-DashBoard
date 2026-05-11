import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateGeminiContent,
  getGeminiFallbackModels,
  getGeminiModel,
} from '../functions/_shared/gemini'

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

function generateContentResponse(text: string) {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text }], role: 'model' } }],
  })
}

describe('Gemini gateway', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes the default and legacy model to Gemini 2.5 Flash', () => {
    expect(getGeminiModel({})).toBe('gemini-2.5-flash')
    expect(getGeminiModel({ GEMINI_MODEL: 'gemini-3.1-pro-preview' })).toBe('gemini-2.5-flash')
    expect(getGeminiModel({ GEMINI_MODEL: 'gemini-custom' })).toBe('gemini-custom')
  })

  it('deduplicates fallback models and excludes the primary model', () => {
    expect(getGeminiFallbackModels({
      GEMINI_FALLBACK_MODELS: '',
      GEMINI_MODEL: 'gemini-custom',
    })).toEqual([])
    expect(getGeminiFallbackModels({
      GEMINI_FALLBACK_MODELS: 'gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.5-flash-lite',
      GEMINI_MODEL: 'gemini-2.5-flash',
    })).toEqual(['gemini-2.5-flash-lite'])
  })

  it('routes content generation through the 2.5 Flash gateway by default', async () => {
    const requestedUrls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      requestedUrls.push(String(input))
      return generateContentResponse('ok')
    })

    const result = await generateGeminiContent({
      contents: [{ parts: [{ text: 'hello' }], role: 'user' }],
      env: { GEMINI_API_KEY: 'gemini-key' },
      systemInstruction: 'system',
    })

    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]).toContain('/models/gemini-2.5-flash:generateContent')
    expect(result.model).toBe('gemini-2.5-flash')
    expect(result.gateway).toMatchObject({
      fallback_used: false,
      model: 'gemini-2.5-flash',
      provider: 'gemini',
    })
    expect(result.text).toBe('ok')
  })

  it('fails over to a configured fallback model only after a retryable primary failure', async () => {
    const requestedUrls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.includes('/models/gemini-2.5-flash:generateContent')) {
        return jsonResponse({ error: { message: 'This model is currently experiencing high demand.' } }, 503)
      }
      return generateContentResponse('fallback ok')
    })

    const result = await generateGeminiContent({
      contents: [{ parts: [{ text: 'hello' }], role: 'user' }],
      env: {
        GEMINI_API_KEY: 'gemini-key',
        GEMINI_FALLBACK_MODELS: 'gemini-2.5-flash-lite',
      },
      systemInstruction: 'system',
    })

    expect(requestedUrls).toHaveLength(2)
    expect(requestedUrls[1]).toContain('/models/gemini-2.5-flash-lite:generateContent')
    expect(result.model).toBe('gemini-2.5-flash-lite')
    expect(result.gateway.fallback_used).toBe(true)
    expect(result.gateway.attempts.map((attempt) => attempt.status)).toEqual(['retryable_error', 'success'])
    expect(result.text).toBe('fallback ok')
  })
})
