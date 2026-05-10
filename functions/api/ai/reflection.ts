import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireUser,
  type PagesContext,
} from '../../_shared/http'
import {
  generateGeminiContent,
  getGeminiModel,
} from '../../_shared/gemini'
import { extractAssistantMemories } from '../../_shared/memory'
import {
  indexAssistantRag,
  retrieveAssistantRag,
  type AssistantRagSource,
} from '../../_shared/rag'
import {
  buildReflectionPrompt,
  buildRuleReflection,
  buildSourceFingerprint,
  getReflectionPeriod,
  mergeLlmReflection,
  readCachedReflection,
  readReflectionSourceRows,
  upsertReflection,
  type AssistantReflectionPeriodType,
  type AssistantReflectionResult,
  type StoredReflectionRow,
} from '../../_shared/reflection'

interface ReflectionBody {
  date?: string
  periodType?: AssistantReflectionPeriodType
  timeMax?: string
  timeMin?: string
}

function isPeriodType(value: unknown): value is AssistantReflectionPeriodType {
  return value === 'daily' || value === 'weekly'
}

function isIsoString(value: unknown) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

const REFLECTION_SYSTEM_PROMPT = `
你是 Primoria Dashboard 的反思层。你的任务是基于已提供的事件、内容和规则候选，生成每日/每周反思和优先级判断。
只输出严格 JSON，不要 Markdown，不要执行或承诺执行任何 Dashboard 写入动作。
建议只能是低风险文本建议；如果需要改任务、便签、布局或习惯，只能建议用户之后通过 pending action 确认。
`.trim()

async function safeExtractMemories({
  env,
  reflection,
  userId,
}: {
  env: PagesContext['env']
  reflection: AssistantReflectionResult | StoredReflectionRow
  userId: string
}) {
  try {
    return await extractAssistantMemories({ env, reflection, userId })
  } catch {
    return { created: 0, extracted: false, skipped: 1, updated: 0 }
  }
}

async function safeRetrieveReflectionRag({
  env,
  query,
  userId,
}: {
  env: PagesContext['env']
  query: string
  userId: string
}) {
  try {
    return await retrieveAssistantRag({
      env,
      query,
      sourceTypes: ['assistant_memory', 'assistant_reflection'],
      userId,
    })
  } catch {
    return { ragContext: '', ragSources: [] as AssistantRagSource[] }
  }
}

async function safeIndexReflectionMemory({
  env,
  userId,
}: {
  env: PagesContext['env']
  userId: string
}) {
  try {
    await indexAssistantRag({
      env,
      sourceTypes: ['assistant_reflection', 'assistant_memory'],
      userId,
    })
  } catch {
    return
  }
}

function buildReflectionRagQuery({
  period,
  periodType,
  ruleResult,
}: {
  period: ReturnType<typeof getReflectionPeriod>
  periodType: AssistantReflectionPeriodType
  ruleResult: AssistantReflectionResult
}) {
  return JSON.stringify({
    completion_summary: ruleResult.completion_summary,
    intent: 'assistant_reflection',
    period_end: period.periodEnd,
    period_start: period.periodStart,
    period_type: periodType,
    priorities: ruleResult.priority_items.slice(0, 8).map((item) => ({
      reason: item.reason,
      title: item.title,
    })),
    summary: ruleResult.summary,
    suggestions: ruleResult.suggestions,
  })
}

function appendRagContextToReflectionPrompt(prompt: string, ragContext: string) {
  if (!ragContext) return prompt
  try {
    return JSON.stringify({
      rag_context: JSON.parse(ragContext),
      reflection_input: JSON.parse(prompt),
    })
  } catch {
    return `${prompt}\n\nRAG_CONTEXT:\n${ragContext}`
  }
}

export async function onRequestPost({ env, request }: PagesContext) {
  try {
    const user = await requireUser(request, env)
    const body = await readJsonBody<ReflectionBody>(request)
    const periodType = isPeriodType(body.periodType) ? body.periodType : 'daily'
    const date = typeof body.date === 'string' ? body.date : new Date().toISOString().slice(0, 10)
    const period = getReflectionPeriod(periodType, date)

    if (isIsoString(body.timeMin)) period.timeMin = body.timeMin
    if (isIsoString(body.timeMax)) period.timeMax = body.timeMax

    const sourceRows = await readReflectionSourceRows({ env, period, userId: user.id })
    const sourceContext = {
      contentItems: sourceRows.contentItems,
      events: sourceRows.events,
      period,
      periodType,
    }
    const sourceFingerprint = buildSourceFingerprint(sourceContext)
    const cached = await readCachedReflection({
      env,
      reflectionKey: period.reflectionKey,
      userId: user.id,
    })

    const ruleResult = {
      ...buildRuleReflection(sourceContext),
      source_fingerprint: sourceFingerprint,
    }
    const rag = await safeRetrieveReflectionRag({
      env,
      query: buildReflectionRagQuery({ period, periodType, ruleResult }),
      userId: user.id,
    })

    if (cached?.source_fingerprint === sourceFingerprint) {
      const memoryUpdates = await safeExtractMemories({ env, reflection: cached, userId: user.id })
      await safeIndexReflectionMemory({ env, userId: user.id })
      return jsonResponse({
        ...cached,
        cached: true,
        memory_updates: memoryUpdates,
        rag_sources: rag.ragSources,
      })
    }

    const model = getGeminiModel(env)
    let result = ruleResult

    try {
      const reflectionPrompt = buildReflectionPrompt(sourceContext, ruleResult)
      const generated = await generateGeminiContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: appendRagContextToReflectionPrompt(reflectionPrompt, rag.ragContext) }],
          },
        ],
        env,
        systemInstruction: `${REFLECTION_SYSTEM_PROMPT}\n如果提供了 rag_context，只把它作为反思辅助背景，不要虚构未提供的事实。`,
      })
      result = mergeLlmReflection(generated.text, ruleResult, model)
    } catch {
      result = {
        ...ruleResult,
        generated_at: new Date().toISOString(),
        model: null,
      }
    }

    await upsertReflection({ env, result, userId: user.id })
    const memoryUpdates = await safeExtractMemories({ env, reflection: result, userId: user.id })
    await safeIndexReflectionMemory({ env, userId: user.id })
    return jsonResponse({ ...result, memory_updates: memoryUpdates, rag_sources: rag.ragSources })
  } catch (error) {
    return errorResponse(error)
  }
}
