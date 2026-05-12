import {
  generateGeminiContent,
  type GeminiContent,
} from './gemini'
import { HttpError, type FunctionEnv } from './http'
import {
  retrieveAssistantRag,
  type AssistantRagSource,
  type AssistantRagSourceType,
} from './rag'

export const ASSISTANT_AGENT_ROLES = [
  'orchestrator',
  'dashboard_operator',
  'memory_agent',
  'rag_retriever',
  'reflection_agent',
  'briefing_agent',
  'memory_curator',
  'policy_guard',
] as const

export type AssistantAgentRole = typeof ASSISTANT_AGENT_ROLES[number]

export type AssistantAgentTraceStatus = 'success' | 'fallback' | 'skipped' | 'error'

export interface AssistantAgentTraceItem {
  duration_ms?: number
  role: AssistantAgentRole
  sources_count?: number
  status: AssistantAgentTraceStatus
  summary: string
}

export type AgentRouteIntent =
  | 'dashboard_operation'
  | 'memory_question'
  | 'memory_write'
  | 'general_answer'

export interface AgentRouteDecision {
  confidence: number
  intent: AgentRouteIntent
  reason: string
}

export interface AgentRunInput {
  contents: GeminiContent[]
  env: FunctionEnv
  role: AssistantAgentRole
  systemInstruction: string
  tools?: unknown[]
}

export interface AgentRunOutput {
  agent_trace: AssistantAgentTraceItem[]
  result: Awaited<ReturnType<typeof generateGeminiContent>>
}

const ROUTE_INTENTS: AgentRouteIntent[] = [
  'dashboard_operation',
  'memory_question',
  'memory_write',
  'general_answer',
]

const ORCHESTRATOR_SYSTEM_PROMPT = `
你是 Primoria Dashboard 的 Orchestrator Agent。你只负责把用户消息分流到一个 specialist，不要回答用户问题。
只输出严格 JSON：{"intent":"dashboard_operation|memory_question|memory_write|general_answer","confidence":0-1,"reason":"简短中文原因"}
分流规则：
- dashboard_operation：用户要读取、搜索、移动、新建、更新、删除 dashboard 当前数据，或询问今天/明天/本周的任务、日程、习惯、笔记、番茄钟/专注记录。
- memory_question：用户在**询问**长期记忆、偏好、工作习惯、流程规则、项目事实（"你记得"/"我之前说过"/"我喜欢"）。
- memory_write：用户希望**写入或更新**长期记忆 / 偏好 / 工作习惯 / 项目事实（"记下"/"记住"/"帮我记"/"把这个写进长期记忆"/"以后请记得我..."）。即使消息里出现"长期记忆"或"memory"这种词，只要意图是写入或保存就归到 memory_write。
- general_answer：不依赖 dashboard 当前状态，也不是记忆查询/写入的一般问题。
不确定时选择 dashboard_operation。
`.trim()

const MEMORY_AGENT_SYSTEM_PROMPT = `
你是 Primoria Dashboard 的 Memory Agent。你只能基于提供的 RAG/长期记忆上下文回答。
不要调用工具，不要声称读取了当前 dashboard 状态，不要准备 pending action。
如果上下文不足，直接说明目前没有足够长期记忆。
回答使用简洁中文。
`.trim()

const GENERAL_AGENT_SYSTEM_PROMPT = `
你是 Primoria Dashboard 的通用回答分支。回答一般问题时使用简洁中文。
不要声称读取了当前 dashboard 状态；如果问题涉及任务、日程、习惯或笔记，应说明需要交给 Dashboard Operator 用工具读取。
`.trim()

function now() {
  return Date.now()
}

function elapsed(startedAt: number) {
  return Math.max(0, Date.now() - startedAt)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clampConfidence(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5
}

function extractJsonObject(text: string) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  return first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed
}

function isRouteIntent(value: unknown): value is AgentRouteIntent {
  return ROUTE_INTENTS.includes(value as AgentRouteIntent)
}

function parseRouteDecision(text: string): AgentRouteDecision | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as unknown
    if (!isRecord(parsed) || !isRouteIntent(parsed.intent)) return null
    return {
      confidence: clampConfidence(parsed.confidence),
      intent: parsed.intent,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 160)
        : 'orchestrator classified the request',
    }
  } catch {
    return null
  }
}

export function createAgentTraceItem({
  duration_ms,
  role,
  sources_count,
  status,
  summary,
}: AssistantAgentTraceItem): AssistantAgentTraceItem {
  return {
    ...(duration_ms === undefined ? {} : { duration_ms }),
    role,
    ...(sources_count === undefined ? {} : { sources_count }),
    status,
    summary,
  }
}

export function extractLatestUserText(contents: GeminiContent[]) {
  for (let index = contents.length - 1; index >= 0; index -= 1) {
    const content = contents[index]
    if (content.role !== 'user') continue
    const text = content.parts
      .map((part) => part.text)
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

export function classifyRouteHeuristically(text: string): AgentRouteDecision {
  const normalized = text.toLowerCase()

  const memoryWriteSignals = [
    '记下来',
    '记下',
    '记住',
    '帮我记',
    '请记得',
    '以后请',
    '以后记得',
    '写入长期记忆',
    '写进长期记忆',
    '加入长期记忆',
    '存到记忆',
    '存进记忆',
    '保存到记忆',
    '保存为偏好',
    '更新偏好',
    '更新长期记忆',
    'remember this',
    'save this to memory',
  ]
  if (memoryWriteSignals.some((signal) => normalized.includes(signal))) {
    return {
      confidence: 0.7,
      intent: 'memory_write',
      reason: '用户希望写入或更新长期记忆。',
    }
  }

  const memoryQuerySignals = [
    '你记得',
    '还记得',
    '我之前说过',
    '我的偏好',
    '我喜欢',
    '我的工作习惯',
    '我的流程规则',
  ]
  if (memoryQuerySignals.some((signal) => normalized.includes(signal))) {
    return {
      confidence: 0.65,
      intent: 'memory_question',
      reason: '用户在询问长期记忆或偏好。',
    }
  }

  const dashboardSignals = [
    'dashboard',
    '任务',
    '待办',
    '日程',
    '会议',
    '习惯',
    '打卡',
    '笔记',
    '番茄',
    '番茄钟',
    '专注',
    '计时',
    'pomodoro',
    'focus',
    '今天',
    '明天',
    '本周',
    '移动',
    '新建',
    '添加',
    '删除',
    '改成',
    '搜索',
    '查一下',
    '安排',
  ]
  if (dashboardSignals.some((signal) => normalized.includes(signal))) {
    return {
      confidence: 0.7,
      intent: 'dashboard_operation',
      reason: '用户请求可能涉及 dashboard 当前状态或写入动作。',
    }
  }

  return {
    confidence: 0.55,
    intent: 'general_answer',
    reason: '用户问题不依赖 dashboard 当前状态。',
  }
}

export async function routeAssistantRequest({
  contents,
  env,
  latestUserText,
}: {
  contents: GeminiContent[]
  env: FunctionEnv
  latestUserText: string
}) {
  const startedAt = now()
  try {
    const result = await generateGeminiContent({
      contents: [{
        role: 'user',
        parts: [{
          text: JSON.stringify({
            latest_user_message: latestUserText,
            recent_contents: contents.slice(-6),
          }),
        }],
      }],
      env,
      systemInstruction: ORCHESTRATOR_SYSTEM_PROMPT,
    })
    const decision = parseRouteDecision(result.text) ?? classifyRouteHeuristically(latestUserText)
    return {
      decision,
      trace: createAgentTraceItem({
        duration_ms: elapsed(startedAt),
        role: 'orchestrator',
        status: decision.confidence >= 0.6 ? 'success' : 'fallback',
        summary: `分流到 ${decision.intent}：${decision.reason}`,
      }),
    }
  } catch {
    const decision = {
      confidence: 0.5,
      intent: 'dashboard_operation' as const,
      reason: 'Orchestrator 失败，按安全默认交给 Dashboard Operator。',
    }
    return {
      decision,
      trace: createAgentTraceItem({
        duration_ms: elapsed(startedAt),
        role: 'orchestrator',
        status: 'fallback',
        summary: decision.reason,
      }),
    }
  }
}

export function buildAgentSystemInstruction({
  base,
  role,
  today,
  ragContext,
}: {
  base: string
  ragContext?: string
  role: AssistantAgentRole
  today?: string
}) {
  return [
    `Agent role: ${role}`,
    today ? `用户本地今天是 ${today}。处理"今天/明天/本周"等时间表达时以此为准。` : '',
    base,
    ragContext ? `可参考的 RAG 上下文：\n${ragContext}` : '',
  ].filter(Boolean).join('\n\n')
}

export function policyGuardTrace({
  allowedTools,
  role,
}: {
  allowedTools: boolean
  role: AssistantAgentRole
}) {
  return createAgentTraceItem({
    role: 'policy_guard',
    status: 'success',
    summary: allowedTools
      ? `${role} 可使用 dashboard tools，但写入仍必须 pending action。`
      : `${role} 不允许使用 dashboard tools 或直接写入。`,
  })
}

export async function runGeminiAgent({
  contents,
  env,
  role,
  systemInstruction,
  tools,
}: AgentRunInput): Promise<AgentRunOutput> {
  const startedAt = now()
  if (tools && role !== 'dashboard_operator') {
    throw new HttpError(500, `${role} is not allowed to use dashboard tools`)
  }

  const result = await generateGeminiContent({
    contents,
    env,
    systemInstruction,
    ...(tools ? { tools } : {}),
  })

  return {
    agent_trace: [
      createAgentTraceItem({
        duration_ms: elapsed(startedAt),
        role,
        status: 'success',
        summary: tools
          ? '已运行 Dashboard Operator，并允许工具调用。'
          : `已运行 ${role}。`,
      }),
    ],
    result,
  }
}

export async function runRagRetriever({
  accessToken,
  env,
  matchCount,
  query,
  sourceTypes,
  userId,
}: {
  accessToken?: string
  env: FunctionEnv
  matchCount?: number
  query: string
  sourceTypes?: AssistantRagSourceType[]
  userId: string
}): Promise<{
  agent_trace: AssistantAgentTraceItem[]
  ragContext: string
  ragSources: AssistantRagSource[]
}> {
  const startedAt = now()
  try {
    const result = await retrieveAssistantRag({
      accessToken,
      env,
      matchCount,
      query,
      sourceTypes,
      userId,
    })
    return {
      ...result,
      agent_trace: [
        createAgentTraceItem({
          duration_ms: elapsed(startedAt),
          role: 'rag_retriever',
          sources_count: result.ragSources.length,
          status: 'success',
          summary: `检索到 ${result.ragSources.length} 条参考来源。`,
        }),
      ],
    }
  } catch {
    return {
      ragContext: '',
      ragSources: [],
      agent_trace: [
        createAgentTraceItem({
          duration_ms: elapsed(startedAt),
          role: 'rag_retriever',
          sources_count: 0,
          status: 'fallback',
          summary: 'RAG 检索失败，继续无来源回答。',
        }),
      ],
    }
  }
}

export function getAgentPromptForRoute(intent: AgentRouteIntent) {
  if (intent === 'memory_question') return MEMORY_AGENT_SYSTEM_PROMPT
  if (intent === 'general_answer') return GENERAL_AGENT_SYSTEM_PROMPT
  return null
}
