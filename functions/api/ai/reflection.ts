import {
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireUser,
  type PagesContext,
} from '../../_shared/http'
import { extractAssistantMemories } from '../../_shared/memory'
import {
  indexAssistantRag,
  type AssistantRagSource,
} from '../../_shared/rag'
import {
  buildAgentSystemInstruction,
  createAgentTraceItem,
  policyGuardTrace,
  runGeminiAgent,
  runRagRetriever,
  type AssistantAgentTraceItem,
} from '../../_shared/agents'
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
}): Promise<{
  summary: { created: number; extracted: boolean; skipped: number; updated: number }
  trace: AssistantAgentTraceItem
}> {
  const startedAt = Date.now()
  try {
    const summary = await extractAssistantMemories({ env, reflection, userId })
    return {
      summary,
      trace: createAgentTraceItem({
        duration_ms: Math.max(0, Date.now() - startedAt),
        role: 'memory_curator',
        status: summary.extracted ? 'success' : 'skipped',
        summary: summary.extracted
          ? `长期记忆提炼完成：新增 ${summary.created}，更新 ${summary.updated}。`
          : '长期记忆已是最新或没有可提炼内容。',
      }),
    }
  } catch {
    return {
      summary: { created: 0, extracted: false, skipped: 1, updated: 0 },
      trace: createAgentTraceItem({
        duration_ms: Math.max(0, Date.now() - startedAt),
        role: 'memory_curator',
        status: 'fallback',
        summary: '长期记忆提炼失败，反思结果仍返回。',
      }),
    }
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
    return await runRagRetriever({
      env,
      query,
      sourceTypes: ['assistant_memory', 'assistant_reflection'],
      userId,
    })
  } catch {
    return {
      agent_trace: [
        createAgentTraceItem({
          role: 'rag_retriever',
          sources_count: 0,
          status: 'fallback',
          summary: '反思 RAG 检索失败，继续生成反思。',
        }),
      ],
      ragContext: '',
      ragSources: [] as AssistantRagSource[],
    }
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

    const sourceRows = await readReflectionSourceRows({
      accessToken: user.accessToken,
      env,
      period,
      userId: user.id,
    })
    const sourceContext = {
      contentItems: sourceRows.contentItems,
      events: sourceRows.events,
      period,
      periodType,
    }
    const sourceFingerprint = buildSourceFingerprint(sourceContext)
    const cached = await readCachedReflection({
      accessToken: user.accessToken,
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
        agent_trace: [
          ...rag.agent_trace,
          createAgentTraceItem({
            role: 'reflection_agent',
            status: 'skipped',
            summary: '反思缓存命中，跳过重新生成。',
          }),
          memoryUpdates.trace,
          policyGuardTrace({ allowedTools: false, role: 'reflection_agent' }),
        ],
        cached: true,
        memory_updates: memoryUpdates.summary,
        rag_sources: rag.ragSources,
      })
    }

    let result = ruleResult

    try {
      const reflectionPrompt = buildReflectionPrompt(sourceContext, ruleResult)
      const generated = await runGeminiAgent({
        contents: [
          {
            role: 'user',
            parts: [{ text: appendRagContextToReflectionPrompt(reflectionPrompt, rag.ragContext) }],
          },
        ],
        env,
        role: 'reflection_agent',
        systemInstruction: buildAgentSystemInstruction({
          base: `${REFLECTION_SYSTEM_PROMPT}\n如果提供了 rag_context，只把它作为反思辅助背景，不要虚构未提供的事实。`,
          role: 'reflection_agent',
        }),
      })
      result = mergeLlmReflection(generated.result.text, ruleResult, generated.result.model)
    } catch {
      result = {
        ...ruleResult,
        generated_at: new Date().toISOString(),
        model: null,
      }
    }

    await upsertReflection({ accessToken: user.accessToken, env, result, userId: user.id })
    const memoryUpdates = await safeExtractMemories({ env, reflection: result, userId: user.id })
    await safeIndexReflectionMemory({ env, userId: user.id })
    return jsonResponse({
      ...result,
      agent_trace: [
        ...rag.agent_trace,
        createAgentTraceItem({
          role: 'reflection_agent',
          status: result.model ? 'success' : 'fallback',
          summary: result.model ? 'Reflection Agent 已生成反思。' : 'Reflection Agent 使用规则 fallback 生成反思。',
        }),
        memoryUpdates.trace,
        policyGuardTrace({ allowedTools: false, role: 'reflection_agent' }),
      ],
      memory_updates: memoryUpdates.summary,
      rag_sources: rag.ragSources,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
