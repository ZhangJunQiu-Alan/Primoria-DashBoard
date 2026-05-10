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

    if (cached?.source_fingerprint === sourceFingerprint) {
      return jsonResponse({ ...cached, cached: true })
    }

    const ruleResult = {
      ...buildRuleReflection(sourceContext),
      source_fingerprint: sourceFingerprint,
    }
    const model = getGeminiModel(env)
    let result = ruleResult

    try {
      const generated = await generateGeminiContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildReflectionPrompt(sourceContext, ruleResult) }],
          },
        ],
        env,
        systemInstruction: REFLECTION_SYSTEM_PROMPT,
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
    return jsonResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
