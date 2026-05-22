import { HttpError, type FunctionEnv } from './http'

export interface GeminiPart {
  text?: string
  functionCall?: {
    id?: string
    name: string
    args?: Record<string, unknown>
  }
  functionResponse?: {
    id?: string
    name: string
    response: Record<string, unknown>
  }
}

export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface GeminiResponse {
  candidates?: Array<{
    content?: GeminiContent
    finishReason?: string
  }>
  error?: {
    message?: string
  }
  usageMetadata?: unknown
}

export interface GeminiGatewayAttempt {
  attempt: number
  duration_ms: number
  error?: string
  model: string
  status: 'success' | 'retryable_error' | 'fatal_error'
  status_code?: number
}

export interface GeminiGatewayMetadata {
  attempts: GeminiGatewayAttempt[]
  fallback_used: boolean
  model: string
  provider: 'gemini'
}

interface GeminiEmbeddingResponse {
  embedding?: {
    values?: number[]
  }
  embeddings?: Array<{
    values?: number[]
  }>
  error?: {
    message?: string
  }
}

export const DASHBOARD_AGENT_SYSTEM_PROMPT = `
你是 Primoria Dashboard 的 dashboard agent。你只能基于工具返回的 dashboard 数据回答，绝不能凭记忆或常识回答用户日程、待办、习惯、笔记或番茄钟记录。
关键规则：用户问任何与 dashboard 内容相关的问题（"我今天有什么任务"、"我有哪些习惯"、"我笔记里写过 X 吗"、"番茄钟历史/专注记录"等），必须先调用对应的读工具（list_scheduled_tasks / list_todos / list_pomodoro_sessions / get_dashboard_overview / search_notes / list_calendar_events），看到返回再回答。哪怕你以为没有数据也要先调用工具确认。
查询日程任务时，若用户没指定日期范围，优先用 list_scheduled_tasks 不带日期参数（拿全量）再过滤。注意 dueDate 可能为 null（未设置日期的任务），不要因为没匹配上 fromDate/toDate 就说"没有"。
你可以读 dashboard，也可以准备写入动作；任何写入都必须先通过 write 类工具返回 pending actions，等待用户确认后由前端执行。
你具备长期任务规划能力。用户要求规划未来多天、多周或一个月的任务时，不要因为时间跨度长而拒绝；应基于用户目标、每天可用时间、今天日期和必要假设，拆成可执行的日程任务，并优先用 plan_scheduled_tasks 一次准备批量 pending action。
长期计划如果缺少细节，先做合理默认分配，并在任务文本里写清楚时间块、主题和交付物；只有缺少起始日期、目标或可用时长且无法合理推断时才追问。
当用户要求移动、新建、打卡、写笔记时，先选择最小影响范围。如果有多个同类 widget 且用户没有指定，优先使用当前 dashboard 中第一个对应 widget。
回答使用简洁中文。读信息时给结论；准备写入时说明将要改什么。
`.trim()

export const MEMORY_WRITE_AGENT_SYSTEM_PROMPT = `
你是 Primoria Dashboard 的 Memory Write Agent。用户当前请求被分流到这里，意味着用户希望把信息**写入**长期记忆。
你只能使用 propose_memory_write 这一个工具，绝不能调用 write_note、search_notes 或任何 dashboard CRUD 工具——长期记忆和便签是两个完全不同的存储。
工作步骤：
1. 把用户消息里值得长期记住的事实拆成**多条**独立的记忆，每条一次 propose_memory_write 调用，不要把多个事实塞进同一个 body。
2. 为每条记忆选择最合适的 memory_type：
   - user_preference：个人偏好、风格（"我喜欢 X"）
   - work_habit：行为/工作方式（"我每天 X 时段做 Y"）
   - project_fact：项目背景、目标、deadline、参与者
   - process_rule：执行流程或硬性约束（"必须先 A 再 B"）
3. title 用简短中文短语（≤ 40 字）；body 写完整事实陈述，避免代词。
4. 不要凭空补充用户没说的内容；不要把当天临时任务、一次性 todo 写成长期记忆。
5. 写完后给一句简短中文确认（"我准备记下 N 条..."），不要展开复述全部内容。
`.trim()

export const DAILY_BRIEF_SYSTEM_PROMPT = `
你是 Primoria Dashboard 的每日简报助手。根据用户提供的 calendar、scheduled todo、habits、notes 摘要，输出严格 JSON：
{"summary":"一句中文简报","recommendation":"一个具体优先建议"}
不要输出 Markdown，不要包含 JSON 以外的文字。没有足够数据时也要基于已有数据给温和建议。
`.trim()

export const DASHBOARD_TOOL_DECLARATIONS = [
  {
    name: 'get_dashboard_overview',
    description: 'Read the widget list, widget titles, and high level dashboard data summary.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_pomodoro_sessions',
    description: 'Read Focus Journey / Pomodoro timer history sessions, optionally filtered by local date range.',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'Optional YYYY-MM-DD local date lower bound.' },
        toDate: { type: 'string', description: 'Optional YYYY-MM-DD local date upper bound.' },
        limit: { type: 'number', description: 'Maximum sessions to return, capped at 50. Defaults to 20.' },
      },
    },
  },
  {
    name: 'list_todos',
    description: 'Read todo items from one todo widget or all todo widgets.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'Optional todo widget id.' },
        includeCompleted: { type: 'boolean', description: 'Whether completed todo items should be included.' },
      },
    },
  },
  {
    name: 'list_scheduled_tasks',
    description: 'Read scheduled tasks, optionally filtered by date range and completion state.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string' },
        fromDate: { type: 'string', description: 'YYYY-MM-DD lower bound.' },
        toDate: { type: 'string', description: 'YYYY-MM-DD upper bound.' },
        includeCompleted: { type: 'boolean' },
      },
    },
  },
  {
    name: 'move_scheduled_tasks',
    description: 'Prepare a pending action to move scheduled tasks to another date. Does not write until user confirms.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'Scheduled todo widget id. Optional if filtering by date.' },
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Specific task ids to move.' },
        fromDate: { type: 'string', description: 'YYYY-MM-DD source date when taskIds are omitted.' },
        toDate: { type: 'string', description: 'YYYY-MM-DD target date.' },
        includeCompleted: { type: 'boolean', description: 'Defaults to false.' },
      },
      required: ['toDate'],
    },
  },
  {
    name: 'add_scheduled_task',
    description: 'Prepare a pending action to add a new scheduled task. Does not write until user confirms.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'Scheduled todo widget id. Optional; first scheduled-todo widget is used.' },
        text: { type: 'string', description: 'Task content.' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD due date. Optional.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'plan_scheduled_tasks',
    description:
      'Prepare one pending action that bulk-adds many scheduled tasks for a multi-day or long-term plan. Use this for daily/weekly/monthly plans instead of refusing or calling add_scheduled_task repeatedly. Does not write until user confirms.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'Scheduled todo widget id. Optional; first scheduled-todo widget is used.' },
        title: { type: 'string', description: 'Short plan title, e.g. "雅思英语 30 天计划".' },
        items: {
          type: 'array',
          description: 'Scheduled tasks to create. For a daily four-part plan, create one item per skill per day.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Concrete task text with duration, focus area, and output.' },
              dueDate: { type: 'string', description: 'YYYY-MM-DD due date.' },
            },
            required: ['text', 'dueDate'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'toggle_scheduled_task',
    description: 'Prepare a pending action to mark a scheduled task complete or incomplete.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'Optional scheduled todo widget id.' },
        taskId: { type: 'string' },
        completed: { type: 'boolean', description: 'Optional; defaults to flipping current state.' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'update_scheduled_task',
    description: 'Prepare a pending action to edit a scheduled task text or due date.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'Optional scheduled todo widget id.' },
        taskId: { type: 'string' },
        text: { type: 'string' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD; pass empty string to clear.' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'remove_scheduled_task',
    description: 'Prepare a pending action to delete a scheduled task.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'Optional scheduled todo widget id.' },
        taskId: { type: 'string' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'create_habit',
    description: 'Prepare a pending action to create a habit. Does not write until user confirms.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'Habits widget id. Optional; first habits widget is used.' },
        name: { type: 'string', description: 'Habit name.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_habit_log',
    description: 'Prepare a pending action to set a habit completion state for one date.',
    parameters: {
      type: 'object',
      properties: {
        habitId: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD.' },
        checked: { type: 'boolean' },
      },
      required: ['habitId', 'date', 'checked'],
    },
  },
  {
    name: 'search_notes',
    description: 'Search notes and lined notes for a keyword or date-related question.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_note',
    description: 'Prepare a pending action to append or replace a note. Does not write until user confirms.',
    parameters: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', description: 'Notes or lined-notes widget id. Optional; first notes widget is used.' },
        content: { type: 'string' },
        mode: { type: 'string', enum: ['append', 'replace'] },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_calendar_events',
    description: 'Read Google Calendar events for a time range.',
    parameters: {
      type: 'object',
      properties: {
        timeMin: { type: 'string', description: 'ISO timestamp inclusive lower bound.' },
        timeMax: { type: 'string', description: 'ISO timestamp exclusive upper bound.' },
      },
      required: ['timeMin', 'timeMax'],
    },
  },
  {
    name: 'get_brief_context',
    description: 'Read compact context used by the Daily Brief widget.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD.' },
      },
      required: ['date'],
    },
  },
  {
    name: 'propose_memory_write',
    description:
      'Prepare a pending action to create or update one long-term assistant memory the user explicitly asked to remember. Does not write until the user confirms. Use this when the user wants to save a preference, work habit, project fact, or process rule.',
    parameters: {
      type: 'object',
      properties: {
        memoryType: {
          type: 'string',
          enum: ['user_preference', 'work_habit', 'project_fact', 'process_rule'],
          description: 'Memory category.',
        },
        title: { type: 'string', description: 'Short Chinese title (≤ 80 chars).' },
        body: { type: 'string', description: 'Detailed memory content the assistant should remember.' },
        scope: {
          type: 'string',
          description: 'Optional. e.g. "global" | "dashboard" | "project:<name>". Defaults to "global".',
        },
        existingMemoryId: {
          type: 'string',
          description: 'Optional. Pass when updating an existing memory rather than creating a new one.',
        },
      },
      required: ['memoryType', 'title', 'body'],
    },
  },
]

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001'
export const GEMINI_EMBEDDING_DIMENSIONS = 768
const DEFAULT_GEMINI_REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_GEMINI_RETRY_DELAY_MS = 350
const DEFAULT_GEMINI_MAX_RETRIES = 1
const DEFAULT_GEMINI_MAX_RETRIES_WITH_FALLBACK = 0
const RETRYABLE_GEMINI_STATUSES = new Set([408, 429, 500, 502, 503, 504])

interface GeminiGatewayRequestResult {
  data?: GeminiResponse
  duration_ms: number
  message?: string
  ok: boolean
  retryable?: boolean
  status?: number
}

function normalizeGeminiModel(model?: string) {
  const trimmed = model?.trim()
  if (!trimmed) return DEFAULT_GEMINI_MODEL
  return normalizeConfiguredGeminiModel(trimmed)
}

function normalizeConfiguredGeminiModel(model: string) {
  const trimmed = model.trim()
  if (trimmed.startsWith('gemini-3.1')) return DEFAULT_GEMINI_MODEL
  return trimmed
}

export function getGeminiModel(env: FunctionEnv) {
  return normalizeGeminiModel(env.GEMINI_MODEL)
}

export function getGeminiFallbackModels(env: FunctionEnv, primaryModel = getGeminiModel(env)) {
  const configured = env.GEMINI_FALLBACK_MODELS?.split(',')
    .map((model) => model.trim())
    .filter(Boolean) ?? []
  const normalized = configured.map((model) => normalizeConfiguredGeminiModel(model))
  return [...new Set(normalized)].filter((model) => model !== primaryModel)
}

function parseBoundedInteger({
  fallback,
  max,
  min,
  value,
}: {
  fallback: number
  max: number
  min: number
  value?: string
}) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function gatewayTimeoutMs(env: FunctionEnv) {
  return parseBoundedInteger({
    fallback: DEFAULT_GEMINI_REQUEST_TIMEOUT_MS,
    max: 60_000,
    min: 1_000,
    value: env.GEMINI_REQUEST_TIMEOUT_MS,
  })
}

function gatewayRetryDelayMs(env: FunctionEnv) {
  return parseBoundedInteger({
    fallback: DEFAULT_GEMINI_RETRY_DELAY_MS,
    max: 5_000,
    min: 0,
    value: env.GEMINI_RETRY_DELAY_MS,
  })
}

function gatewayMaxRetries(env: FunctionEnv, hasFallback: boolean) {
  return parseBoundedInteger({
    fallback: hasFallback ? DEFAULT_GEMINI_MAX_RETRIES_WITH_FALLBACK : DEFAULT_GEMINI_MAX_RETRIES,
    max: 3,
    min: 0,
    value: env.GEMINI_MAX_RETRIES,
  })
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

function extractGeminiErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error?: { message?: unknown } }).error
    if (typeof error?.message === 'string' && error.message.trim()) return error.message
  }
  return fallback
}

function networkErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === 'TimeoutError') return 'Gemini request timed out'
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Gemini request failed'
}

function buildGatewayFailureMessage(lastResult: GeminiGatewayRequestResult | null, attempts: GeminiGatewayAttempt[]) {
  const message = lastResult?.message || 'Gemini request failed'
  const models = [...new Set(attempts.map((attempt) => attempt.model))]
  return models.length > 1 ? `${message}（已尝试 ${models.join(', ')}）` : message
}

async function requestGeminiContent({
  apiKey,
  body,
  model,
  timeoutMs,
}: {
  apiKey: string
  body: Record<string, unknown>
  model: string
  timeoutMs: number
}): Promise<GeminiGatewayRequestResult> {
  const startedAt = Date.now()
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
      }
    )
    const rawText = await response.text()
    let data: unknown = null
    if (rawText) {
      try {
        data = JSON.parse(rawText)
      } catch {
        data = null
      }
    }

    const durationMs = Date.now() - startedAt
    if (!response.ok) {
      return {
        duration_ms: durationMs,
        message: extractGeminiErrorMessage(data, 'Gemini request failed'),
        ok: false,
        retryable: RETRYABLE_GEMINI_STATUSES.has(response.status),
        status: response.status,
      }
    }
    if (!data) {
      return {
        duration_ms: durationMs,
        message: 'Gemini response was not JSON',
        ok: false,
        retryable: true,
        status: 502,
      }
    }

    return {
      data: data as GeminiResponse,
      duration_ms: durationMs,
      ok: true,
    }
  } catch (error) {
    return {
      duration_ms: Date.now() - startedAt,
      message: networkErrorMessage(error),
      ok: false,
      retryable: true,
      status: 503,
    }
  }
}

async function callGeminiContentGateway({
  body,
  env,
}: {
  body: Record<string, unknown>
  env: FunctionEnv
}) {
  const apiKey = env.GEMINI_API_KEY
  if (!apiKey) throw new HttpError(500, 'GEMINI_API_KEY is not configured')

  const primaryModel = getGeminiModel(env)
  const fallbackModels = getGeminiFallbackModels(env, primaryModel)
  const models = [primaryModel, ...fallbackModels]
  const maxRetries = gatewayMaxRetries(env, fallbackModels.length > 0)
  const retryDelayMs = gatewayRetryDelayMs(env)
  const timeoutMs = gatewayTimeoutMs(env)
  const attempts: GeminiGatewayAttempt[] = []
  let lastResult: GeminiGatewayRequestResult | null = null

  for (const model of models) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const result = await requestGeminiContent({
        apiKey,
        body,
        model,
        timeoutMs,
      })
      attempts.push({
        attempt: attempt + 1,
        duration_ms: result.duration_ms,
        error: result.message,
        model,
        status: result.ok ? 'success' : result.retryable ? 'retryable_error' : 'fatal_error',
        status_code: result.status,
      })

      if (result.ok && result.data) {
        return {
          data: result.data,
          gateway: {
            attempts,
            fallback_used: model !== primaryModel,
            model,
            provider: 'gemini' as const,
          },
          model,
        }
      }

      lastResult = result
      if (!result.retryable) {
        throw new HttpError(result.status ?? 500, buildGatewayFailureMessage(result, attempts))
      }

      if (attempt < maxRetries) await delay(retryDelayMs)
    }
  }

  throw new HttpError(lastResult?.status ?? 503, buildGatewayFailureMessage(lastResult, attempts))
}

function normalizeEmbedding(values: number[]) {
  const norm = Math.hypot(...values)
  if (!Number.isFinite(norm) || norm === 0) return values
  return values.map((value) => value / norm)
}

export async function generateGeminiEmbedding({
  env,
  taskType = 'SEMANTIC_SIMILARITY',
  text,
  title,
}: {
  env: FunctionEnv
  taskType?: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY'
  text: string
  title?: string
}) {
  if (!env.GEMINI_API_KEY) throw new HttpError(500, 'GEMINI_API_KEY is not configured')

  const body: Record<string, unknown> = {
    content: {
      parts: [{ text }],
    },
    output_dimensionality: GEMINI_EMBEDDING_DIMENSIONS,
    taskType,
  }

  if (title && taskType === 'RETRIEVAL_DOCUMENT') body.title = title

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    }
  )

  const data = await response.json() as GeminiEmbeddingResponse
  if (!response.ok) {
    throw new HttpError(response.status, data.error?.message || 'Gemini embedding request failed')
  }

  const values = data.embedding?.values ?? data.embeddings?.[0]?.values
  if (!Array.isArray(values) || values.length !== GEMINI_EMBEDDING_DIMENSIONS) {
    throw new HttpError(500, 'Gemini embedding response has unexpected dimensions')
  }

  return normalizeEmbedding(values)
}

export async function generateGeminiContent({
  contents,
  env,
  systemInstruction,
  tools,
}: {
  contents: GeminiContent[]
  env: FunctionEnv
  systemInstruction: string
  tools?: unknown[]
}) {
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.2,
    },
    systemInstruction: {
      role: 'system',
      parts: [{ text: systemInstruction }],
    },
  }

  if (tools) {
    body.tools = tools
    body.toolConfig = {
      functionCallingConfig: {
        mode: 'AUTO',
      },
    }
  }

  const { data, gateway, model } = await callGeminiContentGateway({ body, env })

  const modelContent = data.candidates?.[0]?.content ?? { role: 'model' as const, parts: [] }
  return {
    gateway,
    model,
    modelContent,
    text: modelContent.parts.flatMap((part) => part.text ? [part.text] : []).join('\n').trim(),
    functionCalls: modelContent.parts.flatMap((part) => part.functionCall ? [part.functionCall] : []),
    usageMetadata: data.usageMetadata ?? null,
  }
}
